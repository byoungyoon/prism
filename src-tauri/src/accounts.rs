//! Agent accounts (Claude / Codex). An account is the CLI's home directory
//! (CLAUDE_CONFIG_DIR / CODEX_HOME / …): each provider's "default" uses whatever the app
//! inherited (e.g. ~/.claude); added accounts get their own directory under the app data dir,
//! so each keeps its own login. Subscription logins only — Prism never asks for API keys.

use std::collections::HashMap;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::pty::{Pty, SpawnSpec};
use crate::sys;

#[derive(Serialize, Deserialize, Clone)]
struct Stored {
    id: String,
    #[serde(default = "claude")]
    provider: String,
    name: String,
    /// None = inherited/default config dir
    dir: Option<String>,
}

fn claude() -> String {
    "claude".into()
}

#[derive(Serialize, Deserialize, Default)]
struct File {
    accounts: Vec<Stored>,
    /// legacy single-provider field (claude)
    #[serde(default, skip_serializing)]
    active: Option<String>,
    /// provider → active account id
    #[serde(default)]
    actives: HashMap<String, String>,
}

pub const PROVIDERS: [&str; 3] = ["claude", "codex", "antigravity"];

/// Env var that points a CLI at an account home.
fn home_var(provider: &str) -> &'static str {
    match provider {
        "codex" => "CODEX_HOME",
        _ => "CLAUDE_CONFIG_DIR",
    }
}

fn default_id(provider: &str) -> String {
    if provider == "claude" { "default".into() } else { format!("{provider}-default") }
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub logged_in: bool,
    /// "claude.ai" (subscription) | "console" / "api_key" (API billing) | "none"
    pub auth_method: String,
    pub email: Option<String>,
    pub org_name: Option<String>,
    pub subscription_type: Option<String>,
    pub config_directory: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub provider: String,
    pub name: String,
    pub dir: Option<String>,
    pub active: bool,
    pub status: AuthStatus,
}

pub struct Accounts {
    file: Option<PathBuf>,
    base: PathBuf,
    state: Mutex<File>,
}

impl Accounts {
    pub fn load(app: &AppHandle) -> Self {
        let data = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("prism"));
        let file = Some(data.join("accounts.json"));
        let mut state: File = file
            .as_ref()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        state.accounts.retain(|a| PROVIDERS.contains(&a.provider.as_str()));
        state.actives.retain(|p, _| PROVIDERS.contains(&p.as_str()));
        for (i, p) in PROVIDERS.iter().enumerate() {
            let id = default_id(p);
            if !state.accounts.iter().any(|a| a.id == id) {
                state.accounts.insert(i.min(state.accounts.len()), Stored { id, provider: (*p).into(), name: "기본".into(), dir: None });
            }
        }
        if let Some(old) = state.active.take() {
            state.actives.entry("claude".into()).or_insert(old);
        }
        Self { file, base: data.join("claude-profiles"), state: Mutex::new(state) }
    }

    fn save(&self, state: &File) {
        if let Some(f) = &self.file {
            let _ = std::fs::create_dir_all(f.parent().unwrap());
            let _ = std::fs::write(f, serde_json::to_string_pretty(state).unwrap_or_default());
        }
    }

    fn get(&self, id: &str) -> Option<Stored> {
        self.state.lock().unwrap().accounts.iter().find(|a| a.id == id).cloned()
    }

    /// Home dir of the provider's active account (None = the CLI's default).
    pub fn active_dir(&self, provider: &str) -> Option<String> {
        let st = self.state.lock().unwrap();
        let id = st.actives.get(provider).cloned().unwrap_or_else(|| default_id(provider));
        st.accounts.iter().find(|a| a.id == id).and_then(|a| a.dir.clone())
    }

    pub fn active_status(&self, provider: &str) -> AuthStatus {
        status(provider, self.active_dir(provider).as_deref())
    }
}

fn cli(provider: &str, dir: Option<&str>) -> std::process::Command {
    let mut c = sys::command(provider);
    if let Some(d) = dir {
        c.env(home_var(provider), d);
    }
    c
}

pub fn status(provider: &str, dir: Option<&str>) -> AuthStatus {
    match provider {
        "codex" => codex_status(dir),
        "antigravity" => antigravity_status(),
        _ => claude_status(dir),
    }
}

/// `codex login status` prints e.g. "Logged in using ChatGPT" / "Not logged in".
fn codex_status(dir: Option<&str>) -> AuthStatus {
    let Ok(out) = cli("codex", dir).args(["login", "status"]).output() else {
        return AuthStatus { auth_method: "missing".into(), ..Default::default() };
    };
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)).to_lowercase();
    let logged_in = text.contains("logged in") && !text.contains("not logged in");
    let method = if !logged_in { "none" } else if text.contains("chatgpt") { "chatgpt" } else { "api_key" };
    AuthStatus { logged_in, auth_method: method.into(), ..Default::default() }
}

