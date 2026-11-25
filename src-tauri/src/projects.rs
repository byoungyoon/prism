//! Projects the user has added, and each project's team preset. Persisted as JSON.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::sys;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RoleConfig {
    pub agent: String,
    /// alias ("opus") or full id ("claude-opus-5-5")
    pub model: String,
    /// Claude Code --effort: "" (CLI default) | low | medium | high | xhigh | max
    #[serde(default)]
    pub effort: String,
    pub max: u32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TeamConfig {
    /// "save" | "bal" | "power" | "custom"
    pub preset: String,
    pub lead: RoleConfig,
    pub managers: RoleConfig,
    pub workers: RoleConfig,
    pub concurrent: u32,
    /// Claude Code --permission-mode: "default" | "acceptEdits" | "bypassPermissions"
    pub permission_mode: String,
    /// Give managers/workers their own git worktree + branch.
    pub isolate: bool,
    /// Work in a copy of the project on its own branch and touch the original folder only when the
    /// user presses "결과 반영하기". Off: work (and merge) right in the original folder.
    #[serde(default = "yes")]
    pub safe: bool,
}

fn yes() -> bool {
    true
}

impl Default for TeamConfig {
    fn default() -> Self {
        let [l, m, w] = presets("bal").unwrap();
        let r = |(model, effort): (&str, &str), max| RoleConfig { agent: "claude".into(), model: model.into(), effort: effort.into(), max };
        Self {
            preset: "bal".into(),
            lead: r(l, 1),
            managers: r(m, 2),
            workers: r(w, 4),
            concurrent: 6,
            permission_mode: "acceptEdits".into(),
            isolate: true,
            safe: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_git: bool,
    #[serde(default)]
    pub team: TeamConfig,
    #[serde(default)]
    pub last_opened: u64,
    /// what every AI on this team should know (server info, conventions…), user-edited
    #[serde(default)]
    pub knowledge: String,
    /// brought in from outside the workspace folder ("다른 위치의 폴더 가져오기")
    #[serde(default)]
    pub linked: bool,
}

pub struct Projects {
    list: Mutex<Vec<Project>>,
    file: Mutex<Option<PathBuf>>,
    /// Workspace folder: every subfolder is a project.
    root: Mutex<PathBuf>,
    settings: Option<PathBuf>,
    prefs: Mutex<Settings>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    root: Option<String>,
    /// subscriptions the user chose at first run: "claude" | "codex"
    #[serde(default)]
    pub providers: Vec<String>,
    /// first-run guide finished
    #[serde(default)]
    pub onboarded: bool,
    /// teams that were clocked in when the app last closed (project ids)
    #[serde(default)]
    pub last_teams: Vec<String>,
    /// clock the teams of last time back in when the app starts
    #[serde(default = "yes")]
    pub auto_resume: bool,
    /// the app closed with teams at work: "update" (restarted to update — those teams come back
    /// no matter `auto_resume`) | "quit". Cleared once the start-up clock-in is done.
    #[serde(default)]
    pub restart: Option<String>,
    /// ask before closing the window or quitting while members are at work
    #[serde(default = "yes")]
    pub confirm_quit: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self { root: None, providers: Vec::new(), onboarded: false, last_teams: Vec::new(), auto_resume: true, restart: None, confirm_quit: true }
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl Projects {
    pub fn load(app: &AppHandle) -> Self {
        let file = app.path().app_data_dir().ok().map(|d| d.join("projects.json"));
        let list = file
            .as_ref()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        let settings = app.path().app_data_dir().ok().map(|d| d.join("settings.json"));
        let saved: Settings = settings
            .as_ref()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        let prefs = saved.clone();
        let root = saved
            .root
            .map(PathBuf::from)
            .or_else(|| app.path().home_dir().ok().map(|h| h.join("Prism")))
            .unwrap_or_else(|| PathBuf::from("Prism"));
        let _ = std::fs::create_dir_all(&root);
        let mut list: Vec<Project> = list;
        // agents that are no longer supported fall back to Claude
        for p in &mut list {
            for r in [&mut p.team.lead, &mut p.team.managers, &mut p.team.workers] {
                if !crate::accounts::PROVIDERS.contains(&r.agent.as_str()) {
                    r.agent = "claude".into();
                    r.model = "sonnet".into();
                }
            }
        }
        Self { list: Mutex::new(list), file: Mutex::new(file), root: Mutex::new(root), settings, prefs: Mutex::new(prefs) }
    }

    /// Ask before closing or quitting while members are at work (the "정말 끌까요?" question).
    pub fn confirm_quit(&self) -> bool {
        self.prefs.lock().unwrap().confirm_quit
    }

    /// Remember which teams are clocked in (for "지난번 팀 다시 출근").
    pub fn set_last_teams(&self, ids: Vec<String>) {
        {
            let mut p = self.prefs.lock().unwrap();
            if p.last_teams == ids {
                return;
            }
            p.last_teams = ids;
        }
        self.save_prefs();
    }

    /// The app is going away (`why`: "update" | "quit") with these teams clocked in: remember them,
    /// and why, in one write.
    pub fn set_closing(&self, live: Vec<String>, why: &str) {
        {
            let mut p = self.prefs.lock().unwrap();
            p.restart = (!live.is_empty()).then(|| why.to_string());
            p.last_teams = live;
        }
        self.save_prefs();
    }

    fn save_prefs(&self) {
        if let Some(f) = &self.settings {
            let mut p = self.prefs.lock().unwrap().clone();
            p.root = Some(self.root.lock().unwrap().to_string_lossy().into_owned());
            let _ = std::fs::create_dir_all(f.parent().unwrap());
            let _ = std::fs::write(f, serde_json::to_string_pretty(&p).unwrap_or_default());
        }
    }

    /// Team for a new project, shaped by the subscriptions the user has.
    /// Remember a subscription as one the user uses (signed in, or picked).
    pub fn add_provider(&self, provider: &str) {
        let added = {
            let mut p = self.prefs.lock().unwrap();
            let new = !p.providers.iter().any(|x| x == provider);
            if new {
                p.providers.push(provider.into());
            }
            new
        };
        if added {
            self.save_prefs();
        }
    }

    /// New teams run on Claude when it's among the user's subscriptions; otherwise on the one
    /// they have (Gemini-only or ChatGPT-only).
    fn default_team(&self) -> TeamConfig {
        let providers = self.prefs.lock().unwrap().providers.clone();
        let mut t = TeamConfig::default();
        if providers.iter().any(|p| p == "claude") {
            return t;
        }
        if providers.iter().any(|p| p == "antigravity") && !providers.iter().any(|p| p == "codex") {
            // Google-only: the whole team runs on Antigravity (its default model)
            for r in [&mut t.lead, &mut t.managers, &mut t.workers] {
                r.agent = "antigravity".into();
                r.model = String::new();
                r.effort = String::new();
            }
            t.preset = "custom".into();
        } else if providers.iter().any(|p| p == "codex") {
            // ChatGPT-only: the whole team runs on Codex
            let model = crate::launch::models_for("codex", None).into_iter().next().map(|m| m.id).unwrap_or_default();
            for r in [&mut t.lead, &mut t.managers, &mut t.workers] {
                r.agent = "codex".into();
                r.model = model.clone();
                r.effort = "medium".into();
            }
            t.lead.effort = "high".into();
            t.preset = "custom".into();
        }
        t
    }

    /// Projects = the workspace root's subfolders; keeps each folder's saved team config.
    fn sync(&self) -> Vec<Project> {
        let root = self.root.lock().unwrap().clone();
        let mut list = self.list.lock().unwrap();
        let mut dirs: Vec<PathBuf> = std::fs::read_dir(&root)
            .map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()).collect())
            .unwrap_or_default();
        dirs.retain(|d| d.file_name().map(|n| !n.to_string_lossy().starts_with('.')).unwrap_or(false));
        let mut changed = false;
        let mut out = vec![];
        for dir in dirs {
            let path = dir.to_string_lossy().into_owned();
            let is_git = dir.join(".git").exists();
            let p = match list.iter_mut().find(|p| p.path == path) {
                Some(p) => {
                    if p.is_git != is_git {
                        p.is_git = is_git;
                        changed = true;
                    }
                    p.clone()
                }
                None => {
                    let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    let p = Project { id: uuid::Uuid::new_v4().to_string()[..8].to_string(), name, path, is_git, team: self.default_team(), last_opened: 0, knowledge: String::new(), linked: false };
                    list.push(p.clone());
                    changed = true;
                    p
                }
            };
            out.push(p);
        }
        // folders brought in from elsewhere, while they still exist
        for p in list.iter().filter(|p| p.linked && std::path::Path::new(&p.path).is_dir()) {
            if !out.iter().any(|o| o.path == p.path) {
                out.push(p.clone());
            }
        }
        if changed {
            self.save(&list);
        }
        out.sort_by(|a, b| b.last_opened.cmp(&a.last_opened).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        out
    }

    pub fn mark_git(&self, id: &str) {
        let _ = self.update(id, |p| p.is_git = true);
    }

    fn save(&self, list: &[Project]) {
        if let Some(f) = self.file.lock().unwrap().as_ref() {
            let _ = std::fs::create_dir_all(f.parent().unwrap());
            if let Ok(text) = serde_json::to_string_pretty(list) {
                let tmp = f.with_extension("json.tmp");
                if std::fs::write(&tmp, text).is_ok() {
                    let _ = std::fs::rename(tmp, f);
                }
            }
        }
    }

    pub fn get(&self, id: &str) -> Option<Project> {
        self.list.lock().unwrap().iter().find(|p| p.id == id).cloned()
    }

    fn update(&self, id: &str, f: impl FnOnce(&mut Project)) -> Result<Project, String> {
        let mut list = self.list.lock().unwrap();
        let p = list.iter_mut().find(|p| p.id == id).ok_or("no such project")?;
        f(p);
        let out = p.clone();
        self.save(&list);
        Ok(out)
    }
}

/// (model, effort) for [lead, managers, workers]
pub fn presets(name: &str) -> Option<[(&'static str, &'static str); 3]> {
    match name {
        "save" => Some([("sonnet", "medium"), ("haiku", "low"), ("haiku", "low")]),
        "bal" => Some([("opus", "high"), ("sonnet", "medium"), ("haiku", "medium")]),
        "power" => Some([("opus", "xhigh"), ("opus", "high"), ("sonnet", "high")]),
        _ => None,
    }
}

#[tauri::command]
pub fn projects_list(projects: State<'_, Projects>) -> Vec<Project> {
    projects.sync()
}

#[tauri::command]
pub fn workspace_root(projects: State<'_, Projects>) -> String {
    projects.root.lock().unwrap().to_string_lossy().into_owned()
}

#[tauri::command]
pub fn workspace_set_root(projects: State<'_, Projects>, path: String) -> Result<Vec<Project>, String> {
    let dir = PathBuf::from(&path);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    *projects.root.lock().unwrap() = dir;
    let _ = path;
    projects.save_prefs();
    Ok(projects.sync())
}

/// New project = new folder in the workspace with a git repo and a first commit.
#[tauri::command]
pub fn project_create(projects: State<'_, Projects>, name: String) -> Result<Project, String> {
    let name = name.trim();
    if name.is_empty() || name.starts_with('.') || name.contains(['/', '\\', ':']) {
        return Err("폴더 이름으로 쓸 수 없는 이름이에요".into());
    }
    let dir = projects.root.lock().unwrap().join(name);
    if dir.exists() {
        return Err("같은 이름의 프로젝트가 이미 있어요".into());
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    sys::ensure_repo(&dir.to_string_lossy())?;
    let path = dir.to_string_lossy().into_owned();
    projects.sync();
    let p = projects.list.lock().unwrap().iter().find(|p| p.path == path).cloned().ok_or("생성 실패")?;
    projects.update(&p.id, |p| p.last_opened = now_ms())
}

/// "다른 위치의 폴더 가져오기": make a project of a folder outside the workspace. Nothing in the
/// folder changes now (a folder without git gets one when its team first clocks in).
#[tauri::command]
pub fn project_import(projects: State<'_, Projects>, path: String) -> Result<Project, String> {
    let dir = PathBuf::from(path.trim());
    if !dir.is_dir() {
        return Err("폴더를 찾을 수 없어요".into());
    }
    let dir = std::fs::canonicalize(&dir).unwrap_or(dir);
    let path = dir.to_string_lossy().into_owned();
    if let Some(home) = std::env::home_dir() {
        if dir == home || dir.parent().is_none() {
            return Err("홈 폴더나 디스크 전체는 프로젝트로 가져올 수 없어요. 프로젝트 폴더를 골라주세요.".into());
        }
    }
    let existing = projects.sync().into_iter().find(|p| p.path == path);
    if let Some(p) = existing {
        return projects.update(&p.id, |p| p.last_opened = now_ms());
    }
    let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "프로젝트".into());
    let p = Project {
        id: uuid::Uuid::new_v4().to_string()[..8].to_string(),
        name,
        is_git: dir.join(".git").exists(),
        path,
        team: projects.default_team(),
        last_opened: now_ms(),
        knowledge: String::new(),
        linked: true,
    };
    {
        let mut list = projects.list.lock().unwrap();
        list.push(p.clone());
        projects.save(&list);
    }
    Ok(p)
}

/// Take a brought-in folder off the list. The folder itself is left as it is.
#[tauri::command]
pub fn project_forget(projects: State<'_, Projects>, id: String) -> Result<(), String> {
    let mut list = projects.list.lock().unwrap();
    let p = list.iter().find(|p| p.id == id).ok_or("그런 프로젝트가 없어요")?;
    if !p.linked {
        return Err("작업 폴더 안의 프로젝트는 목록에서 뺄 수 없어요".into());
    }
    list.retain(|p| p.id != id);
    projects.save(&list);
    Ok(())
}

#[tauri::command]
pub fn prefs_get(projects: State<'_, Projects>) -> Settings {
    projects.prefs.lock().unwrap().clone()
}

#[tauri::command]
pub fn prefs_set(projects: State<'_, Projects>, providers: Vec<String>, onboarded: bool) -> Settings {
    {
        let mut p = projects.prefs.lock().unwrap();
        p.providers = providers.into_iter().filter(|x| crate::accounts::PROVIDERS.contains(&x.as_str())).collect();
        p.onboarded = onboarded;
    }
    projects.save_prefs();
    projects.prefs.lock().unwrap().clone()
}

#[tauri::command]
pub fn prefs_set_auto_resume(projects: State<'_, Projects>, on: bool) -> Settings {
    projects.prefs.lock().unwrap().auto_resume = on;
    projects.save_prefs();
    projects.prefs.lock().unwrap().clone()
}

#[tauri::command]
pub fn prefs_set_confirm_quit(projects: State<'_, Projects>, on: bool) -> Settings {
    projects.prefs.lock().unwrap().confirm_quit = on;
    projects.save_prefs();
    projects.prefs.lock().unwrap().clone()
}

/// The start-up clock-in after a restart is done: forget why the app last closed.
#[tauri::command]
pub fn prefs_clear_restart(projects: State<'_, Projects>) -> Settings {
    projects.prefs.lock().unwrap().restart = None;
    projects.save_prefs();
    projects.prefs.lock().unwrap().clone()
}

#[tauri::command]
pub fn project_touch(projects: State<'_, Projects>, id: String) -> Result<Project, String> {
    projects.update(&id, |p| p.last_opened = now_ms())
}

#[tauri::command]
pub fn project_set_team(projects: State<'_, Projects>, id: String, team: TeamConfig) -> Result<Project, String> {
    projects.update(&id, |p| p.team = team)
}

#[tauri::command]
pub fn project_set_knowledge(projects: State<'_, Projects>, id: String, text: String) -> Result<Project, String> {
    projects.update(&id, |p| p.knowledge = text)
}

// ── shared knowledge: what every AI on every team should know ──

fn knowledge_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("knowledge.md"))
}

