//! PTY sessions owned by the backend.
//!
//! A session outlives any view: output is kept in a ring buffer and fanned out to every
//! attached frontend `Channel` as raw bytes, so an agent's terminal can be opened, closed
//! and reopened (scrollback replays) while the agent keeps working.

use std::borrow::Cow;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

const SCROLLBACK: usize = 512 * 1024;

/// How much of a finished program's output is kept, and for how many programs.
const TAIL: usize = 8 * 1024;
const ENDED_KEPT: usize = 32;

/// Called when a program ends by itself (not when Prism stopped it): exit code and last output.
pub type ExitHook = Box<dyn FnOnce(Option<u32>, &str) + Send>;

/// What `pty_state` answers: how a program is doing, still readable after it ended.
#[derive(serde::Serialize, Clone)]
pub struct PtyState {
    pub done: bool,
    pub code: Option<u32>,
    /// the last output of a finished program (raw, with terminal escapes)
    pub tail: String,
}

/// ConPTY asks where the cursor is (`ESC[6n`) as it starts and holds the program's output until
/// someone answers. Returns the output without the question, or None when it isn't in there.
#[cfg_attr(not(windows), allow(dead_code))]
fn take_cursor_query(data: &[u8]) -> Option<Vec<u8>> {
    const QUERY: &[u8] = b"\x1b[6n";
    let at = data.windows(QUERY.len()).position(|w| w == QUERY)?;
    Some([&data[..at], &data[at + QUERY.len()..]].concat())
}

#[derive(Default)]
struct Shared {
    buf: Mutex<Vec<u8>>,
    subs: Mutex<HashMap<u64, Channel<InvokeResponseBody>>>,
    /// exit code seen before the output ended (Windows)
    code: Mutex<Option<u32>>,
    killed: AtomicBool,
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    shared: Arc<Shared>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<u32, Session>>>,
    ended: Arc<Mutex<VecDeque<(u32, PtyState)>>>,
    next_id: AtomicU32,
    next_sub: AtomicU64,
}

pub struct SpawnSpec {
    /// None = the user's default (login) shell.
    pub program: Option<String>,
    pub args: Vec<String>,
    pub cwd: String,
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 }
}

impl PtyManager {
    pub fn spawn(&self, spec: SpawnSpec, on_exit: Option<ExitHook>) -> Result<u32, String> {
        let pair = native_pty_system()
            .openpty(size(spec.cols, spec.rows))
            .map_err(|e| e.to_string())?;

        let mut cmd = match &spec.program {
            Some(p) => {
                let (exe, lead) = crate::sys::resolve(p);
                let mut c = CommandBuilder::new(exe);
                c.args(&lead);
                c.args(&spec.args);
                c
            }
            None => CommandBuilder::new_default_prog(),
        };
        cmd.cwd(&spec.cwd);
        // don't leak the launching agent session's markers (e.g. when Prism itself was started
        // from inside Claude Code): agents must run as top-level sessions
        for (k, _) in std::env::vars() {
            if k == "CLAUDECODE" || k.starts_with("CLAUDE_CODE_") || k == "CLAUDE_PID" || k == "CLAUDE_EFFORT" {
                cmd.env_remove(&k);
            }
        }
        cmd.env("PATH", crate::sys::search_path());
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "Prism");
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let shared = Arc::new(Shared::default());

        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.sessions
            .lock()
            .unwrap()
            .insert(id, Session { master: pair.master, writer, child, shared: shared.clone() });

        // ConPTY keeps the output open after the program ends, so the end is watched for here;
        // dropping the session closes the console, which ends the output
        #[cfg(windows)]
        watch_exit(id, self.sessions.clone());

