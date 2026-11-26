//! How to launch each agent CLI as a Prism team member: model, role prompt, our MCP server
//! (delegate / report / escalate), status hooks and permission settings — all per process, so the
//! user's own CLI config is left alone.

use std::path::{Path, PathBuf};

use serde_json::json;

use crate::sys;

pub struct Ctx<'a> {
    /// "claude" | "codex"
    pub kind: &'a str,
    pub agent_id: &'a str,
    pub project_id: &'a str,
    /// http://127.0.0.1:PORT
    pub base: &'a str,
    pub token: &'a str,
    /// where per-agent config files go
    pub dir: &'a Path,
    pub model: &'a str,
    pub effort: &'a str,
    /// "default" | "acceptEdits" | "bypassPermissions" (Claude names; mapped per CLI)
    pub permission_mode: &'a str,
    pub system: &'a str,
    pub prompt: Option<String>,
    pub session_id: &'a str,
    /// continue this earlier session instead of starting a new one
    pub resume: Option<String>,
    pub cwd: &'a str,
    /// folders the engine MCP servers may read besides `cwd` (never written): the 총괄's and
    /// 팀장's view of the workers' folders. Created if missing, since the server needs them to exist.
    pub extra_read_roots: Vec<String>,
    /// files the user attached (readable without prompting)
    pub attach_dir: Option<String>,
    /// account home (CLAUDE_CONFIG_DIR / CODEX_HOME / …); None = the CLI's default
    pub home: Option<String>,
}

pub struct Launch {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    /// for structured agents: the opening message, sent once the process is up
    pub first_message: Option<String>,
    /// Codex: options for `codex exec resume` turns
    pub resume_args: Vec<String>,
    /// Antigravity: what the ACP session is created with
    pub acp: Option<crate::structured::AcpSetup>,
    /// Codex: other models to try if the plan doesn't allow the chosen one
    pub fallback_models: Vec<String>,
}

/// Commands agents need for the commit → report → merge loop; nothing that leaves the machine.
pub const SAFE_TOOLS: &[&str] = &[
    "mcp__prism",
    "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)",
    "Bash(git add:*)", "Bash(git commit:*)", "Bash(git merge:*)", "Bash(git branch:*)",
    "Bash(git checkout:*)", "Bash(git switch:*)", "Bash(git rev-parse:*)", "Bash(git stash:*)",
    "Bash(ls:*)", "Bash(cat:*)", "Bash(pwd)", "Bash(mkdir:*)", "Bash(head:*)", "Bash(tail:*)", "Bash(wc:*)",
    "Bash(touch:*)", "Bash(cp:*)", "Bash(find:*)", "Bash(grep:*)", "Bash(rg:*)", "Bash(echo:*)", "Bash(which:*)",
    // building, testing and running the project the team is making
    "Bash(npm install:*)", "Bash(npm i:*)", "Bash(npm ci:*)", "Bash(npm run:*)", "Bash(npm test:*)", "Bash(npx:*)",
    "Bash(pnpm install:*)", "Bash(pnpm add:*)", "Bash(pnpm run:*)", "Bash(pnpm test:*)", "Bash(pnpm build:*)", "Bash(pnpm dev:*)", "Bash(pnpm exec:*)",
    "Bash(yarn:*)", "Bash(bun:*)", "Bash(node:*)", "Bash(tsc:*)",
    "Bash(python:*)", "Bash(python3:*)", "Bash(pip install:*)", "Bash(pip3 install:*)", "Bash(pytest:*)", "Bash(uv:*)",
    "Bash(cargo build:*)", "Bash(cargo test:*)", "Bash(cargo run:*)", "Bash(cargo check:*)", "Bash(go build:*)", "Bash(go test:*)", "Bash(go run:*)",
];