/// Antigravity signs in with a Google account and keeps the credential in the OS keyring (macOS
/// Keychain, Windows Credential Manager — service "gemini", account "antigravity") or, without a
/// keyring, in a token file. Those are checked without reading the secret; if none shows up, agy
/// itself is asked (it lists models only when signed in).
fn antigravity_status() -> AuthStatus {
    if sys::which("agy").is_none() {
        return AuthStatus { auth_method: "missing".into(), ..Default::default() };
    }
    let file = std::env::home_dir().map(|h| h.join(".gemini").join("antigravity-cli").join("antigravity-oauth-token"));
    let mut logged_in = file.is_some_and(|f| f.exists());
    #[cfg(target_os = "macos")]
    if !logged_in {
        logged_in = sys::command("/usr/bin/security")
            .args(["find-generic-password", "-s", "gemini", "-a", "antigravity"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
    }
    // go-keyring on Windows stores it as a generic credential named "gemini:antigravity"
    #[cfg(windows)]
    if !logged_in {
        logged_in = sys::command("cmdkey")
            .arg("/list")
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("gemini:antigravity"))
            .unwrap_or(false);
    }
    if !logged_in {
        logged_in = crate::launch::agy_signed_in();
    }
    AuthStatus { logged_in, auth_method: if logged_in { "google".into() } else { "none".into() }, ..Default::default() }
}

fn claude_status(dir: Option<&str>) -> AuthStatus {
    let Ok(out) = cli("claude", dir).args(["auth", "status"]).output() else {
        return AuthStatus { auth_method: "missing".into(), ..Default::default() };
    };
    let v: Value = serde_json::from_slice(&out.stdout).unwrap_or(Value::Null);
    let s = |k: &str| v.get(k).and_then(Value::as_str).map(String::from);
    AuthStatus {
        logged_in: v.get("loggedIn").and_then(Value::as_bool).unwrap_or(false),
        auth_method: s("authMethod").unwrap_or_else(|| "none".into()),
        email: s("email"),
        org_name: s("orgName"),
        subscription_type: s("subscriptionType"),
        config_directory: s("configDirectory"),
    }
}

fn list(accts: &Accounts) -> Vec<Account> {
    let st = accts.state.lock().unwrap();
    let actives = st.actives.clone();
    let entries = st.accounts.clone();
    drop(st);
    // login status per account, in parallel
    let handles: Vec<_> = entries
        .into_iter()
        .map(|a| std::thread::spawn(move || { let s = status(&a.provider, a.dir.as_deref()); (a, s) }))
        .collect();
    handles
        .into_iter()
        .filter_map(|h| h.join().ok())
        .map(|(a, status)| {
            let active = actives.get(&a.provider).cloned().unwrap_or_else(|| default_id(&a.provider)) == a.id;
            Account { active, id: a.id, provider: a.provider, name: a.name, dir: a.dir, status }
        })
        .collect()
}

#[tauri::command]
pub async fn accounts_list(app: AppHandle) -> Vec<Account> {
    tauri::async_runtime::spawn_blocking(move || {
        let all = list(&app.state::<Accounts>());
        // a subscription that's signed in counts as one the user uses: new teams default to it
        // (Claude first) even if it wasn't picked at first run
        for a in all.iter().filter(|a| a.active && a.status.logged_in) {
            app.state::<crate::projects::Projects>().add_provider(&a.provider);
        }
        all
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub fn account_add(accts: State<'_, Accounts>, provider: String, name: String) -> Result<String, String> {
    if !PROVIDERS.contains(&provider.as_str()) {
        return Err("지원하지 않는 서비스예요".into());
    }
    let name = name.trim();
    if name.is_empty() {
        return Err("이름을 입력해 주세요".into());
    }
    let id = uuid::Uuid::new_v4().to_string()[..8].to_string();
    let dir = accts.base.join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut st = accts.state.lock().unwrap();
    st.accounts.push(Stored { id: id.clone(), provider, name: name.into(), dir: Some(dir.to_string_lossy().into_owned()) });
    accts.save(&st);
    Ok(id)
}

#[tauri::command]
pub fn account_remove(accts: State<'_, Accounts>, id: String) -> Result<(), String> {
    if id == "default" || id.ends_with("-default") {
        return Err("기본 계정은 지울 수 없어요".into());
    }
    let mut st = accts.state.lock().unwrap();
    st.accounts.retain(|a| a.id != id);
    st.actives.retain(|_, v| v != &id);
    accts.save(&st);
    Ok(())
}

#[tauri::command]
pub fn account_set_active(accts: State<'_, Accounts>, id: String) -> Result<(), String> {
    let mut st = accts.state.lock().unwrap();
    let provider = st.accounts.iter().find(|a| a.id == id).map(|a| a.provider.clone()).ok_or("없는 계정이에요")?;
    st.actives.insert(provider, id);
    accts.save(&st);
    Ok(())
}

/// Runs `claude auth login` in a PTY the UI shows; the browser handles the actual sign-in.
#[tauri::command]
pub fn account_login(accts: State<'_, Accounts>, pty: State<'_, Pty>, id: String, cols: u16, rows: u16) -> Result<u32, String> {
    let a = accts.get(&id).ok_or("없는 계정이에요")?;
    let program = if a.provider == "antigravity" { "agy".to_string() } else { a.provider.clone() };
    let cwd = std::env::home_dir().map(|h| h.to_string_lossy().into_owned()).unwrap_or_else(|| ".".into());
    let env = a.dir.map(|d| vec![(home_var(&a.provider).to_string(), d)]).unwrap_or_default();
    // subscription sign-in for each CLI
    let args: Vec<String> = match a.provider.as_str() {
        "codex" => vec!["login".into()],
        "antigravity" => vec![], // the TUI asks to sign in with Google on first run
        _ => vec!["auth".into(), "login".into(), "--claudeai".into()],
    };
    pty.spawn(SpawnSpec { program: Some(program), args, cwd, env, cols, rows }, None)
}

#[tauri::command]
pub async fn account_logout(app: AppHandle, id: String) -> Result<(), String> {
    let a = app.state::<Accounts>().get(&id).ok_or("없는 계정이에요")?;
    tauri::async_runtime::spawn_blocking(move || {
        let args: &[&str] = match a.provider.as_str() {
            "codex" => &["logout"],
            "antigravity" => return Err("Antigravity는 앱 안에서 /logout 으로 로그아웃해요".to_string()),
            _ => &["auth", "logout"],
        };
        cli(&a.provider, a.dir.as_deref()).args(args).output().map(|_| ()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