        let sessions = self.sessions.clone();
        let ended = self.ended.clone();
        std::thread::Builder::new()
            .name(format!("pty-{id}"))
            .spawn(move || {
                let mut chunk = [0u8; 16 * 1024];
                // the console's own startup question comes first; nothing to answer elsewhere
                let mut unanswered = cfg!(windows);
                let mut seen = 0usize;
                loop {
                    match reader.read(&mut chunk) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let mut data = Cow::Borrowed(&chunk[..n]);
                            if unanswered {
                                if let Some(rest) = take_cursor_query(&data) {
                                    if let Some(s) = sessions.lock().unwrap().get_mut(&id) {
                                        let _ = s.writer.write_all(b"\x1b[1;1R").and_then(|_| s.writer.flush());
                                    }
                                    data = Cow::Owned(rest);
                                    unanswered = false;
                                }
                                seen += n;
                                unanswered &= seen < 4096;
                            }
                            if data.is_empty() {
                                continue;
                            }
                            let mut buf = shared.buf.lock().unwrap();
                            buf.extend_from_slice(&data);
                            if buf.len() > SCROLLBACK {
                                let cut = buf.len() - SCROLLBACK;
                                buf.drain(..cut);
                            }
                            let mut subs = shared.subs.lock().unwrap();
                            subs.retain(|_, ch| ch.send(InvokeResponseBody::Raw(data.to_vec())).is_ok());
                        }
                    }
                }
                // take it out first: waiting under the sessions lock would freeze every terminal
                let gone = sessions.lock().unwrap().remove(&id);
                let waited = gone.and_then(|mut s| s.child.wait().ok()).map(|st| st.exit_code());
                let code = waited.or_else(|| *shared.code.lock().unwrap());
                let tail = {
                    let buf = shared.buf.lock().unwrap();
                    String::from_utf8_lossy(&buf[buf.len().saturating_sub(TAIL)..]).into_owned()
                };
                {
                    let mut list = ended.lock().unwrap();
                    list.push_back((id, PtyState { done: true, code, tail: tail.clone() }));
                    if list.len() > ENDED_KEPT {
                        list.pop_front();
                    }
                }
                let note = format!("\r\n\x1b[2m[프로세스 종료{}]\x1b[0m\r\n", code.map(|c| format!(" · {c}")).unwrap_or_default());
                for ch in shared.subs.lock().unwrap().values() {
                    let _ = ch.send(InvokeResponseBody::Raw(note.clone().into_bytes()));
                }
                if let Some(hook) = on_exit {
                    if !shared.killed.load(Ordering::SeqCst) {
                        hook(code, &tail);
                    }
                }
            })
            .map_err(|e| e.to_string())?;

        Ok(id)
    }

    pub fn write(&self, id: u32, data: &[u8]) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let s = sessions.get_mut(&id).ok_or("no such pty")?;
        s.writer.write_all(data).map_err(|e| e.to_string())?;
        s.writer.flush().map_err(|e| e.to_string())
    }

    /// Types `text` and submits it. The Enter goes in a separate write after a short pause
    /// so TUIs (Claude Code) don't treat it as part of a paste.
    pub fn type_line(self: &Arc<Self>, id: u32, text: String) {
        let me = self.clone();
        std::thread::spawn(move || {
            let flat = text.replace("\r\n", " ").replace('\n', " ");
            if me.write(id, flat.as_bytes()).is_ok() {
                std::thread::sleep(std::time::Duration::from_millis(150));
                let _ = me.write(id, b"\r");
            }
        });
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let s = sessions.get(&id).ok_or("no such pty")?;
        s.master.resize(size(cols, rows)).map_err(|e| e.to_string())
    }

    pub fn kill(&self, id: u32) {
        if let Some(s) = self.sessions.lock().unwrap().get_mut(&id) {
            s.shared.killed.store(true, Ordering::SeqCst);
            let _ = s.child.kill();
        }
    }

    /// None for a number Prism never gave out (or one that ended long ago).
    pub fn state(&self, id: u32) -> Option<PtyState> {
        if let Some((_, s)) = self.ended.lock().unwrap().iter().find(|(i, _)| *i == id) {
            return Some(s.clone());
        }
        // between "output ended" and "exit code known" a program still counts as running
        let issued = id >= 1 && id <= self.next_id.load(Ordering::Relaxed);
        issued.then(|| PtyState { done: false, code: None, tail: String::new() })
    }


    fn attach(&self, id: u32, ch: Channel<InvokeResponseBody>) -> Result<u64, String> {
        let shared = {
            let sessions = self.sessions.lock().unwrap();
            sessions.get(&id).ok_or("no such pty")?.shared.clone()
        };
        let sub = self.next_sub.fetch_add(1, Ordering::Relaxed) + 1;
        // lock order buf → subs matches the reader thread, so no output is lost or duplicated
        let buf = shared.buf.lock().unwrap();
        if !buf.is_empty() {
            let _ = ch.send(InvokeResponseBody::Raw(buf.clone()));
        }
        shared.subs.lock().unwrap().insert(sub, ch);
        Ok(sub)
    }

    fn detach(&self, id: u32, sub: u64) {
        if let Some(s) = self.sessions.lock().unwrap().get(&id) {
            s.shared.subs.lock().unwrap().remove(&sub);
        }
    }
}

#[cfg(windows)]
fn watch_exit(id: u32, sessions: Arc<Mutex<HashMap<u32, Session>>>) {
    use std::time::Duration;
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(200));
        let code = match sessions.lock().unwrap().get_mut(&id) {
            None => return,
            Some(s) => match s.child.try_wait() {
                Ok(Some(st)) => {
                    *s.shared.code.lock().unwrap() = Some(st.exit_code());
                    true
                }
                _ => false,
            },
        };
        if code {
            std::thread::sleep(Duration::from_millis(300)); // let the last lines arrive
            // closed outside the lock: closing waits for the reader, which may need the lock
            let gone = sessions.lock().unwrap().remove(&id);
            drop(gone);
            return;
        }
    });
}

