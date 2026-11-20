//! Structured (terminal-less) agents. Instead of a TUI in a PTY, the CLI runs in a machine
//! mode and Prism reads typed events — so the UI can show a clean conversation, tool steps and
//! approval cards without ever exposing a terminal.
//!
//!   Claude Code   `claude -p --input-format stream-json --output-format stream-json`
//!                 (one long-lived process; approvals via --permission-prompt-tool → our MCP)
//!   Codex         `codex exec --json …` per turn, then `codex exec resume <thread> …`
//!                 (messages that arrive mid-turn are queued for the next turn)

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::{json, Value};

use crate::sys;

/// What a driver reports back to the broker.
pub enum Event {
    /// session id the CLI assigned/confirmed
    Started(String),
    TurnStart,
    /// a complete assistant message
    Text(String),
    /// a tool the agent decided to use
    Tool { name: String, input: Value },
    TurnEnd { result: Option<String>, cost: Option<f64>, error: bool },
    Exit(Option<i32>),
}

pub type Sink = Arc<dyn Fn(Event) + Send + Sync>;

pub trait Driver: Send + Sync {
    /// Send the user's (or a manager's) message as the next turn.
    fn send(&self, text: &str) -> Result<(), String>;
    fn kill(&self);
}

/// One line in an agent's conversation, as the UI shows it.
#[derive(Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub at: u64,
    /// "in" (message to the agent) | "text" (agent said) | "tool" (agent did) | "done" | "error"
    pub kind: String,
    pub text: String,
}

// ── process plumbing ──────────────────────────────────

pub struct Spawn {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub env: Vec<(String, String)>,
}

fn spawn(s: &Spawn) -> Result<Child, String> {
    let mut cmd = sys::command(&s.program);
    cmd.args(&s.args).current_dir(&s.cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // run as a top-level session even if Prism itself was launched from inside one
    for (k, _) in std::env::vars() {
        // (and never let Antigravity fall back to a billed API key)
        if k == "CLAUDECODE" || k.starts_with("CLAUDE_CODE_") || k == "CLAUDE_PID" || k == "CLAUDE_EFFORT" || k == "GEMINI_API_KEY" || k == "GOOGLE_API_KEY" {
            cmd.env_remove(&k);
        }
    }
    for (k, v) in &s.env {
        cmd.env(k, v);
    }
    cmd.spawn().map_err(|e| format!("{} 실행 실패: {e}", s.program))
}

// ── Claude Code (stream-json) ─────────────────────────

pub struct Claude {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Child>,
}

impl Claude {
    pub fn start(s: Spawn, sink: Sink) -> Result<Arc<Self>, String> {
        let mut child = spawn(&s)?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take();
        let me = Arc::new(Self { stdin: Mutex::new(stdin), child: Mutex::new(child) });

        // stderr: keep the tail for error reporting
        let tail = Arc::new(Mutex::new(String::new()));
        if let Some(err) = stderr {
            let tail = tail.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(err).lines().map_while(Result::ok) {
                    let mut t = tail.lock().unwrap();
                    t.push_str(&line);
                    t.push('\n');
                    if t.len() > 4000 {
                        let cut = t.len() - 4000;
                        t.drain(..cut);
                    }
                }
            });
        }

        let weak = Arc::downgrade(&me);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                match v.get("type").and_then(Value::as_str) {
                    Some("system") if v.get("subtype").and_then(Value::as_str) == Some("init") => {
                        if let Some(id) = v.get("session_id").and_then(Value::as_str) {
                            sink(Event::Started(id.into()));
                        }
                    }
                    Some("assistant") => {
                        for block in v.pointer("/message/content").and_then(Value::as_array).into_iter().flatten() {
                            match block.get("type").and_then(Value::as_str) {
                                Some("text") => {
                                    let t = block.get("text").and_then(Value::as_str).unwrap_or("").trim();
                                    if !t.is_empty() {
                                        sink(Event::Text(t.into()));
                                    }
                                }
                                Some("tool_use") => sink(Event::Tool {
                                    name: block.get("name").and_then(Value::as_str).unwrap_or("").into(),
                                    input: block.get("input").cloned().unwrap_or(Value::Null),
                                }),
                                _ => {}
                            }
                        }
                    }
                    Some("result") => sink(Event::TurnEnd {
                        result: v.get("result").and_then(Value::as_str).map(String::from),
                        cost: v.get("total_cost_usd").and_then(Value::as_f64),
                        error: v.get("is_error").and_then(Value::as_bool).unwrap_or(false),
                    }),
                    _ => {}
                }
            }
            let code = weak.upgrade().and_then(|m| m.child.lock().unwrap().wait().ok()).and_then(|s| s.code());
            if code.is_some_and(|c| c != 0) {
                let t = tail.lock().unwrap().clone();
                if !t.trim().is_empty() {
                    sink(Event::Text(format!("⚠ {}", t.trim().lines().last().unwrap_or(""))));
                }
            }
            sink(Event::Exit(code));
        });
        Ok(me)
    }
}