impl Ctx<'_> {
    fn mcp_url(&self) -> String {
        format!("{}/mcp/{}/{}?t={}", self.base, self.project_id, self.agent_id, self.token)
    }
    fn file(&self, ext: &str) -> PathBuf {
        self.dir.join(format!("{}.{ext}", self.agent_id))
    }
}

/// An engine's CLI if it is installed: `$PRISM_<ENGINE>_CLI` when that file exists, else
/// `~/.prism/engines/<engine>/<engine>-cli`. None = no MCP server for agents.
fn engine_cli_at(engine: &str, env: Option<PathBuf>, home: &Path) -> Option<PathBuf> {
    let default = home.join(format!(".prism/engines/{engine}/{engine}-cli"));
    env.into_iter().chain(std::iter::once(default)).find(|p| p.is_file())
}

/// figcraft's CLI (`PRISM_FIGCRAFT_CLI` overrides the default location).
pub fn figcraft_cli() -> Option<PathBuf> {
    engine_cli_at("figcraft", std::env::var_os("PRISM_FIGCRAFT_CLI").map(PathBuf::from), &home_dir())
}

/// deckcraft's CLI (`PRISM_DECKCRAFT_CLI` overrides the default location).
pub fn deckcraft_cli() -> Option<PathBuf> {
    engine_cli_at("deckcraft", std::env::var_os("PRISM_DECKCRAFT_CLI").map(PathBuf::from), &home_dir())
}

/// Every installed engine CLI that agents get an MCP server for: (server name, CLI path).
fn installed_engines() -> Vec<(&'static str, PathBuf)> {
    [("figcraft", figcraft_cli()), ("deckcraft", deckcraft_cli())]
        .into_iter()
        .filter_map(|(name, cli)| cli.map(|p| (name, p)))
        .collect()
}

/// An engine's MCP server (`<cli> mcp`). Writes only inside the agent's folder; reads inside that
/// folder and the extra read roots. Same for every engine: the flags are the engines' shared
/// `--automation-*` confinement (each flag may repeat).
fn engine_mcp_args(c: &Ctx) -> Vec<String> {
    let mut args = vec!["mcp".to_string(), "--automation-read-root".into(), c.cwd.into()];
    for root in &c.extra_read_roots {
        args.extend(["--automation-read-root".into(), root.clone()]);
    }
    args.extend(["--automation-write-root".into(), c.cwd.into()]);
    args
}