pub fn shared_knowledge(app: &AppHandle) -> String {
    knowledge_file(app).and_then(|f| std::fs::read_to_string(f).ok()).unwrap_or_default()
}

#[tauri::command]
pub fn knowledge_get(app: AppHandle) -> String {
    shared_knowledge(&app)
}

#[tauri::command]
pub fn knowledge_set(app: AppHandle, text: String) -> Result<(), String> {
    let f = knowledge_file(&app).ok_or("저장할 곳을 찾지 못했어요")?;
    let _ = std::fs::create_dir_all(f.parent().unwrap());
    std::fs::write(f, text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn project_set_preset(projects: State<'_, Projects>, id: String, preset: String) -> Result<Project, String> {
    let models = presets(&preset).ok_or("unknown preset")?;
    projects.update(&id, |p| {
        p.team.preset = preset;
        // the preset's models are Claude's: a role on Gemini or Codex keeps its program's default
        for (role, (model, effort)) in [&mut p.team.lead, &mut p.team.managers, &mut p.team.workers].into_iter().zip(models) {
            if role.agent == "claude" {
                role.model = model.into();
                role.effort = effort.into();
            } else if crate::launch::is_claude_model(&role.model) {
                role.model = String::new();
            }
        }
    })
}

#[tauri::command]
pub fn worktrees_list(path: String) -> Vec<sys::WorktreeInfo> {
    sys::worktrees(&path)
}

#[tauri::command]
pub fn git_changes(cwd: String) -> Vec<sys::Change> {
    sys::changes(&cwd)
}

#[tauri::command]
pub fn git_diff(cwd: String, path: String) -> String {
    sys::diff(&cwd, &path)
}
