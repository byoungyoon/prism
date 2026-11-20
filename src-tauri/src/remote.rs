//! Remote access: the same Prism UI and the same live team, from any of your devices.
//!
//! A second HTTP server serves the app's UI plus `/api/<command>` and a `/api/events`
//! WebSocket. It only listens on 127.0.0.1; `tailscale serve` publishes it over HTTPS to the
//! user's own tailnet (on a Prism-only port, so existing Tailscale setups are untouched).
//! Every API call needs the access key shown in the pairing QR.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Listener, Manager};

use crate::sys;

/// Tailnet HTTPS port Prism publishes on (kept off 443 so the user's own serve config is safe).
const TS_PORT: &str = "8443";
const EVENTS: [&str; 4] = ["team://snapshot", "agent://entry", "usage://update", "cli://status"];

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct Saved {
    enabled: bool,
    key: String,
}

pub struct Remote {
    saved: Mutex<Saved>,
    file: Option<std::path::PathBuf>,
    port: Mutex<Option<u16>>,
    shutdown: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    events: tokio::sync::broadcast::Sender<String>,
    awake: Mutex<Option<std::process::Child>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    pub enabled: bool,
    pub running: bool,
    pub key: String,
    /// https://<mac>.<tailnet>.ts.net:8443/?k=<key> when published
    pub url: Option<String>,
    pub tailscale: TailscaleState,
    pub note: Option<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleState {
    pub installed: bool,
    /// signed in and connected
    pub running: bool,
    pub dns_name: Option<String>,
}

fn new_key() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

impl Remote {
    pub fn load(app: &AppHandle) -> Self {
        let file = app.path().app_data_dir().ok().map(|d| d.join("remote.json"));
        let mut saved: Saved = file
            .as_ref()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        if saved.key.is_empty() {
            saved.key = new_key();
        }
        let (events, _) = tokio::sync::broadcast::channel(256);
        // mirror the app's live events to remote viewers
        for name in EVENTS {
            let tx = events.clone();
            app.listen_any(name, move |e| {
                let _ = tx.send(format!(r#"{{"event":"{name}","payload":{}}}"#, e.payload()));
            });
        }
        let me = Self { saved: Mutex::new(saved), file, port: Mutex::new(None), shutdown: Mutex::new(None), events, awake: Mutex::new(None) };
        me.save();
        me
    }

    fn save(&self) {
        if let Some(f) = &self.file {
            let _ = std::fs::create_dir_all(f.parent().unwrap());
            let _ = std::fs::write(f, serde_json::to_string_pretty(&*self.saved.lock().unwrap()).unwrap_or_default());
        }
    }

    fn key(&self) -> String {
        self.saved.lock().unwrap().key.clone()
    }
}

// ── tailscale ─────────────────────────────────────────

fn tailscale_state() -> TailscaleState {
    if sys::which("tailscale").is_none() {
        return TailscaleState::default();
    }
    let out = sys::command("tailscale").args(["status", "--json"]).output();
    let v: Value = out.ok().and_then(|o| serde_json::from_slice(&o.stdout).ok()).unwrap_or(Value::Null);
    let running = v.get("BackendState").and_then(Value::as_str) == Some("Running");
    let dns = v.pointer("/Self/DNSName").and_then(Value::as_str).map(|s| s.trim_end_matches('.').to_string()).filter(|s| !s.is_empty());
    TailscaleState { installed: true, running, dns_name: dns }
}

/// Publish on the tailnet. `tailscale serve` only explains itself on a terminal, and when Serve
/// isn't enabled for the tailnet yet it waits forever for that — so run it in a PTY, give it a
/// few seconds, and hand back the enable link instead of hanging.
fn ts_publish(port: u16) -> Result<(), String> {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::Read;
    let (exe, _) = sys::resolve("tailscale");
    let pair = native_pty_system().openpty(PtySize { rows: 24, cols: 200, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new(exe);
    cmd.args(["serve", "--bg", &format!("--https={TS_PORT}"), &format!("http://127.0.0.1:{port}")]);
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let out = Arc::new(Mutex::new(String::new()));
    let sink = out.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            sink.lock().unwrap().push_str(&String::from_utf8_lossy(&buf[..n]));
        }
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    let status = loop {
        if let Ok(Some(st)) = child.try_wait() {
            break Some(st);
        }
        if std::time::Instant::now() > deadline || out.lock().unwrap().contains("To enable") {
            std::thread::sleep(std::time::Duration::from_millis(300)); // let the link finish printing
            let _ = child.kill();
            break None;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    };
    let text: String = out.lock().unwrap().lines().filter(|l| !l.contains("client version")).collect::<Vec<_>>().join("\n");
    match status {
        Some(st) if st.success() => Ok(()),
        _ => {
            if let Some(link) = text.split_whitespace().find(|w| w.starts_with("https://login.tailscale.com/")) {
                Err(format!("ENABLE_SERVE {link}"))
            } else {
                Err(if text.trim().is_empty() { "Tailscale이 응답하지 않아요".into() } else { text.trim().to_string() })
            }
        }
    }
}

fn ts_unpublish() {
    let _ = sys::command("tailscale").args(["serve", &format!("--https={TS_PORT}"), "off"]).stdin(std::process::Stdio::null()).output();
}

/// While remote access is on, keep the Mac from idling to sleep (the team lives here).
fn keep_awake(r: &Remote, on: bool) {
    let mut g = r.awake.lock().unwrap();
    if let Some(mut c) = g.take() {
        let _ = c.kill();
    }
    #[cfg(target_os = "macos")]
    if on {
        *g = std::process::Command::new("/usr/bin/caffeinate").args(["-i", "-w", &std::process::id().to_string()]).spawn().ok();
    }
    let _ = on;
}

// ── server ────────────────────────────────────────────

#[derive(Clone)]
struct Ctx {
    app: AppHandle,
    key: String,
    events: tokio::sync::broadcast::Sender<String>,
}

type Q = Query<HashMap<String, String>>;

fn authed(ctx: &Ctx, headers: &HeaderMap, q: &Q) -> bool {
    let given = headers.get("x-prism-key").and_then(|v| v.to_str().ok()).map(String::from).or_else(|| q.get("k").cloned());
    given.is_some_and(|k| k == ctx.key)
}

async fn start_server(app: &AppHandle) -> Result<u16, String> {
    let r = app.state::<Remote>();
    if let Some(p) = *r.port.lock().unwrap() {
        return Ok(p);
    }
    let listener = match tokio::net::TcpListener::bind("127.0.0.1:7655").await {
        Ok(l) => l,
        Err(_) => tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?,
    };
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let ctx = Ctx { app: app.clone(), key: r.key(), events: r.events.clone() };
    let router = Router::new()
        .route("/api/events", get(events))
        .route("/api/{cmd}", post(call))
        .fallback(get(asset))
        .with_state(ctx);
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router).with_graceful_shutdown(async { let _ = rx.await; }).await;
    });
    *r.port.lock().unwrap() = Some(port);
    *r.shutdown.lock().unwrap() = Some(tx);
    Ok(port)
}

fn stop_server(r: &Remote) {
    if let Some(tx) = r.shutdown.lock().unwrap().take() {
        let _ = tx.send(());
    }
    *r.port.lock().unwrap() = None;
}

/// The built UI, straight from the app bundle (index.html for any unknown path — it's an SPA).
async fn asset(State(ctx): State<Ctx>, uri: axum::http::Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let resolver = ctx.app.asset_resolver();
    let found = if path.is_empty() { None } else { resolver.get(path.to_string()) };
    match found.or_else(|| resolver.get("index.html".into())) {
        Some(a) => ([(header::CONTENT_TYPE, a.mime_type)], a.bytes).into_response(),
        None => (StatusCode::NOT_FOUND, "Prism 화면을 찾을 수 없어요 (개발 모드에서는 원격 화면이 꺼져 있어요)").into_response(),
    }
}

async fn events(State(ctx): State<Ctx>, headers: HeaderMap, q: Q, ws: WebSocketUpgrade) -> Response {
    if !authed(&ctx, &headers, &q) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let rx = ctx.events.subscribe();
    ws.on_upgrade(move |socket| pump_events(socket, rx))
}

async fn pump_events(mut socket: WebSocket, mut rx: tokio::sync::broadcast::Receiver<String>) {
    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Ok(text) => if socket.send(Message::Text(text.into())).await.is_err() { break },
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            },
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            },
        }
    }
}

