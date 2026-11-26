//! PTY sessions owned by the backend.
//!
//! A session outlives any view: output is kept in a ring buffer and fanned out to every
//! attached frontend `Channel` as raw bytes, so an agent's terminal can be opened, closed
//! and reopened (scrollback replays) while the agent keeps working.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

const SCROLLBACK: usize = 512 * 1024;

pub type ExitHook = Box<dyn FnOnce(Option<u32>) + Send>;

#[derive(Default)]
struct Shared {
    buf: Mutex<Vec<u8>>,
    subs: Mutex<HashMap<u64, Channel<InvokeResponseBody>>>,
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

        let sessions = self.sessions.clone();
        std::thread::Builder::new()
            .name(format!("pty-{id}"))
            .spawn(move || {
                let mut chunk = [0u8; 16 * 1024];
                loop {
                    match reader.read(&mut chunk) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let data = &chunk[..n];
                            let mut buf = shared.buf.lock().unwrap();
                            buf.extend_from_slice(data);
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
                let code = gone.and_then(|mut s| s.child.wait().ok()).map(|st| st.exit_code());
                let note = format!("\r\n\x1b[2m[프로세스 종료{}]\x1b[0m\r\n", code.map(|c| format!(" · {c}")).unwrap_or_default());
                for ch in shared.subs.lock().unwrap().values() {
                    let _ = ch.send(InvokeResponseBody::Raw(note.clone().into_bytes()));
                }
                if let Some(hook) = on_exit {
                    hook(code);
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
            let _ = s.child.kill();
        }
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

pub type Pty = Arc<PtyManager>;

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
