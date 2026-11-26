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
use std::sync::{Arc, Mutex, Weak};

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
    /// what the agent is thinking right now (reasoning it streams before acting)
    Thought(String),
    /// a tool the agent decided to use
    Tool { name: String, input: Value },
    TurnEnd { result: Option<String>, cost: Option<f64>, error: bool },
    Exit(Option<i32>),
    /// how many tokens the conversation held in its last request (its size right now)
    Context(u64),
    /// the tokens one turn used, for one model (`model` "" = the member's own model). `context` is
    /// the largest conversation a request of the turn sent, when the CLI reports only the turn's total
    Tokens { model: String, input: u64, output: u64, cache_read: u64, cache_write: u64, context: u64 },
}

/// Where a driver reports. Drivers may call it from inside `send`/`kill`, i.e. while their caller
/// holds locks, so a sink must never block or take those locks itself (TeamManager's queues the
/// event for its own thread).
pub type Sink = Arc<dyn Fn(Event) + Send + Sync>;

pub trait Driver: Send + Sync {
    /// Send the user's (or a manager's) message as the next turn.
    fn send(&self, text: &str) -> Result<(), String>;
    fn kill(&self);
    /// Ask the agent to stop the turn it's on (best effort; `kill` follows when it doesn't).
    fn cancel(&self) {}
}

/// The last few KB of a child's stderr, plus a signal for when the drain has seen its end.
struct StderrTail {
    text: Arc<Mutex<String>>,
    /// disconnects (returns at once) when the drain thread has finished reading stderr
    done: std::sync::mpsc::Receiver<()>,
}

/// Keeps the last few KB of a child's stderr. Every piped stderr must be drained: a CLI that
/// logs more than the pipe holds (~64 KB) otherwise blocks on its next write and goes silent
/// mid-turn — no output, no exit, a turn that never ends.
fn drain_stderr(err: Option<std::process::ChildStderr>) -> StderrTail {
    let text = Arc::new(Mutex::new(String::new()));
    let (done_tx, done) = std::sync::mpsc::channel::<()>();
    if let Some(err) = err {
        let text = text.clone();
        std::thread::spawn(move || {
            let _done_tx = done_tx; // dropped when the stream ends
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                let mut t = text.lock().unwrap();
                t.push_str(&line);
                t.push('\n');
                if t.len() > 4000 {
                    let mut cut = t.len() - 4000;
                    while !t.is_char_boundary(cut) {
                        cut += 1;
                    }
                    t.drain(..cut);
                }
            }
        });
    }
    StderrTail { text, done }
}

/// How long to wait for a child's stderr to finish before giving up on its last words
/// (a grandchild holding the pipe open must not hold up the turn's end).
const STDERR_SETTLE: std::time::Duration = std::time::Duration::from_secs(2);

/// The last non-empty stderr line, for "why did it stop". Call only once the process has ended:
/// it first waits (briefly) for stderr to be fully read, so the final message isn't missing.
fn last_line(tail: &StderrTail) -> Option<String> {
    let _ = tail.done.recv_timeout(STDERR_SETTLE);
    tail.text.lock().unwrap().lines().rev().map(str::trim).find(|l| !l.is_empty()).map(String::from)
}

