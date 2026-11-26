//! The design engines (figcraft, deckcraft) as MCP servers, started only when they are used.
//!
//! Before: every member's CLI launched its own `<engine>-cli mcp` per engine at start-up, so a team
//! of ten had twenty engine processes, most of them never called (and an engine that opened a big
//! file kept its hundreds of MB for as long as the member lived).
//!
//! Now each member's CLI talks to Prism (`POST /engine/{engine}/{project}/{agent}`), and Prism:
//! - answers the start-up questions (`initialize`, `tools/list`, …) from what an engine said
//!   before, so a member that never draws never starts one;
//! - starts that member's engine on its first real call, with that member's own read/write roots;
//! - stops it after `IDLE` without calls, or when the member's session ends.
//!
//! An engine process keeps one open document, so members never share one: two members' calls
//! would land in the same file. One process per member *that uses it*, none for the rest.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// An engine nobody called for this long is stopped (its memory goes back).
const IDLE: Duration = Duration::from_secs(15 * 60);
/// Longest wait for one answer; `wait_for_changes`-style calls bring their own shorter timeout.
const CALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const INIT_TIMEOUT: Duration = Duration::from_secs(60);
/// Answered from memory once an engine has said them.
const STATIC: [&str; 5] = ["initialize", "tools/list", "prompts/list", "resources/list", "resources/templates/list"];
/// Told to the member when its engine was stopped while idle and started again.
pub const RESTARTED_NOTE: &str = "[Prism] 이 엔진은 한동안 쓰지 않아 꺼졌다가 방금 다시 켜졌어요. 열어 두었던 파일이 있었다면 다시 여세요 (저장하지 않은 변경은 남아 있지 않아요).";

/// Which engines exist (`launch::installed_engines` names) and where their CLI is.
fn cli_of(engine: &str) -> Option<PathBuf> {
    match engine {
        "figcraft" => crate::launch::figcraft_cli(),
        "deckcraft" => crate::launch::deckcraft_cli(),
        _ => None,
    }
}

/// One member's engine: who it is for and what it may touch.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Key {
    pub engine: String,
    pub project: String,
    pub agent: String,
    pub reads: Vec<String>,
    pub writes: Vec<String>,
}

impl Key {
    fn member(&self) -> (&str, &str) {
        (&self.project, &self.agent)
    }
    fn args(&self) -> Vec<String> {
        let mut a = vec!["mcp".to_string()];
        for r in &self.reads {
            a.extend(["--automation-read-root".into(), r.clone()]);
        }
        for w in &self.writes {
            a.extend(["--automation-write-root".into(), w.clone()]);
        }
        a
    }
}

struct Proc {
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
    waiting: Mutex<HashMap<u64, mpsc::Sender<Value>>>,
    next_id: AtomicU64,
    last_used: Mutex<Instant>,
    busy: AtomicUsize,
    dead: Arc<AtomicBool>,
}