pub type Pty = Arc<PtyManager>;

#[tauri::command]
pub fn pty_state(pty: State<'_, Pty>, id: u32) -> Option<PtyState> {
    pty.state(id)
}

/// A plain interactive shell (not an agent).
#[tauri::command]
pub fn pty_spawn_shell(app: AppHandle, pty: State<'_, Pty>, cwd: Option<String>, cols: u16, rows: u16) -> Result<u32, String> {
    let cwd = cwd
        .filter(|d| !d.is_empty())
        .or_else(|| app.path().home_dir().ok().map(|p| p.to_string_lossy().into_owned()))
        .unwrap_or_else(|| ".".into());
    pty.spawn(SpawnSpec { program: None, args: vec![], cwd, env: vec![], cols, rows }, None)
}

#[tauri::command]
pub fn pty_attach(pty: State<'_, Pty>, id: u32, on_data: Channel<InvokeResponseBody>) -> Result<u64, String> {
    pty.attach(id, on_data)
}

#[tauri::command]
pub fn pty_detach(pty: State<'_, Pty>, id: u32, sub: u64) {
    pty.detach(id, sub)
}

#[tauri::command]
pub fn pty_write(pty: State<'_, Pty>, id: u32, data: String) -> Result<(), String> {
    pty.write(id, data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(pty: State<'_, Pty>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    pty.resize(id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(pty: State<'_, Pty>, id: u32) {
    pty.kill(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_the_cursor_question_out_of_the_output() {
        assert_eq!(take_cursor_query(b"\x1b[6n"), Some(vec![]));
        assert_eq!(take_cursor_query(b"ab\x1b[6ncd"), Some(b"abcd".to_vec()));
        assert_eq!(take_cursor_query(b"\x1b[2J hello"), None);
    }

    /// Runs a program with no screen attached (as sign-in and install do) and waits for its end.
    fn run_unseen(program: &str, args: &[&str]) -> PtyState {
        let pty = PtyManager::default();
        let spec = SpawnSpec {
            program: Some(program.into()),
            args: args.iter().map(|a| a.to_string()).collect(),
            cwd: std::env::temp_dir().to_string_lossy().into_owned(),
            env: vec![],
            cols: 200,
            rows: 30,
        };
        let id = pty.spawn(spec, None).expect("spawn");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
        loop {
            let state = pty.state(id).expect("known id");
            if state.done {
                return state;
            }
            if std::time::Instant::now() > deadline {
                pty.kill(id);
                panic!("the end of {program} was never noticed");
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }

    #[test]
    fn notices_the_end_of_an_unseen_program() {
        #[cfg(unix)]
        let state = run_unseen("sh", &["-c", "echo prism-hello; exit 3"]);
        #[cfg(windows)]
        let state = run_unseen("cmd", &["/d", "/c", "echo prism-hello& exit 3"]);
        assert_eq!(state.code, Some(3));
        assert!(state.tail.contains("prism-hello"), "{:?}", state.tail);
    }

    #[cfg(windows)]
    #[test]
    fn runs_a_cmd_file_in_a_folder_with_spaces_and_parentheses() {
        let dir = std::env::temp_dir().join(format!("prism test (x86) {}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let shim = dir.join("tool.cmd");
        std::fs::write(&shim, "@echo off\r\necho got %~1 and %~2\r\nexit /b 7\r\n").unwrap();
        let (exe, mut args) = crate::sys::cmd_shim(shim.to_string_lossy().into_owned());
        args.extend(["one".into(), "two words".into()]);
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        let state = run_unseen(&exe, &args);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(state.code, Some(7), "{:?}", state.tail);
        assert!(state.tail.contains("got one and two words"), "{:?}", state.tail);
    }

    /// Diagnosis only (printed, never fails): does a console that gets no answer to its cursor
    /// question hold the program back? Shows whether the answer above is needed on this Windows.
    #[cfg(windows)]
    #[test]
    fn diagnose_unanswered_console() {
        let pair = native_pty_system().openpty(size(120, 30)).unwrap();
        let mut cmd = CommandBuilder::new("cmd");
        cmd.args(["/d", "/c", "echo prism-raw"]);
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut chunk = [0u8; 4096];
            while let Ok(n @ 1..) = reader.read(&mut chunk) {
                if tx.send(chunk[..n].to_vec()).is_err() {
                    break;
                }
            }
        });
        std::thread::sleep(std::time::Duration::from_secs(8));
        let out: Vec<u8> = rx.try_iter().flatten().collect();
        let exit = child.try_wait().ok().flatten().map(|s| s.exit_code());
        println!("RAW-PTY after 8s: exit={exit:?} output={:?}", String::from_utf8_lossy(&out));
        let _ = child.kill();
        // closing may wait for the reader; the test must not hang on it
        std::thread::spawn(move || drop(pair.master));
    }
}
