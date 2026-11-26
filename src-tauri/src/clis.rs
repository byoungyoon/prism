//! The tools Prism needs (Git, Claude Code, Codex — and Node.js on Windows for Codex): detect,
//! install with the official installer, and keep the agent CLIs updated in the background.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::pty::{Pty, SpawnSpec};
use crate::{setup_log, sys};

/// Agent CLIs that auto-update.
pub const CLIS: [&str; 3] = ["claude", "codex", "agy"];

/// Everything Prism checks for, in install order.
fn tools() -> Vec<&'static str> {
    if cfg!(windows) { vec!["git", "node", "claude", "codex", "agy"] } else { vec!["git", "claude", "codex", "agy"] }
}

fn label(name: &str) -> &'static str {
    match name {
        "git" => "Git",
        "node" => "Node.js",
        "claude" => "Claude Code",
        "agy" => "Antigravity",
        _ => "Codex",
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub name: String,
    pub label: String,
    pub installed: bool,
    pub version: Option<String>,
    /// last background update result, if any
    pub note: Option<String>,
}

/// Background-update switch (persisted by the frontend through `cli_set_auto_update`).
pub struct CliState {
    pub auto_update: AtomicBool,
    pub notes: std::sync::Mutex<std::collections::HashMap<String, String>>,
    file: Option<std::path::PathBuf>,
}

impl CliState {
    pub fn load(app: &AppHandle) -> Self {
        let file = app.path().app_data_dir().ok().map(|d| d.join("cli.json"));
        let on = file
            .as_ref()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            .and_then(|v| v.get("autoUpdate").and_then(|b| b.as_bool()))
            .unwrap_or(true);
        Self { auto_update: AtomicBool::new(on), notes: Default::default(), file }
    }
}

pub fn version(name: &str) -> Option<String> {
    sys::which(name)?;
    let out = sys::command(name).arg("--version").stdin(std::process::Stdio::null()).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    // "2.1.329 (Claude Code)" / "codex-cli 0.159.2" → the first token that looks like a version
    text.split_whitespace()
        .map(|t| t.trim_start_matches('v'))
        .find(|t| t.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .map(String::from)
}

/// Official install / update command for a CLI, as (program, args) run in a shell.
fn installer(name: &str) -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        // only run when Prism can't find the tool. --force: if Windows still has a record of it
        // (files deleted, broken install), plain `install` turns into "no upgrade available" and fails
        let winget = |id: &str| ("winget".to_string(), ["install", "--id", id, "-e", "--source", "winget", "--accept-package-agreements", "--accept-source-agreements", "--force"].map(String::from).to_vec());
        // old Windows PowerShell needs TLS 1.2 switched on, and UTF-8 keeps Korean errors readable
        let script = |url: &str| {
            let ps = format!("[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; irm {url} | iex");
            ("powershell".to_string(), vec!["-NoProfile".into(), "-ExecutionPolicy".into(), "Bypass".into(), "-Command".into(), ps])
        };
        return match name {
            "git" => winget("Git.Git"),
            "node" => winget("OpenJS.NodeJS.LTS"),
            "claude" => script("https://claude.ai/install.ps1"),
            "agy" => script("https://antigravity.google/cli/install.ps1"),
            _ => ("npm".into(), vec!["install".into(), "-g".into(), "@openai/codex@latest".into()]),
        };
    }
    #[allow(unreachable_code)]
    match name {
        // Homebrew if present; otherwise Apple's Command Line Tools (opens Apple's installer window)
        "git" if sys::which("brew").is_some() => ("brew".into(), vec!["install".into(), "git".into()]),
        "git" => ("xcode-select".into(), vec!["--install".into()]),
        "claude" => ("sh".into(), vec!["-c".into(), "curl -fsSL https://claude.ai/install.sh | bash".into()]),
        "agy" => ("sh".into(), vec!["-c".into(), "curl -fsSL https://antigravity.google/cli/install.sh | bash".into()]),
        _ => ("sh".into(), vec!["-c".into(), "curl -fsSL https://chatgpt.com/codex/install.sh | sh".into()]),
    }
}