async fn call(State(ctx): State<Ctx>, Path(cmd): Path<String>, headers: HeaderMap, q: Q, body: Option<Json<Value>>) -> Response {
    if !authed(&ctx, &headers, &q) {
        return (StatusCode::UNAUTHORIZED, Json(json!("접속 키가 맞지 않아요"))).into_response();
    }
    let args = body.map(|Json(v)| v).unwrap_or(json!({}));
    match dispatch(&ctx.app, &cmd, args).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!(e))).into_response(),
    }
}

fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null)).map_err(|e| format!("{key}: {e}"))
}

fn ok<T: Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

/// The commands a remote device may use: everything for running a team; nothing that touches
/// this Mac's accounts, installs, terminals or local file paths.
async fn dispatch(app: &AppHandle, cmd: &str, a: Value) -> Result<Value, String> {
    use crate::{launch, projects as p, team as t};
    let teams = || app.state::<Arc<t::TeamManager>>();
    let projects = || app.state::<p::Projects>();
    match cmd {
        "projects_list" => ok(p::projects_list(projects())),
        "workspace_root" => ok(p::workspace_root(projects())),
        "project_create" => ok(p::project_create(projects(), arg(&a, "name")?)?),
        "project_touch" => ok(p::project_touch(projects(), arg(&a, "id")?)?),
        "prefs_get" => ok(p::prefs_get(projects())),
        "project_set_team" => ok(p::project_set_team(projects(), arg(&a, "id")?, arg(&a, "team")?)?),
        "project_set_preset" => ok(p::project_set_preset(projects(), arg(&a, "id")?, arg(&a, "preset")?)?),
        "worktrees_list" => ok(p::worktrees_list(arg(&a, "path")?)),
        "git_changes" => ok(p::git_changes(arg(&a, "cwd")?)),
        "git_diff" => ok(p::git_diff(arg(&a, "cwd")?, arg(&a, "path")?)),
        "accounts_list" => ok(crate::accounts::accounts_list(app.clone()).await),
        "cli_status" => ok(crate::clis::cli_status(app.clone()).await),
        "models_list" => ok(launch::models_list(arg(&a, "provider")?, arg(&a, "home")?)),
        "team_start" => ok(t::team_start(app.clone(), arg(&a, "projectId")?, arg(&a, "cwd")?).await?),
        "team_stop" => ok(t::team_stop(teams(), arg(&a, "projectId")?)),
        "team_get" => ok(t::team_get(teams(), arg(&a, "projectId")?)),
        "usage_get" => ok(t::usage_get(teams())),
        "usage_refresh" => ok(t::usage_refresh(app.clone()).await),
        "lead_send" => ok(t::lead_send(teams(), arg(&a, "projectId")?, arg(&a, "text")?)?),
        "escalation_answer" => ok(t::escalation_answer(teams(), arg(&a, "projectId")?, arg(&a, "msgId")?, arg(&a, "answer")?)?),
        "permission_answer" => ok(t::permission_answer(teams(), arg(&a, "projectId")?, arg(&a, "msgId")?, arg(&a, "answer")?)?),
        "agent_message" => ok(t::agent_message(teams(), arg(&a, "projectId")?, arg(&a, "agentId")?, arg(&a, "text")?)?),
        "agent_set_model" => ok(t::agent_set_model(teams(), arg(&a, "projectId")?, arg(&a, "agentId")?, arg(&a, "model")?)?),
        "agent_kill" => ok(t::agent_kill(teams(), arg(&a, "projectId")?, arg(&a, "agentId")?)),
        "agent_pause" => ok(t::agent_pause(teams(), arg(&a, "projectId")?, arg(&a, "agentId")?)?),
        "agent_resume" => ok(t::agent_resume(teams(), arg(&a, "projectId")?, arg(&a, "agentId")?)?),
        "agent_transcript" => ok(t::agent_transcript(teams(), arg(&a, "projectId")?, arg(&a, "agentId")?)),
        "task_files" => ok(t::task_files(teams(), arg(&a, "projectId")?, arg(&a, "taskId")?)?),
        "task_diff" => ok(t::task_diff(teams(), arg(&a, "projectId")?, arg(&a, "taskId")?, arg(&a, "path")?)?),
        "task_file" => ok(t::task_file(teams(), arg(&a, "projectId")?, arg(&a, "taskId")?, arg(&a, "path")?)?),
        "attach_bytes" => ok(t::attach_bytes(projects(), arg(&a, "projectId")?, arg(&a, "name")?, arg(&a, "data")?)?),
        _ => Err(format!("원격에서는 쓸 수 없는 기능이에요: {cmd}")),
    }
}