impl Proc {
    fn spawn(cli: &PathBuf, key: &Key) -> Result<Arc<Proc>, String> {
        for d in key.reads.iter().chain(&key.writes) {
            let _ = std::fs::create_dir_all(d);
        }
        let mut cmd = Command::new(cli);
        cmd.args(key.args()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        crate::sys::hide_console(&mut cmd);
        let mut child = cmd.spawn().map_err(|e| format!("{} 엔진을 시작하지 못했어요: {e}", key.engine))?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let p = Arc::new(Proc {
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            waiting: Mutex::default(),
            next_id: AtomicU64::new(1),
            last_used: Mutex::new(Instant::now()),
            busy: AtomicUsize::new(0),
            dead: Arc::new(AtomicBool::new(false)),
        });
        let reader = p.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                let id = v.get("id").and_then(Value::as_u64);
                match (id, v.get("method").is_some()) {
                    // an answer to one of ours
                    (Some(id), false) => {
                        if let Some(tx) = reader.waiting.lock().unwrap().remove(&id) {
                            let _ = tx.send(v);
                        }
                    }
                    // the engine asks us something (roots, sampling…): we offer none
                    (Some(_), true) => {
                        let no = json!({ "jsonrpc": "2.0", "id": v["id"], "error": { "code": -32601, "message": "not supported" } });
                        let _ = reader.write(&no);
                    }
                    _ => {} // notifications
                }
            }
            reader.dead.store(true, Ordering::SeqCst);
            reader.waiting.lock().unwrap().clear(); // waiting callers see a closed channel
            let _ = reader.child.lock().unwrap().try_wait();
        });
        Ok(p)
    }

    fn write(&self, v: &Value) -> Result<(), String> {
        let mut s = self.stdin.lock().unwrap();
        writeln!(s, "{v}").and_then(|_| s.flush()).map_err(|e| e.to_string())
    }

    /// Sends one request and waits for its answer (`result` or `error` object as the engine sent it).
    fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        if self.dead.load(Ordering::SeqCst) {
            return Err("engine stopped".into());
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.waiting.lock().unwrap().insert(id, tx);
        self.busy.fetch_add(1, Ordering::SeqCst);
        let mut msg = json!({ "jsonrpc": "2.0", "id": id, "method": method });
        if !params.is_null() {
            msg["params"] = params;
        }
        let out = self.write(&msg).and_then(|_| rx.recv_timeout(timeout).map_err(|_| "엔진이 답하지 않아요".to_string()));
        self.waiting.lock().unwrap().remove(&id);
        self.busy.fetch_sub(1, Ordering::SeqCst);
        *self.last_used.lock().unwrap() = Instant::now();
        out
    }

    fn handshake(&self) -> Result<Value, String> {
        let init = self.request(
            "initialize",
            json!({ "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "prism", "version": env!("CARGO_PKG_VERSION") } }),
            INIT_TIMEOUT,
        )?;
        let result = init.get("result").cloned().ok_or_else(|| format!("엔진 시작 실패: {}", init.get("error").cloned().unwrap_or_default()))?;
        self.write(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))?;
        Ok(result)
    }

    fn stop(&self) {
        self.dead.store(true, Ordering::SeqCst);
        let mut c = self.child.lock().unwrap();
        #[cfg(unix)]
        unsafe {
            // the whole group: anything the engine started goes with it
            libc_kill(-(c.id() as i32));
        }
        let _ = crate::sys::kill_tree(&mut c);
        let _ = c.wait();
    }
}

#[cfg(unix)]
unsafe fn libc_kill(pgid: i32) {
    unsafe extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    unsafe {
        kill(pgid, 9);
    }
}

/// What one engine (by CLI) answered to the start-up questions, and the roots it was started with
/// (its `initialize` instructions name them; they're rewritten for each member).
#[derive(Clone)]
struct Said {
    answers: HashMap<String, Value>,
    reads: Vec<String>,
    writes: Vec<String>,
}

#[derive(Default)]
pub struct Engines {
    procs: Mutex<HashMap<Key, Arc<Proc>>>,
    /// keys that had an engine stopped while idle: their next start tells the member
    napped: Mutex<std::collections::HashSet<Key>>,
    said: Mutex<HashMap<String, Said>>,
    /// one start at a time per member+engine
    starting: Mutex<HashMap<Key, Arc<Mutex<()>>>>,
    reaper: OnceLock<()>,
    /// tests: engine name → CLI
    clis: Mutex<HashMap<String, PathBuf>>,
}

pub fn engines() -> &'static Engines {
    static E: OnceLock<Engines> = OnceLock::new();
    E.get_or_init(Engines::default)
}

/// The engine instructions' "Files: only these folders may be read: [..]; written: [..]" part,
/// for other roots. The engine lists every read root, then every write root, as it resolved them.
fn rewrite_roots(text: &str, reads: &[String], writes: &[String]) -> String {
    const HEAD: &str = "Files: only these folders may be read: ";
    const TAIL: &str = "(any other path is refused).";
    let (Some(a), Some(b)) = (text.find(HEAD), text.find(TAIL)) else { return text.to_string() };
    if b < a {
        return text.to_string();
    }
    let canon = |p: &String| std::fs::canonicalize(p).map(|c| c.to_string_lossy().into_owned()).unwrap_or_else(|_| p.clone());
    let all: Vec<String> = reads.iter().chain(writes).map(canon).collect();
    let w: Vec<String> = writes.iter().map(canon).collect();
    format!("{}{HEAD}{}; written: {} {TAIL}{}", &text[..a], json!(all), json!(w), &text[b + TAIL.len()..])
}