impl Driver for Claude {
    fn send(&self, text: &str) -> Result<(), String> {
        let mut g = self.stdin.lock().unwrap();
        let w = g.as_mut().ok_or("에이전트가 종료됐어요")?;
        let msg = json!({ "type": "user", "message": { "role": "user", "content": text } });
        writeln!(w, "{msg}").map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())
    }

    fn kill(&self) {
        self.stdin.lock().unwrap().take(); // EOF lets it finish cleanly
        let _ = self.child.lock().unwrap().kill();
    }
}

// ── Codex (exec --json, one process per turn) ─────────

pub struct Codex {
    program: String,
    first_args: Mutex<Vec<String>>,
    resume_args: Mutex<Vec<String>>,
    /// models to try when the plan doesn't allow the chosen one
    fallbacks: Mutex<std::collections::VecDeque<String>>,
    current: Mutex<Option<String>>,
    cwd: String,
    env: Vec<(String, String)>,
    sink: Sink,
    thread: Mutex<Option<String>>,
    queue: Mutex<std::collections::VecDeque<String>>,
    running: Mutex<Option<Child>>,
    killed: std::sync::atomic::AtomicBool,
}

impl Codex {
    pub fn new(s: Spawn, resume_args: Vec<String>, fallbacks: Vec<String>, sink: Sink) -> Arc<Self> {
        Arc::new(Self {
            program: s.program,
            first_args: Mutex::new(s.args),
            resume_args: Mutex::new(resume_args),
            fallbacks: Mutex::new(fallbacks.into()),
            current: Mutex::new(None),
            cwd: s.cwd,
            env: s.env,
            sink,
            thread: Mutex::new(None),
            queue: Mutex::new(Default::default()),
            running: Mutex::new(None),
            killed: Default::default(),
        })
    }