/// Why a process ended mid-turn, in plain words.
fn exit_reason(who: &str, code: Option<i32>, tail: &StderrTail) -> String {
    let mut msg = match code {
        Some(c) => format!("{who} 프로그램이 일하던 중에 끝났어요 (코드 {c})"),
        None => format!("{who} 프로그램이 일하던 중에 끝났어요"),
    };
    if let Some(l) = last_line(tail) {
        msg += &format!(" — {}", l.chars().take(200).collect::<String>());
    }
    msg
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

/// Waits for a driver's process to end without holding its lock (a blocking `wait()` under the
/// lock would also block `kill()` — the stop button — until the process exits on its own).
/// Polls `try_wait`; gives up when the driver itself is gone (its `Drop` reaps the process).
fn reap<T>(weak: &Weak<T>, child: impl Fn(&T) -> &Mutex<Child>) -> Option<i32> {
    loop {
        let me = weak.upgrade()?;
        match child(&me).lock().unwrap().try_wait() {
            Ok(Some(st)) => return st.code(),
            Err(_) => return None,
            Ok(None) => {}
        }
        drop(me);
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

/// Kill and reap on drop, so a dropped driver never leaves a zombie process behind.
fn reap_on_drop(child: &mut Child) {
    if let Ok(None) = child.try_wait() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

// ── Claude Code (stream-json) ─────────────────────────

pub struct Claude {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Child>,
    /// a turn was sent and its `result` hasn't come yet
    busy: Arc<std::sync::atomic::AtomicBool>,
}

impl Claude {
    pub fn start(s: Spawn, sink: Sink) -> Result<Arc<Self>, String> {
        let mut child = spawn(&s)?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take();
        let busy = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let me = Arc::new(Self { stdin: Mutex::new(stdin), child: Mutex::new(child), busy: busy.clone() });

        // stderr: keep the tail for error reporting
        let tail = drain_stderr(stderr);

        let weak = Arc::downgrade(&me);
        std::thread::spawn(move || {
            // the model of the latest assistant message (the turn's total carries no model when it names none)
            let mut model = String::new();
            // the process's running token counts per model, as of the last turn (see claude_tokens)
            let mut seen = std::collections::HashMap::new();
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                match v.get("type").and_then(Value::as_str) {
                    Some("system") if v.get("subtype").and_then(Value::as_str) == Some("init") => {
                        if let Some(id) = v.get("session_id").and_then(Value::as_str) {
                            sink(Event::Started(id.into()));
                        }
                    }
                    Some("assistant") => {
                        if let Some(m) = v.pointer("/message/model").and_then(Value::as_str) {
                            model = m.to_string();
                        }
                        if let (Some(u), true) = (v.pointer("/message/usage"), v.get("parent_tool_use_id").is_none_or(Value::is_null)) {
                            let n: u64 = ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"].iter().filter_map(|k| u.get(k).and_then(Value::as_u64)).sum();
                            if n > 0 {
                                sink(Event::Context(n));
                            }
                        }
                        for block in v.pointer("/message/content").and_then(Value::as_array).into_iter().flatten() {
                            match block.get("type").and_then(Value::as_str) {
                                Some("text") => {
                                    let t = block.get("text").and_then(Value::as_str).unwrap_or("").trim();
                                    if !t.is_empty() {
                                        sink(Event::Text(t.into()));
                                    }
                                }
                                Some("thinking") => {
                                    let t = block.get("thinking").and_then(Value::as_str).unwrap_or("").trim();
                                    if !t.is_empty() {
                                        sink(Event::Thought(t.into()));
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
                    Some("result") => {
                        busy.store(false, std::sync::atomic::Ordering::SeqCst);
                        for ev in claude_tokens(&v, &model, &mut seen) {
                            sink(ev);
                        }
                        let error = v.get("is_error").and_then(Value::as_bool).unwrap_or(false);
                        let mut result = v.get("result").and_then(Value::as_str).map(String::from);
                        if error && result.as_deref().is_none_or(|r| r.trim().is_empty()) {
                            // an error result without a message still says what kind it was
                            result = v.get("subtype").and_then(Value::as_str).map(|s| format!("Claude가 오류로 끝났어요 ({s})"));
                        }
                        sink(Event::TurnEnd { result, cost: v.get("total_cost_usd").and_then(Value::as_f64), error })
                    }
                    _ => {}
                }
            }
            let code = reap(&weak, |m: &Claude| &m.child);
            // died mid-turn: the turn ends here, with the reason (otherwise it'd show "working" forever)
            if busy.swap(false, std::sync::atomic::Ordering::SeqCst) {
                sink(Event::TurnEnd { result: Some(exit_reason("Claude", code, &tail)), cost: None, error: true });
            } else if code.is_some_and(|c| c != 0) {
                if let Some(l) = last_line(&tail) {
                    sink(Event::Text(format!("⚠ {l}")));
                }
            }
            sink(Event::Exit(code));
        });
        Ok(me)
    }
}

/// The tokens of a finished Claude turn, one event per model.
///
/// `modelUsage` counts from the start of the process, not the turn: one `claude` process runs many turns,
/// so this turn is the change since the last result (`seen` keeps the last counts per model). Without
/// `modelUsage`, the turn's own `usage` is used as the total.
fn claude_tokens(v: &Value, model: &str, seen: &mut std::collections::HashMap<String, [u64; 4]>) -> Vec<Event> {
    let n = |u: &Value, k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
    if let Some(models) = v.get("modelUsage").and_then(Value::as_object) {
        let mut out = Vec::new();
        for (name, u) in models {
            let now = [n(u, "inputTokens"), n(u, "outputTokens"), n(u, "cacheReadInputTokens"), n(u, "cacheCreationInputTokens")];
            let before = seen.insert(name.clone(), now).unwrap_or([0; 4]);
            let d = |i: usize| now[i].saturating_sub(before[i]);
            if (0..4).any(|i| d(i) > 0) {
                out.push(Event::Tokens { model: name.clone(), input: d(0), output: d(1), cache_read: d(2), cache_write: d(3), context: 0 });
            }
        }
        return out;
    }
    match v.get("usage") {
        Some(u) => vec![Event::Tokens {
            model: model.to_string(),
            input: n(u, "input_tokens"),
            output: n(u, "output_tokens"),
            cache_read: n(u, "cache_read_input_tokens"),
            cache_write: n(u, "cache_creation_input_tokens"),
            context: 0,
        }],
        None => vec![],
    }
}

impl Driver for Claude {
    fn send(&self, text: &str) -> Result<(), String> {
        let mut g = self.stdin.lock().unwrap();
        let w = g.as_mut().ok_or("에이전트가 종료됐어요")?;
        let msg = json!({ "type": "user", "message": { "role": "user", "content": text } });
        writeln!(w, "{msg}").map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())?;
        self.busy.store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }

    fn kill(&self) {
        self.stdin.lock().unwrap().take(); // EOF lets it finish cleanly
        let _ = self.child.lock().unwrap().kill();
    }

    fn cancel(&self) {
        let mut g = self.stdin.lock().unwrap();
        if let Some(w) = g.as_mut() {
            let msg = json!({ "type": "control_request", "request_id": "prism-cancel", "request": { "subtype": "interrupt" } });
            let _ = writeln!(w, "{msg}").and_then(|_| w.flush());
        }
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
        let tail = drain_stderr(child.stderr.take());
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
                        Some("reasoning") => {
                            if let Some(t) = s("/item/text").filter(|t| !t.trim().is_empty()) {
                                (me.sink)(Event::Thought(t));
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
                        // `input_tokens` counts the cached part too: split it so the parts add up like Claude's
                        if let Some(u) = v.get("usage") {
                            let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
                            let (input, cache_read, cache_write) = (n("input_tokens"), n("cached_input_tokens"), n("cache_write_input_tokens"));
                            (me.sink)(Event::Tokens {
                                model: me.model().unwrap_or_default(),
                                input: input.saturating_sub(cache_read + cache_write),
                                output: n("output_tokens"),
                                cache_read,
                                cache_write,
                                context: input,
                            });
                        }
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
            let child = me.running.lock().unwrap().take();
            let code = child.and_then(|mut c| c.wait().ok()).and_then(|s| s.code());
            if !ended && !me.killed.load(std::sync::atomic::Ordering::Relaxed) {
                let why = if code == Some(0) && last_line(&tail).is_none() { "Codex가 응답 없이 끝났어요".to_string() } else { exit_reason("Codex", code, &tail) };
                (me.sink)(Event::TurnEnd { result: Some(why), cost: None, error: true });
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
    /// id of the `session/prompt` request in flight: its answer (result *or* error) ends the turn
    prompt: Mutex<Option<u64>>,
    queue: Mutex<std::collections::VecDeque<String>>,
    next_id: std::sync::atomic::AtomicU64,
    sink: Sink,
}

/// A JSON-RPC id as we got it: agents may use numbers or strings, and a reply must echo it as-is.
fn rpc_id(v: &Value) -> Option<Value> {
    v.get("id").filter(|i| i.is_number() || i.is_string()).cloned()
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

    /// End the running turn (whatever ended it) and move on to the next queued prompt.
    fn finish(&self, result: Option<String>, error: bool) {
        *self.prompt.lock().unwrap() = None;
        self.busy.store(false, std::sync::atomic::Ordering::SeqCst);
        (self.sink)(Event::TurnEnd { result, cost: None, error });
        self.pump();
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
        // hold the slot while writing so a fast reply can't arrive before we know its id
        let mut slot = self.prompt.lock().unwrap();
        match self.request("session/prompt", json!({ "sessionId": sid, "prompt": [{ "type": "text", "text": text }] })) {
            Ok(id) => *slot = Some(id),
            Err(e) => {
                drop(slot);
                self.busy.store(false, std::sync::atomic::Ordering::SeqCst);
                (self.sink)(Event::TurnEnd { result: Some(e), cost: None, error: true });
            }
        }
    }

    pub fn start(s: Spawn, setup: AcpSetup, sink: Sink, ask: Ask) -> Result<Arc<Self>, String> {
        let mut child = spawn(&s)?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let tail = drain_stderr(child.stderr.take());
        let me = Arc::new(Self {
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            session: Mutex::new(None),
            busy: Default::default(),
            prompt: Mutex::new(None),
            queue: Mutex::new(Default::default()),
            next_id: std::sync::atomic::AtomicU64::new(1),
            sink: sink.clone(),
        });
        let init = me.request(
            "initialize",
            json!({ "protocolVersion": 1, "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false }, "terminal": false } }),
        )?;

        let weak = Arc::downgrade(&me);
        std::thread::spawn(move || {
            let mut new_session_id: Option<u64> = None;
            let mut set_model_id: Option<u64> = None;
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
            let mut thought = String::new();
            let mut thought_sent = std::time::Instant::now();
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Some(me) = weak.upgrade() else { break };
                let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                let rid = rpc_id(&v);
                let id = rid.as_ref().and_then(Value::as_u64);
                let method = v.get("method").and_then(Value::as_str).map(String::from);
                match (rid, method.as_deref()) {
                    // our requests' responses
                    (Some(_), None) => {
                        let Some(id) = id else { continue };
                        let is_prompt = *me.prompt.lock().unwrap() == Some(id);
                        if let Some(err) = v.get("error") {
                            let mut msg = err.get("message").and_then(Value::as_str).unwrap_or("오류").to_string();
                            if let Some(d) = err.get("data").and_then(|d| d.as_str().map(String::from).or_else(|| d.get("message").and_then(Value::as_str).map(String::from))) {
                                msg += &format!(" ({d})");
                            }
                            if Some(id) == set_model_id {
                                // the chosen model isn't available: carry on with Antigravity's default
                                (me.sink)(Event::Text(format!("⚠ 고른 모델을 쓸 수 없어 기본 모델로 진행해요 ({msg})")));
                                continue;
                            }
                            let hint = if msg.to_lowercase().contains("auth") { " (계정에서 Google 로그인이 필요해요)" } else { "" };
                            let why = format!("{msg}{hint}");
                            if is_prompt {
                                flush(&mut text, &me); // whatever it had said still shows
                                last_text.clear();
                                me.finish(Some(why), true);
                            } else if id == init || Some(id) == new_session_id {
                                // no session, so nothing could ever run: say why and stop the process
                                (me.sink)(Event::TurnEnd { result: Some(format!("Antigravity를 시작하지 못했어요: {why}")), cost: None, error: true });
                                me.kill();
                            } else {
                                (me.sink)(Event::Text(format!("⚠ {why}")));
                            }
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
                                    set_model_id = me.request("session/set_model", json!({ "sessionId": sid, "modelId": setup.model })).ok();
                                }
                                me.pump();
                            }
                        } else if is_prompt || v.pointer("/result/stopReason").is_some() {
                            // a prompt turn finished
                            let t = flush(&mut text, &me);
                            if !t.is_empty() {
                                last_text = t;
                            }
                            let stop = v.pointer("/result/stopReason").and_then(Value::as_str).unwrap_or("end_turn");
                            let result = std::mem::take(&mut last_text);
                            match stop {
                                "end_turn" | "cancelled" => me.finish(Some(result), false),
                                "refusal" => me.finish(Some("에이전트가 이 요청을 거절했어요".into()), true),
                                // max_tokens, max_turn_requests…: it stopped short, say so
                                other if result.is_empty() => me.finish(Some(format!("에이전트가 중간에 멈췄어요 ({other})")), true),
                                _ => me.finish(Some(result), false),
                            }
                        }
                    }
                    // streaming updates (skipped while session/load replays old history)
                    (None, Some("session/update")) if loading => {}
                    (None, Some("session/update")) => {
                        let u = v.pointer("/params/update").cloned().unwrap_or(Value::Null);
                        match u.get("sessionUpdate").and_then(Value::as_str) {
                            Some("agent_thought_chunk") => {
                                if let Some(t) = u.pointer("/content/text").and_then(Value::as_str) {
                                    thought.push_str(t);
                                    if thought_sent.elapsed() > std::time::Duration::from_millis(300) {
                                        thought_sent = std::time::Instant::now();
                                        (me.sink)(Event::Thought(thought.trim().to_string()));
                                    }
                                }
                            }
                            Some("agent_message_chunk") => {
                                if !thought.is_empty() {
                                    (me.sink)(Event::Thought(std::mem::take(&mut thought).trim().to_string()));
                                }
                                if let Some(t) = u.pointer("/content/text").and_then(Value::as_str) {
                                    text.push_str(t);
                                }
                            }
                            Some("tool_call") => {
                                if !thought.is_empty() {
                                    (me.sink)(Event::Thought(std::mem::take(&mut thought).trim().to_string()));
                                }
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
                    // the agent asks us something (its ids may be strings: echo them back as given)
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
                            // a panicking approval path must still answer, or the agent waits forever
                            let ok = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| ask(title, raw))).unwrap_or(false);
                            let outcome = match (ok, allow, reject) {
                                (true, Some(o), _) | (false, _, Some(o)) => json!({ "outcome": "selected", "optionId": o }),
                                _ => json!({ "outcome": "cancelled" }),
                            };
                            let _ = me2.write(&json!({ "jsonrpc": "2.0", "id": rid, "result": { "outcome": outcome } }));
                        });
                    }
                    // anything else it asks (fs/terminal we didn't offer…): refuse right away so it doesn't wait on us
                    (Some(rid), Some(m)) => {
                        let _ = me.write(&json!({ "jsonrpc": "2.0", "id": rid, "error": { "code": -32601, "message": format!("{m} is not supported by this client") } }));
                    }
                    _ => {}
                }
            }
            // stdout closed: the process is gone (or going). Report it even if the driver was
            // already dropped — a silent end is what leaves the UI "working" forever.
            let code = reap(&weak, |m: &Acp| &m.child);
            let me = weak.upgrade();
            if let Some(me) = &me {
                if me.busy.swap(false, std::sync::atomic::Ordering::SeqCst) {
                    *me.prompt.lock().unwrap() = None;
                    sink(Event::TurnEnd { result: Some(exit_reason("Antigravity", code, &tail)), cost: None, error: true });
                }
            }
            sink(Event::Exit(code));
        });
        Ok(me)
    }
}

impl Drop for Acp {
    fn drop(&mut self) {
        reap_on_drop(self.child.get_mut().unwrap());
    }
}

impl Drop for Claude {
    fn drop(&mut self) {
        reap_on_drop(self.child.get_mut().unwrap());
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

    fn cancel(&self) {
        if let Some(sid) = self.session.lock().unwrap().clone() {
            let _ = self.write(&json!({ "jsonrpc": "2.0", "method": "session/cancel", "params": { "sessionId": sid } }));
        }
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::mpsc;

    /// A fake ACP agent (a shell script): answers initialize (id 1) and session/new (id 2), then `rest`.
    fn run_fake(rest: &str, ask: Ask) -> mpsc::Receiver<String> {
        let script = format!(
            "read l; echo '{{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{{}}}}'\n\
             read l; echo '{{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{{\"sessionId\":\"s1\"}}}}'\n{rest}"
        );
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let sink: Sink = Arc::new(move |ev| {
            let s = match ev {
                Event::TurnStart => "start".to_string(),
                Event::TurnEnd { result, error, .. } => format!("end:{error}:{}", result.unwrap_or_default()),
                Event::Exit(c) => format!("exit:{c:?}"),
                _ => return,
            };
            let _ = tx.lock().unwrap().send(s);
        });
        let spawn = Spawn { program: "sh".into(), args: vec!["-c".into(), script], cwd: ".".into(), env: vec![] };
        let setup = AcpSetup { cwd: ".".into(), system: String::new(), bridge: ("x".into(), vec![]), model: String::new(), resume: None };
        let acp = Acp::start(spawn, setup, sink, ask).unwrap();
        acp.send("hi").unwrap();
        // keep the driver alive for the test's duration
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(10));
            drop(acp);
        });
        rx
    }

    fn next(rx: &mpsc::Receiver<String>) -> String {
        rx.recv_timeout(std::time::Duration::from_secs(5)).expect("event")
    }

    fn no_ask() -> Ask {
        Arc::new(|_, _| true)
    }

    #[test]
    fn prompt_error_ends_the_turn() {
        let rx = run_fake("read l; echo '{\"jsonrpc\":\"2.0\",\"id\":3,\"error\":{\"code\":-32000,\"message\":\"boom\"}}'; read l", no_ask());
        assert_eq!(next(&rx), "start");
        assert_eq!(next(&rx), "end:true:boom");
    }

    #[test]
    fn dying_mid_turn_ends_the_turn() {
        let rx = run_fake("read l; echo 'fatal: something broke' >&2; exit 3", no_ask());
        assert_eq!(next(&rx), "start");
        let end = next(&rx);
        assert!(end.starts_with("end:true:") && end.contains("코드 3") && end.contains("something broke"), "{end}");
        assert_eq!(next(&rx), "exit:Some(3)");
    }

    #[test]
    fn permission_request_with_string_id_is_answered() {
        let rest = "read l\n\
            echo '{\"jsonrpc\":\"2.0\",\"id\":\"p-1\",\"method\":\"session/request_permission\",\"params\":{\"options\":[{\"kind\":\"allow_once\",\"optionId\":\"ok\"}]}}'\n\
            read r\n\
            case \"$r\" in *'\"p-1\"'*'\"ok\"'*) echo '{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"stopReason\":\"end_turn\"}}';; esac\n\
            read l";
        let rx = run_fake(rest, no_ask());
        assert_eq!(next(&rx), "start");
        assert_eq!(next(&rx), "end:false:");
    }
}

#[cfg(test)]
mod token_tests {
    use super::*;
    use std::collections::HashMap;

    fn fresh() -> HashMap<String, [u64; 4]> {
        HashMap::new()
    }

    /// Field names as Claude Code 2.x prints them (checked against real `claude -p --output-format stream-json` runs).
    #[test]
    fn a_claude_result_gives_tokens_per_model() {
        let v = json!({
            "type": "result",
            "usage": { "input_tokens": 2, "output_tokens": 4, "cache_read_input_tokens": 11837, "cache_creation_input_tokens": 12507 },
            "modelUsage": {
                "claude-haiku-5-5": { "inputTokens": 2, "outputTokens": 4, "cacheReadInputTokens": 11837, "cacheCreationInputTokens": 12507, "costUSD": 0.0026 },
                "claude-opus-5-5": { "inputTokens": 1, "outputTokens": 9, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "costUSD": 0.01 }
            }
        });
        let evs = claude_tokens(&v, "claude-haiku-5-5", &mut fresh());
        assert_eq!(evs.len(), 2);
        let haiku = evs.iter().find_map(|e| match e {
            Event::Tokens { model, input, output, cache_read, cache_write, .. } if model == "claude-haiku-5-5" => Some((*input, *output, *cache_read, *cache_write)),
            _ => None,
        });
        assert_eq!(haiku, Some((2, 4, 11837, 12507)));
    }

    /// `modelUsage` is cumulative for the process: the second turn of one process must only count its own part.
    /// Numbers from a real two-turn run: turn 2's `usage` is its own (input 2, output 3), `modelUsage` is the running total.
    #[test]
    fn the_second_turn_of_a_process_counts_only_its_own_tokens() {
        let mut seen = fresh();
        let first = json!({
            "type": "result",
            "usage": { "input_tokens": 2, "output_tokens": 3, "cache_read_input_tokens": 11839, "cache_creation_input_tokens": 10771 },
            "modelUsage": { "claude-haiku-5-5": { "inputTokens": 2, "outputTokens": 3, "cacheReadInputTokens": 11839, "cacheCreationInputTokens": 10771 } }
        });
        let second = json!({
            "type": "result",
            "usage": { "input_tokens": 2, "output_tokens": 3, "cache_read_input_tokens": 14968, "cache_creation_input_tokens": 9498 },
            "modelUsage": { "claude-haiku-5-5": { "inputTokens": 4, "outputTokens": 6, "cacheReadInputTokens": 26807, "cacheCreationInputTokens": 20269 } }
        });
        claude_tokens(&first, "claude-haiku-5-5", &mut seen);
        let evs = claude_tokens(&second, "claude-haiku-5-5", &mut seen);
        assert!(matches!(&evs[..], [Event::Tokens { input: 2, output: 3, cache_read: 14968, cache_write: 9498, .. }]));
    }

    #[test]
    fn without_modelusage_the_turns_total_is_filed_under_the_last_model_seen() {
        let v = json!({ "type": "result", "usage": { "input_tokens": 5, "output_tokens": 6, "cache_read_input_tokens": 7, "cache_creation_input_tokens": 8 } });
        let evs = claude_tokens(&v, "claude-sonnet-5-5", &mut fresh());
        assert!(matches!(&evs[..], [Event::Tokens { model, input: 5, output: 6, cache_read: 7, cache_write: 8, .. }] if model == "claude-sonnet-5-5"));
    }

    #[test]
    fn a_result_without_usage_gives_nothing() {
        assert!(claude_tokens(&json!({ "type": "result", "is_error": true }), "x", &mut fresh()).is_empty());
    }
}