impl Engines {
    fn start_reaper(&'static self) {
        self.reaper.get_or_init(|| {
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(30));
                self.reap(IDLE);
            });
        });
    }

    /// Stops engines idle longer than `after` (and forgets dead ones).
    fn reap(&self, after: Duration) {
        let gone: Vec<(Key, Arc<Proc>)> = {
            let mut procs = self.procs.lock().unwrap();
            let keys: Vec<Key> = procs
                .iter()
                .filter(|(_, p)| p.dead.load(Ordering::SeqCst) || (p.busy.load(Ordering::SeqCst) == 0 && p.last_used.lock().unwrap().elapsed() > after))
                .map(|(k, _)| k.clone())
                .collect();
            keys.into_iter().filter_map(|k| procs.remove(&k).map(|p| (k, p))).collect()
        };
        for (k, p) in gone {
            if !p.dead.load(Ordering::SeqCst) {
                self.napped.lock().unwrap().insert(k);
            }
            p.stop();
        }
    }

    /// A member's session ended: its engines go too.
    pub fn stop_member(&self, project: &str, agent: &str) {
        let gone: Vec<Arc<Proc>> = {
            let mut procs = self.procs.lock().unwrap();
            let keys: Vec<Key> = procs.keys().filter(|k| k.member() == (project, agent)).cloned().collect();
            keys.into_iter().filter_map(|k| procs.remove(&k)).collect()
        };
        self.napped.lock().unwrap().retain(|k| k.member() != (project, agent));
        for p in gone {
            p.stop();
        }
    }

    /// The app is closing: every engine goes.
    pub fn stop_all(&self) {
        let gone: Vec<Arc<Proc>> = self.procs.lock().unwrap().drain().map(|(_, p)| p).collect();
        for p in gone {
            p.stop();
        }
    }

    /// How many engine processes are running now.
    #[cfg(test)]
    pub fn running(&self) -> usize {
        self.procs.lock().unwrap().values().filter(|p| !p.dead.load(Ordering::SeqCst)).count()
    }

    /// The member's engine, started if needed. `true` with it when it was just started after an idle stop.
    fn proc_for(&'static self, key: &Key) -> Result<(Arc<Proc>, bool), String> {
        self.start_reaper();
        if let Some(p) = self.procs.lock().unwrap().get(key).filter(|p| !p.dead.load(Ordering::SeqCst)) {
            return Ok((p.clone(), false));
        }
        let gate = self.starting.lock().unwrap().entry(key.clone()).or_default().clone();
        let _one = gate.lock().unwrap();
        if let Some(p) = self.procs.lock().unwrap().get(key).filter(|p| !p.dead.load(Ordering::SeqCst)) {
            return Ok((p.clone(), false));
        }
        let cli = self.clis.lock().unwrap().get(&key.engine).cloned().or_else(|| cli_of(&key.engine)).ok_or_else(|| format!("{} 엔진이 설치돼 있지 않아요", key.engine))?;
        let p = Proc::spawn(&cli, key)?;
        let init = match p.handshake() {
            Ok(v) => v,
            Err(e) => {
                p.stop();
                return Err(e);
            }
        };
        self.remember(&key.engine, "initialize", json!({ "result": init }), key);
        self.procs.lock().unwrap().insert(key.clone(), p.clone());
        let woke = self.napped.lock().unwrap().remove(key);
        Ok((p, woke))
    }

    fn remember(&self, engine: &str, method: &str, answer: Value, key: &Key) {
        let mut said = self.said.lock().unwrap();
        let s = said.entry(engine.to_string()).or_insert_with(|| Said { answers: HashMap::new(), reads: key.reads.clone(), writes: key.writes.clone() });
        if method == "initialize" {
            s.reads = key.reads.clone();
            s.writes = key.writes.clone();
        }
        s.answers.insert(method.to_string(), answer);
    }

    /// An answer said before, fitted to this member (its roots in the instructions).
    fn recall(&self, key: &Key, method: &str, params: &Value) -> Option<Value> {
        let said = self.said.lock().unwrap();
        let s = said.get(&key.engine)?;
        let mut v = s.answers.get(method)?.clone();
        if method == "initialize" {
            let r = v.get_mut("result")?;
            if let Some(t) = r.get("instructions").and_then(Value::as_str) {
                r["instructions"] = json!(rewrite_roots(t, &key.reads, &key.writes));
            }
            if let Some(pv) = params.get("protocolVersion") {
                r["protocolVersion"] = pv.clone();
            }
        }
        Some(v)
    }

    /// One JSON-RPC message from a member's CLI. Returns the response body, or None for notifications.
    pub fn handle(&'static self, key: &Key, req: &Value) -> Option<Value> {
        let id = req.get("id").cloned()?;
        let method = req.get("method").and_then(Value::as_str).unwrap_or("");
        let params = req.get("params").cloned().unwrap_or(Value::Null);
        let reply = |body: Value| {
            let mut out = json!({ "jsonrpc": "2.0", "id": id.clone() });
            if let Some(e) = body.get("error") {
                out["error"] = e.clone();
            } else {
                out["result"] = body.get("result").cloned().unwrap_or(json!({}));
            }
            out
        };
        if method == "ping" {
            return Some(reply(json!({ "result": {} })));
        }
        if STATIC.contains(&method) {
            if let Some(v) = self.recall(key, method, &params) {
                return Some(reply(v));
            }
        }
        let answer = self.proc_for(key).and_then(|(p, woke)| {
            if method == "initialize" {
                return Ok((self.recall(key, method, &params).unwrap_or(json!({ "result": {} })), false));
            }
            let v = p.request(method, params.clone(), CALL_TIMEOUT)?;
            Ok((v, woke))
        });
        Some(match answer {
            Ok((mut v, woke)) => {
                if STATIC.contains(&method) && v.get("result").is_some() {
                    self.remember(&key.engine, method, v.clone(), key);
                }
                if woke && method == "tools/call" {
                    if let Some(c) = v.pointer_mut("/result/content").and_then(Value::as_array_mut) {
                        c.insert(0, json!({ "type": "text", "text": RESTARTED_NOTE }));
                    }
                }
                reply(v)
            }
            Err(e) if method == "tools/call" => reply(json!({ "result": { "content": [{ "type": "text", "text": e }], "isError": true } })),
            Err(e) => reply(json!({ "error": { "code": -32603, "message": e } })),
        })
    }
}