    /// Start the next queued turn if nothing is running.
    fn pump(self: &Arc<Self>) {
        let mut running = self.running.lock().unwrap();
        if running.is_some() || self.killed.load(std::sync::atomic::Ordering::Relaxed) {
            return;
        }
        let Some(text) = self.queue.lock().unwrap().pop_front() else { return };
        *self.current.lock().unwrap() = Some(text.clone());
        let args = match self.thread.lock().unwrap().clone() {
            Some(id) => [vec!["exec".to_string(), "resume".to_string()], self.resume_args.lock().unwrap().clone(), vec![id, text]].concat(),
            None => [vec!["exec".to_string()], self.first_args.lock().unwrap().clone(), vec![text]].concat(),
        };
        let spawned = spawn(&Spawn { program: self.program.clone(), args, cwd: self.cwd.clone(), env: self.env.clone() });
        let mut child = match spawned {
            Ok(c) => c,
            Err(e) => {
                (self.sink)(Event::TurnEnd { result: Some(e), cost: None, error: true });
                return;
            }
        };
        drop(child.stdin.take());
        let stdout = child.stdout.take();
        *running = Some(child);
        drop(running);
        (self.sink)(Event::TurnStart);

        let me = self.clone();
        std::thread::spawn(move || {
            let mut last_text: Option<String> = None;
            let mut ended = false;
            // stream events as they arrive
            for line in stdout.map(BufReader::new).into_iter().flat_map(|r| r.lines().map_while(Result::ok)) {
                let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                let s = |p: &str| v.pointer(p).and_then(Value::as_str).map(String::from);
                match v.get("type").and_then(Value::as_str) {
                    Some("thread.started") => {
                        if let Some(id) = s("/thread_id") {
                            *me.thread.lock().unwrap() = Some(id.clone());
                            (me.sink)(Event::Started(id));
                        }
                    }
                    Some("item.completed") => match v.pointer("/item/type").and_then(Value::as_str) {
                        Some("agent_message") => {
                            if let Some(t) = s("/item/text").filter(|t| !t.trim().is_empty()) {
                                last_text = Some(t.clone());
                                (me.sink)(Event::Text(t));
                            }
                        }
                        Some("command_execution") => (me.sink)(Event::Tool { name: "shell".into(), input: json!({ "command": s("/item/command").unwrap_or_default() }) }),
                        Some("file_change") => {
                            let path = v.pointer("/item/changes/0/path").and_then(Value::as_str).unwrap_or("").to_string();
                            (me.sink)(Event::Tool { name: "apply_patch".into(), input: json!({ "file_path": path }) })
                        }
                        Some("web_search") => (me.sink)(Event::Tool { name: "WebSearch".into(), input: json!({ "query": s("/item/query").unwrap_or_default() }) }),
                        _ => {}
                    },
                    Some("turn.completed") => {
                        ended = true;
                        (me.sink)(Event::TurnEnd { result: last_text.take(), cost: None, error: false });
                    }
                    Some("turn.failed") | Some("error") => {
                        if !ended {
                            ended = true;
                            let msg = s("/error/message").or_else(|| s("/message")).unwrap_or_else(|| "알 수 없는 오류".into());
                            // the plan doesn't include this model: switch to the next one and retry
                            if msg.contains("not supported") && me.switch_model() {
                                let next = me.model().unwrap_or_default();
                                (me.sink)(Event::Text(format!("⚠ 지금 요금제에서 쓸 수 없는 모델이라 {next}(으)로 바꿔서 다시 할게요.")));
                                if let Some(t) = me.current.lock().unwrap().clone() {
                                    me.queue.lock().unwrap().push_front(t);
                                }
                                continue;
                            }
                            (me.sink)(Event::TurnEnd { result: Some(msg), cost: None, error: true });
                        }
                    }
                    _ => {}
                }
            }
            if let Some(mut c) = me.running.lock().unwrap().take() {
                let _ = c.wait();
            }
            if !ended && !me.killed.load(std::sync::atomic::Ordering::Relaxed) {
                (me.sink)(Event::TurnEnd { result: Some("Codex가 응답 없이 끝났어요".into()), cost: None, error: true });
            }
            me.pump();
        });
    }
}

impl Codex {
    /// Pick up an earlier conversation: the next turn runs `exec resume <thread>`.
    pub fn continue_thread(&self, thread: &str) {
        *self.thread.lock().unwrap() = Some(thread.to_string());
    }

    fn model(&self) -> Option<String> {
        let a = self.first_args.lock().unwrap();
        a.iter().position(|x| x == "-m").and_then(|i| a.get(i + 1).cloned())
    }

    /// Use the next fallback model for every later turn. False when none are left.
    fn switch_model(&self) -> bool {
        let Some(next) = self.fallbacks.lock().unwrap().pop_front() else { return false };
        for args in [&self.first_args, &self.resume_args] {
            let mut a = args.lock().unwrap();
            match a.iter().position(|x| x == "-m") {
                Some(i) if i + 1 < a.len() => a[i + 1] = next.clone(),
                _ => a.extend(["-m".to_string(), next.clone()]),
            }
        }
        true
    }
}

/// `Arc<Codex>` is the driver (it needs to re-arm itself between turns).
pub struct CodexHandle(pub Arc<Codex>);

impl Driver for CodexHandle {
    fn send(&self, text: &str) -> Result<(), String> {
        if self.0.killed.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("에이전트가 종료됐어요".into());
        }
        self.0.queue.lock().unwrap().push_back(text.to_string());
        self.0.pump();
        Ok(())
    }

    fn kill(&self) {
        self.0.killed.store(true, std::sync::atomic::Ordering::Relaxed);
        self.0.queue.lock().unwrap().clear();
        if let Some(c) = self.0.running.lock().unwrap().as_mut() {
            let _ = c.kill();
        }
        (self.0.sink)(Event::Exit(Some(0)));
    }
}

// ── Antigravity (ACP over stdio) ──────────────────────

/// What an ACP session needs at `session/new`.
pub struct AcpSetup {
    pub cwd: String,
    pub system: String,
    /// stdio MCP server: our own executable in `--mcp-bridge <url>` mode
    pub bridge: (String, Vec<String>),
    pub model: String,
    /// load this earlier session instead of creating one
    pub resume: Option<String>,
}

/// Blocks until the person answers an approval card; true = allow.
pub type Ask = Arc<dyn Fn(String, Value) -> bool + Send + Sync>;