/// Non-interactive update. Claude has `claude update`; Codex's own `codex update` can't always
/// tell how it was installed, so fall back to the official installer (its documented update path).
fn update(name: &str) -> Result<(), String> {
    let ok = |c: &mut std::process::Command| c.stdin(std::process::Stdio::null()).output().map(|o| o.status.success()).unwrap_or(false);
    if ok(sys::command(name).arg("update")) {
        return Ok(());
    }
    let (prog, args) = installer(name);
    if ok(sys::command(&prog).args(&args)) { Ok(()) } else { Err("업데이트 실패".into()) }
}

fn status_all(state: &CliState) -> Vec<CliStatus> {
    sys::refresh_path(); // pick up anything installed since the last check
    let notes = state.notes.lock().unwrap().clone();
    tools()
        .into_iter()
        .map(|n| {
            let v = version(n);
            CliStatus { name: n.into(), label: label(n).into(), installed: v.is_some(), version: v, note: notes.get(n).cloned() }
        })
        .collect()
}

/// Update every installed CLI unless a team is working (replacing a running binary fails on Windows).
pub fn auto_update(app: &AppHandle) {
    let state = app.state::<CliState>();
    if !state.auto_update.load(Ordering::Relaxed) || app.state::<Arc<crate::team::TeamManager>>().any_running() {
        return;
    }
    for name in CLIS {
        let Some(before) = version(name) else { continue };
        let note = match update(name) {
            Ok(()) => match version(name) {
                Some(after) if after != before => format!("{before} → {after} 업데이트됨"),
                _ => "최신 버전".into(),
            },
            Err(e) => e,
        };
        state.notes.lock().unwrap().insert(name.into(), note);
    }
    let _ = app.emit("cli://status", status_all(&state));
}

/// Startup + every 6 hours.
pub fn start_auto_update(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(20)); // let the app settle first
        auto_update(&app);
        std::thread::sleep(Duration::from_secs(6 * 3600));
    });
}

#[tauri::command]
pub async fn cli_status(app: AppHandle) -> Vec<CliStatus> {
    tauri::async_runtime::spawn_blocking(move || status_all(&app.state::<CliState>())).await.unwrap_or_default()
}

#[tauri::command]
pub fn cli_auto_update(state: State<'_, CliState>) -> bool {
    state.auto_update.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn cli_set_auto_update(state: State<'_, CliState>, on: bool) {
    state.auto_update.store(on, Ordering::Relaxed);
    if let Some(f) = &state.file {
        let _ = std::fs::create_dir_all(f.parent().unwrap());
        let _ = std::fs::write(f, serde_json::json!({ "autoUpdate": on }).to_string());
    }
}

/// Install (or reinstall to latest) in a PTY the UI shows, so the user sees the installer run.
#[tauri::command]
pub fn cli_install(app: AppHandle, pty: State<'_, Pty>, name: String, cols: u16, rows: u16) -> Result<u32, String> {
    if !tools().contains(&name.as_str()) {
        return Err("알 수 없는 도구".into());
    }
    let (program, args) = installer(&name);
    let cwd = std::env::home_dir().map(|h| h.to_string_lossy().into_owned()).unwrap_or_else(|| ".".into());
    let spec = SpawnSpec { program: Some(program), args, cwd, env: vec![], cols, rows };
    setup_log::spawn(&app, &pty, spec, format!("install {name}"))
}

/// Run one update now (button), returning the fresh status.
#[tauri::command]
pub async fn cli_update_now(app: AppHandle) -> Vec<CliStatus> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<CliState>();
        let was = state.auto_update.swap(true, Ordering::Relaxed);
        auto_update(&app);
        state.auto_update.store(was, Ordering::Relaxed);
        status_all(&state)
    })
    .await
    .unwrap_or_default()
}