fn url_encode(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~/".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

/// Where a member's CLI reaches an engine: through Prism, which starts the engine (with the
/// member's own roots from `engine_mcp_args`) only when it is first used and stops it when idle
/// (see `engines.rs`). `r`/`w` carry the read/write roots.
fn engine_url(c: &Ctx, name: &str) -> String {
    let args = engine_mcp_args(c);
    let mut q = format!("t={}", url_encode(c.token));
    for w in args.windows(2) {
        let k = match w[0].as_str() {
            "--automation-read-root" => "r",
            "--automation-write-root" => "w",
            _ => continue,
        };
        q += &format!("&{k}={}", url_encode(&w[1]));
    }
    format!("{}/engine/{name}/{}/{}?{q}", c.base, url_encode(c.project_id), url_encode(c.agent_id))
}

/// The `mcpServers` object for Claude's --mcp-config: Prism's own server, plus each installed engine.
fn claude_mcp_servers(c: &Ctx, engines: &[(&str, PathBuf)]) -> serde_json::Value {
    let mut servers = json!({ "prism": { "type": "http", "url": c.mcp_url() } });
    for (name, _cli) in engines {
        servers[*name] = json!({ "type": "http", "url": engine_url(c, name) });
    }
    servers
}

pub fn build(c: &Ctx) -> Result<Launch, String> {
    std::fs::create_dir_all(c.dir).map_err(|e| e.to_string())?;
    for root in &c.extra_read_roots {
        std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    }
    match c.kind {
        "claude" => claude(c),
        "codex" => codex(c),
        "antigravity" => antigravity(c),
        k => Err(format!("지원하지 않는 에이전트: {k}")),
    }
}

/// Where every member of a project builds: one shared cargo target folder, so a work copy doesn't
/// grow its own (3–8 GB each) and a build a teammate already did is reused. Sent to each member's
/// process as `CARGO_TARGET_DIR`.
pub fn shared_build_env(project: &str) -> Vec<(String, String)> {
    vec![("CARGO_TARGET_DIR".into(), build_cache_dir(project).to_string_lossy().into_owned())]
}

/// `<project>/.prism/cargo-target`: the shared build folder of a project's team.
pub fn build_cache_dir(project: &str) -> PathBuf {
    PathBuf::from(project).join(".prism").join("cargo-target")
}

/// Pre-accept the CLI's "trust this folder?" prompt for `dir`.
pub fn trust(kind: &str, dir: &str, home: Option<&str>) {
    match kind {
        "claude" => sys::ensure_claude_trust(dir, home),
        "codex" => codex_trust(dir, home),
        _ => {}
    }
}

// ── Claude Code ───────────────────────────────────────

/// Whether Claude Code has a conversation `session_id` it can resume from `cwd`. It keeps them per
/// folder (`<config>/projects/<cwd with every non-alphanumeric char as '-'>/<id>.jsonl`) and only
/// writes one once the session gets its first message — so a lead that clocked in but was never
/// spoken to, or one whose team moved to another folder, has nothing to `--resume` (doing so exits
/// with "No conversation found"). `home` is the account's CLAUDE_CONFIG_DIR (None → ~/.claude).
pub fn claude_session_exists(home: Option<&str>, session_id: &str, cwd: &str) -> bool {
    let base = match home {
        Some(h) => std::path::PathBuf::from(h),
        None => match std::env::var_os("CLAUDE_CONFIG_DIR") {
            Some(d) => d.into(),
            None => match std::env::home_dir() {
                Some(h) => h.join(".claude"),
                None => return true, // can't tell: let --resume try
            },
        },
    };
    let folder: String = cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    base.join("projects").join(folder).join(format!("{session_id}.jsonl")).is_file()
}

fn claude(c: &Ctx) -> Result<Launch, String> {
    let mcp_path = c.file("mcp.json");
    let settings_path = c.file("settings.json");
    // structured mode: events come over stdout, approvals through our MCP `approve` tool,
    // so no hooks or status line are needed
    let settings = json!({});
    std::fs::write(&mcp_path, json!({ "mcpServers": claude_mcp_servers(c, &installed_engines()) }).to_string()).map_err(|e| e.to_string())?;
    std::fs::write(&settings_path, settings.to_string()).map_err(|e| e.to_string())?;

    // --allowedTools and --mcp-config are variadic: put them first, one argv entry per rule,
    // and end with a single-value flag right before the positional prompt
    let mut args: Vec<String> = vec!["--allowedTools".into()];
    args.extend(SAFE_TOOLS.iter().map(|t| t.to_string()));
    if let Some(d) = &c.attach_dir {
        args.extend(["--add-dir".into(), d.clone()]);
    }
    args.extend([
        "--mcp-config".into(), mcp_path.to_string_lossy().into_owned(),
        "--settings".into(), settings_path.to_string_lossy().into_owned(),
        "--model".into(), c.model.into(),
        if c.resume.is_some() { "--resume".into() } else { "--session-id".into() }, c.session_id.into(),
        "--append-system-prompt".into(), c.system.into(),
    ]);
    if !c.effort.is_empty() {
        args.extend(["--effort".into(), c.effort.into()]);
    }
    args.extend([
        "-p".into(),
        "--input-format".into(), "stream-json".into(),
        "--output-format".into(), "stream-json".into(),
        "--verbose".into(),
        "--permission-prompt-tool".into(), "mcp__prism__approve".into(),
        "--permission-mode".into(), c.permission_mode.into(),
    ]);
    let mut env: Vec<(String, String)> = c.home.clone().map(|h| ("CLAUDE_CONFIG_DIR".to_string(), h)).into_iter().collect();
    env.push(("MCP_TOOL_TIMEOUT".into(), "600000".into())); // approvals wait for a person
    Ok(Launch { program: "claude".into(), args, env, first_message: c.prompt.clone(), resume_args: vec![], acp: None, fallback_models: vec![] })
}

// ── Codex ─────────────────────────────────────────────

fn home_dir() -> PathBuf {
    std::env::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// Codex `-c` override that adds an engine's MCP server (the same Prism endpoint as for Claude).
fn codex_engine_config(c: &Ctx, name: &str) -> Vec<String> {
    vec!["-c".into(), format!("mcp_servers.{name}.url={}", serde_json::to_string(&engine_url(c, name)).unwrap_or_default())]
}

/// The account's CODEX_HOME (default ~/.codex).
pub fn codex_account_home(home: Option<&str>) -> PathBuf {
    home.map(PathBuf::from)
        .or_else(|| std::env::var_os("CODEX_HOME").map(PathBuf::from))
        .unwrap_or_else(|| home_dir().join(".codex"))
}

fn codex(c: &Ctx) -> Result<Launch, String> {
    // Structured: `codex exec --json` per turn, `codex exec resume <thread>` after that.
    // Uses the account's own CODEX_HOME (no hooks needed — events come from --json).
    let toml_str = |v: &str| serde_json::to_string(v).unwrap_or_default(); // JSON string == TOML basic string
    let git_dir = sys::git(c.cwd, &["rev-parse", "--path-format=absolute", "--git-common-dir"]).ok();
    // config shared by the first turn and every resume
    let mut shared: Vec<String> = vec![
        "--json".into(),
        "--skip-git-repo-check".into(),
        "-c".into(), format!("mcp_servers.prism.url={}", toml_str(&c.mcp_url())),
        "-c".into(), "mcp_servers.prism.default_tools_approval_mode=\"approve\"".into(),
        "-c".into(), format!("developer_instructions={}", toml_str(c.system)),
        "-c".into(), format!("projects.{}.trust_level=\"trusted\"", toml_str(c.cwd)),
    ];
    for (name, _cli) in installed_engines() {
        shared.extend(codex_engine_config(c, name));
    }
    if !c.model.is_empty() {
        shared.extend(["-m".into(), c.model.into()]);
    }
    if !c.effort.is_empty() {
        shared.extend(["-c".into(), format!("model_reasoning_effort=\"{}\"", c.effort)]);
    }
    let mut first = shared.clone();
    let mut resume = shared;
    if c.permission_mode == "bypassPermissions" {
        first.push("--dangerously-bypass-approvals-and-sandbox".into());
        resume.push("--dangerously-bypass-approvals-and-sandbox".into());
    } else {
        // edits inside the project; anything riskier goes to Codex's automatic reviewer
        let mode = if c.permission_mode == "default" { "read-only" } else { "workspace-write" };
        first.extend(["-s".into(), mode.into()]);
        if c.permission_mode != "default" {
            first.push("--approve-for-me".into());
        }
        resume.extend(["-c".into(), format!("sandbox_mode=\"{mode}\"")]);
        // commits from a worktree write into the main repo's .git
        if let Some(g) = &git_dir {
            first.extend(["--add-dir".into(), g.clone()]);
            resume.extend(["-c".into(), format!("sandbox_workspace_write.writable_roots=[{}]", toml_str(g))]);
        }
    }
    let env = c.home.clone().map(|h| vec![("CODEX_HOME".to_string(), h)]).unwrap_or_default();
        let fallback_models = models_for("codex", c.home.clone()).into_iter().map(|m| m.id).filter(|m| m != c.model).collect();
    Ok(Launch { program: "codex".into(), args: first, env, first_message: c.prompt.clone(), resume_args: resume, acp: None, fallback_models })
}

// ── Antigravity (Google) ──────────────────────────────

/// Claude's model names (opus, sonnet-4-5…): meaningless to Gemini or Codex, which then use their default.
pub fn is_claude_model(m: &str) -> bool {
    let m = m.to_lowercase();
    ["opus", "sonnet", "haiku", "fable", "claude"].iter().any(|n| m.starts_with(n))
}

fn antigravity(c: &Ctx) -> Result<Launch, String> {
    // ACP over stdio. Antigravity only takes stdio MCP servers, so it gets Prism's own
    // executable in bridge mode, which forwards to the HTTP MCP endpoint.
    let exe = std::env::current_exe().map_err(|e| e.to_string())?.to_string_lossy().into_owned();
    let mut args = vec!["acp".to_string()];
    if c.permission_mode == "bypassPermissions" {
        args.push("--dangerously-skip-permissions".into());
    }
    if let Ok(g) = sys::git(c.cwd, &["rev-parse", "--path-format=absolute", "--git-common-dir"]) {
        args.extend(["--add-dir".into(), g]);
    }
    Ok(Launch {
        program: "agy".into(),
        args,
        env: vec![("AGY_CLI_DISABLE_AUTO_UPDATE".into(), "true".into())],
        first_message: c.prompt.clone(),
        resume_args: vec![],
        acp: Some(crate::structured::AcpSetup {
            cwd: c.cwd.into(),
            system: c.system.into(),
            bridge: (exe, vec!["--mcp-bridge".into(), c.mcp_url()]),
            // a Claude name left over from a preset would make Antigravity refuse the session's model
            model: if is_claude_model(c.model) { String::new() } else { c.model.into() },
            resume: c.resume.clone(),
        }),
        fallback_models: vec![],
    })
}

/// Trust is passed per launch (`-c projects."…".trust_level`), nothing to write.
fn codex_trust(_dir: &str, _home: Option<&str>) {}

// ── model lists ───────────────────────────────────────

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
    pub note: String,
    pub efforts: Vec<String>,
}

/// Models for Codex (from the CLI's own cache) and Antigravity (`agy models`); Claude's list
/// lives in the UI. Async so it never runs on the UI thread — `agy models` takes ~2s, and the
/// settings screen asks once per role.
#[tauri::command]
pub async fn models_list(provider: String, home: Option<String>) -> Vec<ModelInfo> {
    tauri::async_runtime::spawn_blocking(move || models_for(&provider, home)).await.unwrap_or_default()
}

/// Fetch slow model lists in the background at startup, so the settings screen opens instantly.
pub fn warm_models() {
    std::thread::spawn(|| {
        if sys::which("agy").is_some() {
            agy_models();
        }
    });
}

/// Whether agy is signed in, by its own account: it lists models only then ("Auth mode is
/// unspecified … returning empty response" otherwise). A "no" is re-asked at most every 15 s,
/// since the account sheet polls while the user signs in and each ask takes ~2 s.
pub fn agy_signed_in() -> bool {
    static LAST_NO: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);
    if LAST_NO.lock().unwrap().is_some_and(|t| t.elapsed() < std::time::Duration::from_secs(15)) {
        return false;
    }
    let yes = !agy_models().is_empty();
    *LAST_NO.lock().unwrap() = (!yes).then(std::time::Instant::now);
    yes
}