pub struct Acp {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Child>,
    session: Mutex<Option<String>>,
    busy: std::sync::atomic::AtomicBool,
    queue: Mutex<std::collections::VecDeque<String>>,
    next_id: std::sync::atomic::AtomicU64,
    sink: Sink,
}

impl Acp {
    fn write(&self, msg: &Value) -> Result<(), String> {
        let mut g = self.stdin.lock().unwrap();
        let w = g.as_mut().ok_or("에이전트가 종료됐어요")?;
        writeln!(w, "{msg}").map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())
    }

    fn request(&self, method: &str, params: Value) -> Result<u64, String> {
        let id = self.next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.write(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        Ok(id)
    }

    /// Send the next queued prompt when the session is ready and idle.
    fn pump(&self) {
        let Some(sid) = self.session.lock().unwrap().clone() else { return };
        if self.busy.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        let Some(text) = self.queue.lock().unwrap().pop_front() else {
            self.busy.store(false, std::sync::atomic::Ordering::SeqCst);
            return;
        };
        (self.sink)(Event::TurnStart);
        if let Err(e) = self.request("session/prompt", json!({ "sessionId": sid, "prompt": [{ "type": "text", "text": text }] })) {
            self.busy.store(false, std::sync::atomic::Ordering::SeqCst);
            (self.sink)(Event::TurnEnd { result: Some(e), cost: None, error: true });
        }
    }

    pub fn start(s: Spawn, setup: AcpSetup, sink: Sink, ask: Ask) -> Result<Arc<Self>, String> {
        let mut child = spawn(&s)?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let me = Arc::new(Self {
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            session: Mutex::new(None),
            busy: Default::default(),
            queue: Mutex::new(Default::default()),
            next_id: std::sync::atomic::AtomicU64::new(1),
            sink,
        });
        let init = me.request(
            "initialize",
            json!({ "protocolVersion": 1, "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false }, "terminal": false } }),
        )?;

        let weak = Arc::downgrade(&me);
        std::thread::spawn(move || {
            let mut new_session_id: Option<u64> = None;
            let mut loading = setup.resume.is_some(); // replayed history while loading: don't re-show it
            let mut text = String::new();
            let flush = |text: &mut String, me: &Acp| {
                let t = text.trim().to_string();
                text.clear();
                if !t.is_empty() {
                    (me.sink)(Event::Text(t.clone()));
                }
                t
            };
            let mut last_text = String::new();
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Some(me) = weak.upgrade() else { break };
                let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                let id = v.get("id").and_then(Value::as_u64);
                let method = v.get("method").and_then(Value::as_str).map(String::from);
                match (id, method.as_deref()) {
                    // our requests' responses
                    (Some(id), None) => {
                        if let Some(err) = v.get("error") {
                            let msg = err.get("message").and_then(Value::as_str).unwrap_or("오류").to_string();
                            let hint = if msg.to_lowercase().contains("auth") { " (계정에서 Google 로그인이 필요해요)" } else { "" };
                            me.busy.store(false, std::sync::atomic::Ordering::SeqCst);
                            (me.sink)(Event::TurnEnd { result: Some(format!("{msg}{hint}")), cost: None, error: true });
                            continue;
                        }
                        if id == init {
                            let mut params = json!({
                                "cwd": setup.cwd,
                                "mcpServers": [{ "name": "prism", "command": setup.bridge.0, "args": setup.bridge.1, "env": [] }],
                                "_meta": { "antigravity": { "systemPrompt": { "append": setup.system }, "disabledTools": ["run_workflow"] } },
                            });
                            let method = match &setup.resume {
                                Some(sid) => {
                                    params["sessionId"] = json!(sid);
                                    "session/load"
                                }
                                None => "session/new",
                            };
                            new_session_id = me.request(method, params).ok();
                        } else if Some(id) == new_session_id {
                            // session/new answers with the id; session/load answers without one
                            loading = false;
                            let sid = v.pointer("/result/sessionId").and_then(Value::as_str).map(String::from).or_else(|| setup.resume.clone());
                            if let Some(sid) = sid.as_deref() {
                                *me.session.lock().unwrap() = Some(sid.to_string());
                                (me.sink)(Event::Started(sid.to_string()));
                                if !setup.model.is_empty() {
                                    let _ = me.request("session/set_model", json!({ "sessionId": sid, "modelId": setup.model }));
                                }
                                me.pump();
                            }
                        } else if v.pointer("/result/stopReason").is_some() {
                            // a prompt turn finished
                            let t = flush(&mut text, &me);
                            if !t.is_empty() {
                                last_text = t;
                            }
                            me.busy.store(false, std::sync::atomic::Ordering::SeqCst);
                            (me.sink)(Event::TurnEnd { result: Some(std::mem::take(&mut last_text)), cost: None, error: false });
                            me.pump();
                        }
                    }
                    // streaming updates (skipped while session/load replays old history)
                    (None, Some("session/update")) if loading => {}
                    (None, Some("session/update")) => {
                        let u = v.pointer("/params/update").cloned().unwrap_or(Value::Null);
                        match u.get("sessionUpdate").and_then(Value::as_str) {
                            Some("agent_message_chunk") => {
                                if let Some(t) = u.pointer("/content/text").and_then(Value::as_str) {
                                    text.push_str(t);
                                }
                            }
                            Some("tool_call") => {
                                let t = flush(&mut text, &me);
                                if !t.is_empty() {
                                    last_text = t;
                                }
                                let title = u.get("title").and_then(Value::as_str).unwrap_or("작업").to_string();
                                if !title.to_lowercase().contains("prism") {
                                    (me.sink)(Event::Tool { name: title, input: u.get("rawInput").cloned().unwrap_or(Value::Null) });
                                }
                            }
                            _ => {}
                        }
                    }
                    // the agent asks us something
                    (Some(rid), Some("session/request_permission")) => {
                        let params = v.get("params").cloned().unwrap_or(Value::Null);
                        let title = params.pointer("/toolCall/title").and_then(Value::as_str).unwrap_or("도구 사용").to_string();
                        let raw = params.pointer("/toolCall/rawInput").cloned().unwrap_or(Value::Null);
                        let options = params.get("options").and_then(Value::as_array).cloned().unwrap_or_default();
                        let pick = |kinds: &[&str]| {
                            options.iter().find(|o| kinds.contains(&o.get("kind").and_then(Value::as_str).unwrap_or(""))).and_then(|o| o.get("optionId").cloned())
                        };
                        let (allow, reject) = (pick(&["allow_once", "allow_always"]), pick(&["reject_once", "reject_always"]));
                        let ask = ask.clone();
                        let me2 = me.clone();
                        std::thread::spawn(move || {
                            let ok = ask(title, raw);
                            let outcome = match (ok, allow, reject) {
                                (true, Some(o), _) | (false, _, Some(o)) => json!({ "outcome": "selected", "optionId": o }),
                                _ => json!({ "outcome": "cancelled" }),
                            };
                            let _ = me2.write(&json!({ "jsonrpc": "2.0", "id": rid, "result": { "outcome": outcome } }));
                        });
                    }
                    (Some(rid), Some(_)) => {
                        let _ = me.write(&json!({ "jsonrpc": "2.0", "id": rid, "error": { "code": -32601, "message": "not supported" } }));
                    }
                    _ => {}
                }
            }
            let code = weak.upgrade().and_then(|m| m.child.lock().unwrap().wait().ok()).and_then(|s| s.code());
            if let Some(me) = weak.upgrade() {
                (me.sink)(Event::Exit(code));
            }
        });
        Ok(me)
    }
}

impl Driver for Acp {
    fn send(&self, text: &str) -> Result<(), String> {
        if self.stdin.lock().unwrap().is_none() {
            return Err("에이전트가 종료됐어요".into());
        }
        self.queue.lock().unwrap().push_back(text.to_string());
        self.pump();
        Ok(())
    }

    fn kill(&self) {
        self.stdin.lock().unwrap().take();
        let _ = self.child.lock().unwrap().kill();
    }
}

// ── stdio ↔ HTTP MCP bridge ───────────────────────────

/// `prism --mcp-bridge <url>`: a stdio MCP server that forwards every message to Prism's
/// HTTP MCP endpoint (for CLIs that only speak stdio MCP, like Antigravity's ACP mode).
pub fn run_mcp_bridge(url: &str) {
    let client = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(620)).build().unwrap_or_default();
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    for line in stdin.lock().lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        let res = client.post(url).header("Content-Type", "application/json").header("Accept", "application/json").body(line).send();
        if let Ok(r) = res {
            if let Ok(body) = r.text() {
                if !body.trim().is_empty() {
                    let _ = writeln!(out, "{}", body.trim());
                    let _ = out.flush();
                }
            }
        }
    }
}