// ── commands (Mac side) ───────────────────────────────

fn status(r: &Remote) -> RemoteStatus {
    let saved = r.saved.lock().unwrap().clone();
    let ts = tailscale_state();
    let running = r.port.lock().unwrap().is_some();
    let url = match (&ts.dns_name, saved.enabled && running) {
        (Some(dns), true) => Some(format!("https://{dns}:{TS_PORT}/?k={}", saved.key)),
        _ => None,
    };
    RemoteStatus { enabled: saved.enabled, running, key: saved.key, url, tailscale: ts, note: None }
}

/// Turn remote access on/off: local server + Tailscale publishing + keep-awake.
pub async fn set_enabled(app: &AppHandle, on: bool) -> RemoteStatus {
    let r = app.state::<Remote>();
    let mut note = None;
    if on {
        match start_server(app).await {
            Ok(port) => {
                let ts = tailscale_state();
                if !ts.installed {
                    note = Some("Tailscale이 설치돼 있지 않아요".to_string());
                } else if !ts.running {
                    note = Some("Tailscale에 로그인해 주세요".to_string());
                } else if let Err(e) = tauri::async_runtime::spawn_blocking(move || ts_publish(port)).await.unwrap_or_else(|e| Err(e.to_string())) {
                    note = Some(match e.strip_prefix("ENABLE_SERVE ") {
                        // first time on this tailnet: Serve must be switched on once (Tailscale's own page)
                        Some(link) => format!("ENABLE_SERVE {link}"),
                        None => format!("Tailscale 공개 실패: {e}"),
                    });
                }
                keep_awake(&r, true);
            }
            Err(e) => note = Some(format!("원격 서버를 열지 못했어요: {e}")),
        }
    } else {
        stop_server(&r);
        let _ = tauri::async_runtime::spawn_blocking(ts_unpublish).await;
        keep_awake(&r, false);
    }
    r.saved.lock().unwrap().enabled = on;
    r.save();
    let mut s = status(&r);
    s.note = note;
    s
}

/// On launch: bring remote access back if it was on.
pub fn restore(app: AppHandle) {
    if app.state::<Remote>().saved.lock().unwrap().enabled {
        tauri::async_runtime::spawn(async move {
            set_enabled(&app, true).await;
        });
    }
}

#[tauri::command]
pub async fn remote_status(app: AppHandle) -> RemoteStatus {
    tauri::async_runtime::spawn_blocking(move || status(&app.state::<Remote>())).await.unwrap_or_else(|_| RemoteStatus {
        enabled: false,
        running: false,
        key: String::new(),
        url: None,
        tailscale: TailscaleState::default(),
        note: None,
    })
}

#[tauri::command]
pub async fn remote_set(app: AppHandle, on: bool) -> RemoteStatus {
    set_enabled(&app, on).await
}

/// New access key: every paired device has to scan the QR again.
#[tauri::command]
pub async fn remote_new_key(app: AppHandle) -> RemoteStatus {
    let was = app.state::<Remote>().saved.lock().unwrap().enabled;
    {
        let r = app.state::<Remote>();
        stop_server(&r);
        r.saved.lock().unwrap().key = new_key();
        r.save();
    }
    set_enabled(&app, was).await
}
