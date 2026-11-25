//! Process environment helpers: login-shell PATH, git, Claude trust.

use std::path::{Path, PathBuf};
use std::process::Command;

// ── PATH ──────────────────────────────────────────────
//
// GUI apps start with a minimal PATH, and tools installed while Prism runs (Git, Claude Code, …)
// aren't on the PATH it started with. So Prism keeps its own search path: the login shell's PATH
// plus the usual install folders, re-read after every install. Every spawned process gets it.

static SEARCH_PATH: std::sync::RwLock<Option<std::ffi::OsString>> = std::sync::RwLock::new(None);

pub fn search_path() -> std::ffi::OsString {
    SEARCH_PATH.read().unwrap().clone().or_else(|| std::env::var_os("PATH")).unwrap_or_default()
}

fn login_shell_path() -> Option<String> {
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let mut child = Command::new(&shell)
            .args(["-ilc", "printf '__PRISM__%s__PRISM__' \"$PATH\""])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .ok()?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if std::time::Instant::now() < deadline => std::thread::sleep(std::time::Duration::from_millis(50)),
                _ => {
                    let _ = child.kill();
                    return None;
                }
            }
        }
        let out = child.wait_with_output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        return text.split("__PRISM__").nth(1).filter(|p| !p.is_empty()).map(String::from);
    }
    #[allow(unreachable_code)]
    None
}

/// Where installers put things, in case the shell profile doesn't list them (yet).
fn extra_dirs() -> Vec<PathBuf> {
    let home = std::env::home_dir().unwrap_or_default();
    let mut v = vec![home.join(".local").join("bin")];
    #[cfg(unix)]
    v.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
    #[cfg(windows)]
    {
        let env = |k: &str| std::env::var_os(k).map(PathBuf::from).unwrap_or_default();
        v.extend([
            env("ProgramFiles").join("Git").join("cmd"),
            env("ProgramFiles").join("nodejs"),
            env("APPDATA").join("npm"),
            env("LOCALAPPDATA").join("Microsoft").join("WinGet").join("Links"),
        ]);
    }
    v
}

/// Rebuild the search path (startup, and after installing a tool).
pub fn refresh_path() {
    let base = login_shell_path().map(std::ffi::OsString::from).or_else(|| std::env::var_os("PATH")).unwrap_or_default();
    let mut dirs: Vec<PathBuf> = std::env::split_paths(&base).collect();
    for d in extra_dirs() {
        if d.is_dir() && !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    if let Ok(joined) = std::env::join_paths(dirs) {
        *SEARCH_PATH.write().unwrap() = Some(joined);
    }
}

/// Startup: build the search path and adopt it for the whole process.
pub fn adopt_login_path() {
    refresh_path();
    // SAFETY: called once at startup before any other thread reads the environment.
    unsafe { std::env::set_var("PATH", search_path()) };
}

/// Find `program` on Prism's search path. On Windows, npm-installed CLIs are `.cmd` shims that
/// CreateProcess can't start directly, so those run as `cmd /c <shim>`.
/// Returns (program, leading args).
pub fn resolve(program: &str) -> (String, Vec<String>) {
    if std::path::Path::new(program).is_absolute() {
        return (program.into(), vec![]);
    }
    for dir in std::env::split_paths(&search_path()) {
        #[cfg(windows)]
        {
            let exe = dir.join(format!("{program}.exe"));
            if exe.is_file() {
                return (exe.to_string_lossy().into_owned(), vec![]);
            }
            for ext in ["cmd", "bat"] {
                let shim = dir.join(format!("{program}.{ext}"));
                if shim.is_file() {
                    return ("cmd".into(), vec!["/c".into(), shim.to_string_lossy().into_owned()]);
                }
            }
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let cand = dir.join(program);
            if cand.metadata().map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false) {
                return (cand.to_string_lossy().into_owned(), vec![]);
            }
        }
    }
    (program.into(), vec![])
}