/// The engine names an MCP URL may ask for.
pub fn known(engine: &str) -> bool {
    matches!(engine, "figcraft" | "deckcraft")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roots_in_the_instructions_are_the_members_own() {
        let t = r#"Coordinates... Files: only these folders may be read: ["/a","/b","/a"]; written: ["/a"] (any other path is refused). More."#;
        let out = rewrite_roots(t, &["/nope-x".into(), "/nope-y".into()], &["/nope-x".into()]);
        assert_eq!(out, r#"Coordinates... Files: only these folders may be read: ["/nope-x","/nope-y","/nope-x"]; written: ["/nope-x"] (any other path is refused). More."#);
        // no such sentence (deckcraft): unchanged
        assert_eq!(rewrite_roots("DeckCraft is a presentation app.", &["/x".into()], &[]), "DeckCraft is a presentation app.");
    }

    #[test]
    fn engine_args_keep_each_members_roots() {
        let k = Key { engine: "figcraft".into(), project: "p".into(), agent: "w1".into(), reads: vec!["/w".into(), "/r".into()], writes: vec!["/w".into()] };
        assert_eq!(k.args(), ["mcp", "--automation-read-root", "/w", "--automation-read-root", "/r", "--automation-write-root", "/w"]);
    }

    /// A fake engine (a shell script speaking line JSON-RPC): started only on the first real call,
    /// one per member, stopped when idle, and start-up questions answered without it afterwards.
    #[cfg(unix)]
    #[test]
    fn starts_on_first_call_and_stops_when_idle() {
        let dir = std::env::temp_dir().join(format!("prism-eng-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("fake.py");
        std::fs::write(
            &script,
            r#"import sys, json, os
for line in sys.stdin:
    m = json.loads(line)
    if "id" not in m: continue
    meth = m["method"]
    if meth == "initialize": r = {"capabilities": {"tools": {}}, "instructions": "Fake."}
    elif meth == "tools/list": r = {"tools": [{"name": "x"}]}
    else: r = {"content": [{"type": "text", "text": "pid %d" % os.getpid()}]}
    print(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": r}), flush=True)
"#,
        )
        .unwrap();
        let wt = dir.join("wt");
        let key = |agent: &str| Key { engine: "fake".into(), project: "p".into(), agent: agent.into(), reads: vec![wt.to_string_lossy().into()], writes: vec![wt.to_string_lossy().into()] };
        let e: &'static Engines = Box::leak(Box::default());
        let wrapper = dir.join("fake-cli");
        std::fs::write(&wrapper, format!("#!/bin/sh\nexec python3 {} \"$@\"\n", script.display())).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
        e.clis.lock().unwrap().insert("fake".into(), wrapper);
        let call = |k: &Key| e.handle(k, &json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": { "name": "x" } })).unwrap();
        let a = key("w1");
        let b = key("w2");
        assert_eq!(e.running(), 0, "nothing runs before a call");
        let ra = call(&a);
        let rb = call(&b);
        assert_eq!(ra["id"], 7);
        assert_eq!(e.running(), 2, "one engine per member that uses it");
        assert_ne!(ra["result"]["content"][0]["text"], rb["result"]["content"][0]["text"], "members never share a process");
        assert_eq!(call(&a)["result"]["content"][0]["text"], ra["result"]["content"][0]["text"], "the same member keeps its engine");
        // start-up questions for a member without an engine: answered from memory, nothing started
        let c = key("w3");
        let init = e.handle(&c, &json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26" } })).unwrap();
        assert_eq!(init["result"]["instructions"], "Fake.");
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(e.running(), 2);
        // idle: stopped
        e.reap(Duration::ZERO);
        assert_eq!(e.running(), 0);
        assert!(e.napped.lock().unwrap().contains(&a));
        e.stop_member("p", "w1");
        assert!(!e.napped.lock().unwrap().contains(&a));
        // b was stopped while idle: its next call starts a new engine and says so
        let again = call(&b);
        assert_eq!(again["result"]["content"][0]["text"], RESTARTED_NOTE);
        assert_eq!(e.running(), 1);
        e.stop_member("p", "w2");
        assert_eq!(e.running(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// With the installed figcraft (`cargo test real_figcraft -- --ignored`): two members, two
    /// folders, each sees only its own.
    #[test]
    #[ignore]
    fn real_figcraft() {
        let e: &'static Engines = Box::leak(Box::default());
        let base = std::env::temp_dir().join(format!("prism-real-{}", uuid::Uuid::new_v4()));
        let key = |a: &str| {
            let d = base.join(a).to_string_lossy().into_owned();
            Key { engine: "figcraft".into(), project: "p".into(), agent: a.into(), reads: vec![d.clone()], writes: vec![d] }
        };
        let (a, b) = (key("w1"), key("w2"));
        let t = std::time::Instant::now();
        let init = e.handle(&a, &json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} })).unwrap();
        println!("init {:?}: {}", t.elapsed(), &init["result"]["instructions"].as_str().unwrap()[..80]);
        let tools = e.handle(&a, &json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).unwrap();
        println!("tools {}", tools["result"]["tools"].as_array().unwrap().len());
        let ib = e.handle(&b, &json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} })).unwrap();
        assert!(ib["result"]["instructions"].as_str().unwrap().contains("/w2\""), "{}", ib["result"]["instructions"]);
        assert_eq!(e.running(), 1, "w2 asked only start-up questions");
        let call = e.handle(&b, &json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "inspect_document", "arguments": {} } })).unwrap();
        println!("call {}", call.to_string().chars().take(200).collect::<String>());
        assert!(call["result"].is_object());
        assert_eq!(e.running(), 2);
        e.stop_all();
        assert_eq!(e.running(), 0);
    }
}