/// `agy models`, remembered for a while: one run serves every role (callers queue on the lock).
fn agy_models() -> Vec<ModelInfo> {
    static CACHE: std::sync::Mutex<Option<(std::time::Instant, Vec<ModelInfo>)>> = std::sync::Mutex::new(None);
    let mut cache = CACHE.lock().unwrap();
    if let Some((at, list)) = cache.as_ref() {
        if at.elapsed() < std::time::Duration::from_secs(600) && !list.is_empty() {
            return list.clone();
        }
    }
    // `agy models` prints "<id>\t<label>"
    let Ok(out) = sys::command("agy").arg("models").env("AGY_CLI_DISABLE_AUTO_UPDATE", "true").output() else { return vec![] };
    let list: Vec<ModelInfo> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let (id, label) = l.split_once('\t')?;
            Some(ModelInfo { id: id.trim().into(), label: label.trim().into(), note: String::new(), efforts: vec![] })
        })
        .collect();
    *cache = Some((std::time::Instant::now(), list.clone()));
    list
}

pub fn models_for(provider: &str, home: Option<String>) -> Vec<ModelInfo> {
    match provider {
        "codex" => {
            let file = codex_account_home(home.as_deref()).join("models_cache.json");
            let Ok(text) = std::fs::read_to_string(file) else { return vec![] };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { return vec![] };
            v.get("models")
                .and_then(|m| m.as_array())
                .map(|ms| {
                    ms.iter()
                        .filter(|m| m.get("visibility").and_then(|x| x.as_str()) == Some("list"))
                        .filter_map(|m| {
                            Some(ModelInfo {
                                id: m.get("slug")?.as_str()?.into(),
                                label: m.get("display_name").and_then(|x| x.as_str()).unwrap_or("").into(),
                                note: m.get("description").and_then(|x| x.as_str()).unwrap_or("").into(),
                                efforts: m
                                    .get("supported_reasoning_levels")
                                    .and_then(|x| x.as_array())
                                    .map(|a| a.iter().filter_map(|r| r.get("effort").and_then(|e| e.as_str()).map(String::from)).collect())
                                    .unwrap_or_default(),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        "antigravity" => agy_models(),
        _ => vec![],
    }
}

#[cfg(test)]
mod figcraft_tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("prism-t21-launch-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn ctx<'a>(dir: &'a Path, cwd: &'a str) -> Ctx<'a> {
        Ctx {
            kind: "claude", agent_id: "a1", project_id: "p1", base: "http://127.0.0.1:1", token: "t", dir,
            model: "", effort: "", permission_mode: "default", system: "", prompt: None, session_id: "s",
            resume: None, cwd, extra_read_roots: vec![], attach_dir: None, home: None,
        }
    }

    #[test]
    fn env_path_wins_only_when_it_exists_else_default_location() {
        let home = tmp("home");
        let default = home.join(".prism/engines/figcraft/figcraft-cli");
        assert_eq!(engine_cli_at("figcraft", None, &home), None, "nothing installed");
        std::fs::create_dir_all(default.parent().unwrap()).unwrap();
        std::fs::write(&default, "").unwrap();
        assert_eq!(engine_cli_at("figcraft", None, &home), Some(default.clone()));
        // env path missing → still the default
        assert_eq!(engine_cli_at("figcraft", Some(home.join("nope")), &home), Some(default.clone()));
        // env path present → it wins
        let custom = home.join("custom-cli");
        std::fs::write(&custom, "").unwrap();
        assert_eq!(engine_cli_at("figcraft", Some(custom.clone()), &home), Some(custom));
    }

    #[test]
    fn claude_config_without_figcraft_is_unchanged() {
        let dir = tmp("nofc");
        let c = ctx(&dir, "/work/wt");
        let v = claude_mcp_servers(&c, &[]);
        assert_eq!(v.to_string(), json!({ "prism": { "type": "http", "url": c.mcp_url() } }).to_string());
    }

    #[test]
    fn claude_config_with_figcraft_limits_it_to_the_agent_folder() {
        let dir = tmp("fc");
        let c = ctx(&dir, "/work/wt");
        let v = claude_mcp_servers(&c, &[("figcraft", PathBuf::from("/opt/figcraft-cli"))]);
        assert_eq!(v["figcraft"]["type"], "http");
        assert_eq!(v["figcraft"]["url"], "http://127.0.0.1:1/engine/figcraft/p1/a1?t=t&r=/work/wt&w=/work/wt");
        assert!(v["prism"].is_object());
    }

    #[test]
    fn codex_overrides_name_the_same_server() {
        let out = codex_engine_config(&ctx(Path::new("/unused"), "/work/wt"), "figcraft");
        assert_eq!(out[0], "-c");
        assert_eq!(out[1], "mcp_servers.figcraft.url=\"http://127.0.0.1:1/engine/figcraft/p1/a1?t=t&r=/work/wt&w=/work/wt\"");
    }
}

#[cfg(test)]
mod deckcraft_tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("prism-t28-launch-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn ctx<'a>(dir: &'a Path, cwd: &'a str) -> Ctx<'a> {
        Ctx {
            kind: "claude", agent_id: "a1", project_id: "p1", base: "http://127.0.0.1:1", token: "t", dir,
            model: "", effort: "", permission_mode: "default", system: "", prompt: None, session_id: "s",
            resume: None, cwd, extra_read_roots: vec![], attach_dir: None, home: None,
        }
    }

    #[test]
    fn env_path_wins_only_when_it_exists_else_default_location() {
        let home = tmp("home");
        let default = home.join(".prism/engines/deckcraft/deckcraft-cli");
        assert_eq!(engine_cli_at("deckcraft", None, &home), None, "nothing installed");
        std::fs::create_dir_all(default.parent().unwrap()).unwrap();
        std::fs::write(&default, "").unwrap();
        assert_eq!(engine_cli_at("deckcraft", None, &home), Some(default.clone()));
        // env path missing → still the default
        assert_eq!(engine_cli_at("deckcraft", Some(home.join("nope")), &home), Some(default.clone()));
        // env path present → it wins
        let custom = home.join("custom-cli");
        std::fs::write(&custom, "").unwrap();
        assert_eq!(engine_cli_at("deckcraft", Some(custom.clone()), &home), Some(custom));
        // a folder at the default location is not a CLI
        let home2 = tmp("home2");
        std::fs::create_dir_all(home2.join(".prism/engines/deckcraft/deckcraft-cli")).unwrap();
        assert_eq!(engine_cli_at("deckcraft", None, &home2), None);
    }

    #[test]
    fn claude_config_without_engines_is_unchanged() {
        let dir = tmp("none");
        let c = ctx(&dir, "/work/wt");
        let v = claude_mcp_servers(&c, &[]);
        assert_eq!(v.to_string(), json!({ "prism": { "type": "http", "url": c.mcp_url() } }).to_string());
        assert!(v.get("deckcraft").is_none());
    }

    #[test]
    fn claude_config_with_deckcraft_limits_it_to_the_agent_folder() {
        let dir = tmp("dc");
        let c = ctx(&dir, "/work/wt");
        let v = claude_mcp_servers(&c, &[("deckcraft", PathBuf::from("/opt/deckcraft-cli"))]);
        assert_eq!(v["deckcraft"]["type"], "http");
        assert_eq!(v["deckcraft"]["url"], "http://127.0.0.1:1/engine/deckcraft/p1/a1?t=t&r=/work/wt&w=/work/wt");
        assert!(v.get("figcraft").is_none());
        assert!(v["prism"].is_object());
    }

    #[test]
    fn codex_overrides_name_the_deckcraft_server() {
        let out = codex_engine_config(&ctx(Path::new("/unused"), "/work/wt"), "deckcraft");
        assert_eq!(out[0], "-c");
        assert_eq!(out[1], "mcp_servers.deckcraft.url=\"http://127.0.0.1:1/engine/deckcraft/p1/a1?t=t&r=/work/wt&w=/work/wt\"");
    }

    #[test]
    fn engine_url_escapes_odd_folder_names() {
        let c = ctx(Path::new("/unused"), "/w/내 폴더&x");
        assert_eq!(engine_url(&c, "deckcraft"), "http://127.0.0.1:1/engine/deckcraft/p1/a1?t=t&r=/w/%EB%82%B4%20%ED%8F%B4%EB%8D%94%26x&w=/w/%EB%82%B4%20%ED%8F%B4%EB%8D%94%26x");
    }

    #[test]
    fn deckcraft_is_not_a_safe_tool() {
        assert!(!SAFE_TOOLS.iter().any(|t| t.contains("deckcraft")));
    }
}

#[cfg(test)]
mod read_root_tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("prism-t35-launch-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn ctx<'a>(dir: &'a Path, cwd: &'a str, extra: &[&str]) -> Ctx<'a> {
        Ctx {
            kind: "claude", agent_id: "a1", project_id: "p1", base: "http://127.0.0.1:1", token: "t", dir,
            model: "", effort: "", permission_mode: "default", system: "", prompt: None, session_id: "s",
            resume: None, cwd, extra_read_roots: extra.iter().map(|s| s.to_string()).collect(), attach_dir: None, home: None,
        }
    }

    /// (read roots, write roots) of an engine's args, in order
    fn roots(args: &[String]) -> (Vec<String>, Vec<String>) {
        let mut reads = vec![];
        let mut writes = vec![];
        for w in args.windows(2) {
            match w[0].as_str() {
                "--automation-read-root" => reads.push(w[1].clone()),
                "--automation-write-root" => writes.push(w[1].clone()),
                _ => {}
            }
        }
        (reads, writes)
    }

    #[test]
    fn lead_and_manager_read_all_workers_folders_and_write_only_their_own() {
        let dir = tmp("lead");
        let cwd = "/proj/.prism/worktrees/r1-t-1";
        let c = ctx(&dir, cwd, &["/proj/.prism/worktrees"]);
        let v = claude_mcp_servers(&c, &[("figcraft", PathBuf::from("/opt/figcraft-cli"))]);
        assert_eq!(v["figcraft"]["url"], format!("http://127.0.0.1:1/engine/figcraft/p1/a1?t=t&r={cwd}&r=/proj/.prism/worktrees&w={cwd}"));
        let (reads, writes) = roots(&engine_mcp_args(&c));
        assert_eq!(reads, vec![cwd.to_string(), "/proj/.prism/worktrees".to_string()]);
        assert_eq!(writes, vec![cwd.to_string()]);
    }

    #[test]
    fn worker_reads_and_writes_only_its_own_folder() {
        let dir = tmp("worker");
        let cwd = "/proj/.prism/worktrees/r1-t-2";
        let c = ctx(&dir, cwd, &[]);
        let v = claude_mcp_servers(&c, &[("figcraft", PathBuf::from("/opt/figcraft-cli"))]);
        assert_eq!(v["figcraft"]["url"], format!("http://127.0.0.1:1/engine/figcraft/p1/a1?t=t&r={cwd}&w={cwd}"));
        let (reads, writes) = roots(&engine_mcp_args(&c));
        assert_eq!(reads, vec![cwd.to_string()]);
        assert_eq!(writes, vec![cwd.to_string()]);
    }

    #[test]
    fn codex_gets_the_same_read_roots_as_claude() {
        let dir = tmp("codex");
        let c = ctx(&dir, "/work/wt", &["/work/.prism/worktrees"]);
        let out = codex_engine_config(&c, "figcraft");
        assert_eq!(out[1], "mcp_servers.figcraft.url=\"http://127.0.0.1:1/engine/figcraft/p1/a1?t=t&r=/work/wt&r=/work/.prism/worktrees&w=/work/wt\"");
    }

    #[test]
    fn build_creates_the_read_root_folder_so_the_engine_server_can_start() {
        let base = tmp("build");
        let worktrees = base.join("proj").join(".prism").join("worktrees");
        let agents = base.join("agents");
        let cwd = worktrees.join("r1-t-1").to_string_lossy().into_owned();
        assert!(!worktrees.exists());
        let c = ctx(&agents, &cwd, &[&worktrees.to_string_lossy()]);
        build(&c).unwrap();
        assert!(worktrees.is_dir());
    }
}