pub fn which(program: &str) -> Option<String> {
    let (p, lead) = resolve(program);
    (std::path::Path::new(&p).is_absolute() || !lead.is_empty()).then_some(p)
}

pub fn command(program: &str) -> Command {
    let (exe, lead) = resolve(program);
    #[allow(unused_mut)]
    let mut c = Command::new(exe);
    c.args(lead).env("PATH", search_path());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

// ── git ───────────────────────────────────────────────

pub fn git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let out = command("git").arg("-C").arg(cwd).args(args).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

pub fn current_branch(path: &str) -> Option<String> {
    git(path, &["rev-parse", "--abbrev-ref", "HEAD"]).ok()
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub is_main: bool,
}

/// Every worktree of `repo` in git's order (the main one first): (path, branch).
fn all_worktrees(repo: &str) -> Vec<(String, Option<String>)> {
    let Ok(out) = git(repo, &["worktree", "list", "--porcelain"]) else { return vec![] };
    let mut list = vec![];
    for block in out.split("\n\n") {
        let mut path = None;
        let mut branch = None;
        for line in block.lines() {
            if let Some(p) = line.strip_prefix("worktree ") {
                path = Some(p.to_string());
            } else if let Some(b) = line.strip_prefix("branch ") {
                branch = Some(b.trim_start_matches("refs/heads/").to_string());
            }
        }
        if let Some(path) = path {
            list.push((path, branch));
        }
    }
    list
}

pub fn worktrees(repo: &str) -> Vec<WorktreeInfo> {
    let mut list: Vec<WorktreeInfo> = vec![];
    for (path, branch) in all_worktrees(repo) {
        // agent worktrees live under .prism/ — not something to open a team on
        if path.contains("/.prism/worktrees/") {
            continue;
        }
        list.push(WorktreeInfo { is_main: list.is_empty(), path, branch });
    }
    list
}

/// The work copies members run in (`<project>/.prism/worktrees/…`), not the project's own folders.
pub fn work_copies(repo: &str) -> Vec<WorktreeInfo> {
    all_worktrees(repo)
        .into_iter()
        .filter(|(path, _)| path.contains("/.prism/worktrees/"))
        .map(|(path, branch)| WorktreeInfo { path, branch, is_main: false })
        .collect()
}

/// Whether `branch`'s commits are all in `into` (the work has landed there).
pub fn is_merged(repo: &str, branch: &str, into: &str) -> bool {
    git(repo, &["merge-base", "--is-ancestor", branch, into]).is_ok()
}

/// Creates `branch` from `base_cwd`'s HEAD, checked out at `path`.
pub fn add_worktree(base_cwd: &str, path: &Path, branch: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    git(base_cwd, &["worktree", "add", "-b", branch, &path.to_string_lossy(), "HEAD"]).map(|_| ())
}

/// Lets a new work copy use the project's installed packages instead of installing its own: a link
/// to `<repo>/node_modules`. Only when git ignores `node_modules` there, so the link never gets
/// committed. Best effort: without it the copy simply has no packages.
pub fn share_node_modules(repo: &str, work: &Path) {
    let src = Path::new(repo).join("node_modules");
    let dst = work.join("node_modules");
    if !src.is_dir() || dst.exists() || dst.is_symlink() {
        return;
    }
    if git(&work.to_string_lossy(), &["check-ignore", "-q", "node_modules"]).is_err() {
        return;
    }
    #[cfg(unix)]
    let _ = std::os::unix::fs::symlink(&src, &dst);
}

/// Disk space used by `path` in bytes (`du`); 0 when it is missing.
pub fn disk_bytes(path: &str) -> u64 {
    if !Path::new(path).exists() {
        return 0;
    }
    let Ok(out) = command("du").args(["-sk", path]).output() else { return 0 };
    String::from_utf8_lossy(&out.stdout).split_whitespace().next().and_then(|kb| kb.parse::<u64>().ok()).unwrap_or(0) * 1024
}

/// Makes `path` a git repo with at least one commit (agents branch their worktrees from HEAD).
/// Existing files go into that first commit so every agent sees them.
pub fn ensure_repo(path: &str) -> Result<(), String> {
    if !std::path::Path::new(path).join(".git").exists() {
        git(path, &["init", "-b", "main"])?;
    }
    if git(path, &["rev-parse", "--verify", "HEAD"]).is_ok() {
        return Ok(());
    }
    exclude_prism_dir(path);
    git(path, &["add", "-A"])?;
    let has_identity = git(path, &["config", "user.email"]).map(|e| !e.is_empty()).unwrap_or(false);
    let mut args = vec![];
    if !has_identity {
        args.extend(["-c", "user.name=Prism", "-c", "user.email=prism@localhost"]);
    }
    args.extend(["commit", "--allow-empty", "-m", "Prism: 첫 커밋"]);
    git(path, &args).map(|_| ())
}

/// Keeps `.prism/` out of `git status` without touching the tracked .gitignore.
pub fn exclude_prism_dir(repo: &str) {
    let Ok(common) = git(repo, &["rev-parse", "--path-format=absolute", "--git-common-dir"]) else { return };
    let file = PathBuf::from(common).join("info").join("exclude");
    let current = std::fs::read_to_string(&file).unwrap_or_default();
    if !current.lines().any(|l| l.trim() == ".prism/") {
        let _ = std::fs::create_dir_all(file.parent().unwrap());
        let _ = std::fs::write(&file, format!("{current}{}.prism/\n", if current.ends_with('\n') || current.is_empty() { "" } else { "\n" }));
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    pub code: String,
}

pub fn changes(cwd: &str) -> Vec<Change> {
    let Ok(out) = git(cwd, &["status", "--porcelain=v1", "-uall"]) else { return vec![] };
    out.lines()
        .filter(|l| l.len() > 3)
        .map(|l| Change { code: l[..2].trim().to_string(), path: l[3..].to_string() })
        .filter(|c| !c.path.starts_with(".prism/"))
        .collect()
}

pub fn diff(cwd: &str, path: &str) -> String {
    let tracked = git(cwd, &["diff", "HEAD", "--", path]).unwrap_or_default();
    if !tracked.is_empty() {
        return tracked;
    }
    // untracked: show as a full addition
    let out = command("git")
        .arg("-C")
        .arg(cwd)
        .args(["diff", "--no-index", "--", "/dev/null", path])
        .output();
    out.map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default()
}

// ── Claude trust ──────────────────────────────────────

fn claude_json(config_dir: Option<&str>) -> Option<PathBuf> {
    match config_dir.map(PathBuf::from).or_else(|| std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from)) {
        Some(dir) => Some(dir.join(".claude.json")),
        None => std::env::home_dir().map(|h| h.join(".claude.json")),
    }
}

/// Marks `dir` as trusted for Claude Code so agents don't stall on the folder-trust prompt.
/// Agent worktrees live under the project dir, so trusting the project root covers them.
/// Only touches the one project entry; everything else in the file is preserved.
pub fn ensure_claude_trust(dir: &str, config_dir: Option<&str>) {
    let Some(file) = claude_json(config_dir) else { return };
    let Ok(text) = std::fs::read_to_string(&file) else { return };
    let Ok(mut root) = serde_json::from_str::<serde_json::Value>(&text) else { return };
    let key = std::fs::canonicalize(dir).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| dir.to_string());
    let Some(projects) = root.get_mut("projects").and_then(|p| p.as_object_mut()) else { return };
    let entry = projects.entry(key).or_insert_with(|| serde_json::json!({}));
    if entry.get("hasTrustDialogAccepted").and_then(|v| v.as_bool()) == Some(true) {
        return;
    }
    if let Some(obj) = entry.as_object_mut() {
        obj.insert("hasTrustDialogAccepted".into(), true.into());
    }
    let Ok(out) = serde_json::to_string_pretty(&root) else { return };
    let tmp = file.with_extension("json.prism-tmp");
    if std::fs::write(&tmp, out).is_ok() {
        let _ = std::fs::rename(&tmp, &file);
    }
}
