//! The broker: one running team per project — agents, task cards, chat, event log.
//!
//! Agents are Claude Code processes in PTYs. They talk back through two local channels
//! served by `server.rs`: an MCP server (delegate / report / escalate …) and Claude Code
//! hooks (status changes, final messages). Every change is pushed to the UI as a snapshot.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::projects::{now_ms, Project, Projects};
use crate::pty::Pty;
use crate::usage::{Usage, UsageWindow};
use crate::{prompts, sys};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    pub name: String,
    /// "lead" | "mgr" | "worker"
    pub role: String,
    /// "claude" | "codex"
    pub kind: String,
    pub model: String,
    pub effort: String,
    /// "work" | "wait" | "block" | "done" | "off"
    pub status: String,
    pub task_id: Option<String>,
    pub parent_id: Option<String>,
    pub pty_id: Option<u32>,
    pub cwd: String,
    pub branch: Option<String>,
    pub session_id: String,
    pub cost_usd: f64,
    pub started_at: u64,
    pub status_since: u64,
    pub last_note: Option<String>,
    /// runs without a terminal (structured events); `pty_id` is None then
    pub structured: bool,
    /// recent tool activity, newest last ("✏️ index.html", "$ npm test" …)
    pub activity: Vec<Activity>,
    /// what it's thinking right now (the tail of its streamed reasoning), while a turn runs
    #[serde(default)]
    pub thought: Option<String>,
    /// when it last showed any sign of life (thought, message, tool use) — tells "slow" from "stuck"
    #[serde(default)]
    pub last_active: u64,
    #[serde(skip)]
    ready: bool,
    #[serde(skip)]
    pending: Vec<String>,
    #[serde(skip)]
    children: u32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub at: u64,
    pub text: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub goal: String,
    pub files: Vec<String>,
    pub done_when: Vec<String>,
    pub requested_by: String,
    pub assignee: Option<String>,
    /// role the card is for: "mgr" | "worker"
    pub role: String,
    pub model: Option<String>,
    /// "queued" | "running" | "review" | "done" | "failed"
    pub stage: String,
    pub summary: Option<String>,
    pub branch: Option<String>,
    /// commit the task's branch was cut from — diff base for its results
    pub base: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    /// a follow-up: the card this one continues (same member, same context)
    #[serde(default)]
    pub follow_of: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Escalation {
    pub agent_id: String,
    pub task_id: Option<String>,
    /// agent ids from the asker up to the lead
    pub path: Vec<String>,
    pub options: Vec<String>,
    pub answer: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatMsg {
    pub id: u64,
    /// "me" | "lead" | "escalation" | "system"
    pub kind: String,
    pub text: String,
    pub task_ids: Vec<String>,
    pub at: u64,
    pub escalation: Option<Escalation>,
    pub permission: Option<Permission>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Permission {
    pub agent_id: String,
    pub tool: String,
    /// what it wants to do: a shell command, a file path…
    pub detail: String,
    /// "allow" | "always" | "deny" | "timeout"
    pub answer: Option<String>,
    /// the boss deciding it (팀장 for a 작업자, 총괄 for a 팀장); None = the user decides
    #[serde(default)]
    pub decider: Option<String>,
    /// who answered, for the record ("사용자", "팀장 A"…)
    #[serde(default)]
    pub decided_by: Option<String>,
}

/// A branch-name-safe form of the project name ("teamsystem-api", "쇼핑몰"); `fallback` if nothing's left.
fn branch_slug(name: &str, fallback: &str) -> String {
    let mut out = String::new();
    for c in name.trim().chars() {
        let bad = c.is_whitespace() || c.is_control() || "~^:?*[\\.@{}/".contains(c);
        if bad {
            if !out.ends_with('-') {
                out.push('-');
            }
        } else {
            out.push(c);
        }
    }
    let out = out.trim_matches('-').to_lowercase();
    if out.is_empty() { fallback.to_string() } else { out }
}

/// Never left to an AI boss: these always go to the user.
fn needs_user(tool: &str, detail: &str, project: &str) -> bool {
    const RISKY: &[&str] = &[
        "sudo ", "rm -rf /", "rm -rf ~", "rm -rf $home", "git push", "--force", "| sh", "|sh", "| bash", "|bash", "curl ", "wget ",
        "chmod -r 777", "chown ", "ssh ", "scp ", "rsync ", "npm publish", "pnpm publish", "yarn publish", "cargo publish", "docker push",
        "deploy", "drop table", "drop database", "truncate table", "mkfs", "dd if=", "launchctl", "defaults write", "security ", "keychain",
        ".env", "id_rsa", "credential", "password", "secret", "token",
    ];
    let d = detail.to_lowercase();
    if RISKY.iter().any(|p| d.contains(p)) {
        return true;
    }
    // writing or editing files outside the project
    matches!(tool, "Write" | "Edit" | "MultiEdit" | "NotebookEdit") && detail.starts_with('/') && !detail.starts_with(project)
}

/// Outcome of a PermissionRequest hook: decide now, or wait for the user.
pub enum PermWait {
    Now(&'static str),
    Wait(u64, tokio::sync::oneshot::Receiver<&'static str>),
}

/// "always allow" key: tool + the first two words of a shell command.
fn perm_key(tool: &str, detail: &str) -> String {
    if tool == "Bash" {
        format!("Bash:{}", detail.split_whitespace().take(2).collect::<Vec<_>>().join(" "))
    } else {
        tool.to_string()
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogEvent {
    pub at: u64,
    pub text: String,
    pub tone: Option<String>,
}

struct Team {
    project: Project,
    /// account home dir per agent kind ("claude" → CLAUDE_CONFIG_DIR, "codex" → CODEX_HOME …); None = inherited
    homes: HashMap<String, Option<String>>,
    run: String,
    cwd: String,
    branch: Option<String>,
    /// safe mode: the original folder's branch results go back to ("결과 반영하기"); None = the team
    /// works right in the original folder
    home: Option<String>,
    agents: Vec<Agent>,
    tasks: Vec<Task>,
    chat: Vec<ChatMsg>,
    events: Vec<LogEvent>,
    next_task: u32,
    next_msg: u64,
    next_mgr: u8,
    next_lone: u32,
    always_allow: std::collections::HashSet<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TeamSnapshot {
    pub project_id: String,
    pub project_name: String,
    pub cwd: String,
    pub branch: Option<String>,
    /// safe mode: the original folder's branch ("main"…) results are reflected into
    pub home: Option<String>,
    pub team: crate::projects::TeamConfig,
    pub agents: Vec<Agent>,
    pub tasks: Vec<Task>,
    pub chat: Vec<ChatMsg>,
    pub events: Vec<LogEvent>,
    pub cost_usd: f64,
}

/// What survives an app restart (agents come back stopped, with their session ids).
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SavedTeam {
    run: String,
    cwd: String,
    branch: Option<String>,
    #[serde(default)]
    home: Option<String>,
    agents: Vec<Agent>,
    tasks: Vec<Task>,
    chat: Vec<ChatMsg>,
    events: Vec<LogEvent>,
    next_task: u32,
    next_msg: u64,
    next_mgr: u8,
    next_lone: u32,
    always_allow: Vec<String>,
    transcripts: HashMap<String, Vec<crate::structured::Entry>>,
}

pub struct TeamManager {
    app: AppHandle,
    pty: Pty,
    teams: Mutex<HashMap<String, Team>>,
    pub port: u16,
    pub token: String,
    data_dir: PathBuf,
    perm_waiters: Mutex<HashMap<u64, tokio::sync::oneshot::Sender<&'static str>>>,
    /// "project/agent" whose next turn was started by a permission request: its bare reply ("." etc.) stays out of the chat
    permission_turns: Mutex<std::collections::HashSet<String>>,
    /// structured agents by "project/agent"
    drivers: Mutex<HashMap<String, Arc<dyn crate::structured::Driver>>>,
    /// conversation per structured agent, by "project/agent"
    transcripts: Mutex<HashMap<String, Vec<crate::structured::Entry>>>,
    /// subscription usage per provider, as last reported by a running agent
    usage: Mutex<HashMap<String, Usage>>,
    /// teams changed since the last save
    dirty: Mutex<std::collections::HashSet<String>>,
    /// latest snapshot per team waiting to go to the UI (see `emit`)
    outbox: Mutex<HashMap<String, TeamSnapshot>>,
    /// "project/agent" whose next turn was started by a worker's report → that card's id. Its reply
    /// goes to the chat as a 'report' entry, not a plain 'lead' line (see `say_reply`)
    report_turns: Mutex<HashMap<String, String>>,
}

/// The 총괄's reply: a 'report' entry when the turn was started by a worker's report (tagged with
/// that card), otherwise a plain 'lead' line.
fn say_reply(team: &mut Team, report: Option<String>, text: String) {
    let kind = if report.is_some() { "report" } else { "lead" };
    let id = team.say(kind, text, None);
    if let (Some(tid), Some(m)) = (report, team.chat.iter_mut().find(|m| m.id == id)) {
        if !m.task_ids.contains(&tid) {
            m.task_ids.insert(0, tid);
        }
    }
}

/// How long snapshots of one team are gathered before one goes to the UI. A busy team changes many
/// times a second (every streamed message, every tool call); the UI only needs the latest.
const EMIT_EVERY: std::time::Duration = std::time::Duration::from_millis(150);
/// The UI gets the recent conversation and log; the full history stays on disk.
const SNAPSHOT_CHAT: usize = 200;
const SNAPSHOT_EVENTS: usize = 150;

fn window_label(id: &str) -> String {
    let base = if id.starts_with("five_hour") { "5시간" } else if id.starts_with("seven_day") { "주간" } else { id };
    let model = ["opus", "sonnet", "fable", "haiku"].into_iter().find(|m| id.contains(m));
    match model {
        Some(m) => format!("{base} · {}", m[..1].to_uppercase() + &m[1..]),
        None => base.to_string(),
    }
}

/// Claude Code's status-line payload carries `rate_limits` for subscribers.
fn parse_rate_limits(v: &Value) -> Vec<UsageWindow> {
    let Some(obj) = v.as_object() else { return vec![] };
    let mut out: Vec<UsageWindow> = obj
        .iter()
        .filter_map(|(id, w)| {
            let pct = ["used_percentage", "used_percent", "percent", "utilization"]
                .iter()
                .find_map(|k| w.get(*k).and_then(Value::as_f64))?;
            let pct = if w.get("utilization").is_some() && pct <= 1.0 { pct * 100.0 } else { pct };
            Some(UsageWindow { id: id.clone(), label: window_label(id), used_percent: pct.clamp(0.0, 100.0), resets_at: w.get("resets_at").cloned() })
        })
        .collect();
    out.sort_by_key(|w| (!w.id.starts_with("five_hour"), w.id.len()));
    out
}
fn task_ids_in(text: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    let b = text.as_bytes();
    let mut i = 0;
    while i + 2 < b.len() {
        if b[i] == b'T' && b[i + 1] == b'-' && b[i + 2].is_ascii_digit() && (i == 0 || !b[i - 1].is_ascii_alphanumeric()) {
            let mut j = i + 2;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            let id = text[i..j].to_string();
            if !out.contains(&id) {
                out.push(id);
            }
            i = j;
        } else {
            i += 1;
        }
    }
    out
}

fn short(s: &str, n: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= n { s.to_string() } else { format!("{}…", s.chars().take(n).collect::<String>()) }
}

impl Team {
    fn agent(&self, id: &str) -> Option<&Agent> {
        self.agents.iter().find(|a| a.id == id)
    }
    fn agent_mut(&mut self, id: &str) -> Option<&mut Agent> {
        self.agents.iter_mut().find(|a| a.id == id)
    }
    fn task_mut(&mut self, id: &str) -> Option<&mut Task> {
        self.tasks.iter_mut().find(|t| t.id == id)
    }
    fn log(&mut self, text: impl Into<String>, tone: Option<&str>) {
        self.events.insert(0, LogEvent { at: now_ms(), text: text.into(), tone: tone.map(Into::into) });
        self.events.truncate(500);
    }
    fn say(&mut self, kind: &str, text: String, escalation: Option<Escalation>) -> u64 {
        self.next_msg += 1;
        let task_ids = task_ids_in(&text);
        self.chat.push(ChatMsg { id: self.next_msg, kind: kind.into(), text, task_ids, at: now_ms(), escalation, permission: None });
        self.next_msg
    }
    fn set_status(&mut self, id: &str, status: &str) {
        if let Some(a) = self.agent_mut(id) {
            if a.status != status && a.status != "off" {
                a.status = status.into();
                a.status_since = now_ms();
            }
        }
    }
    fn name_of(&self, id: &str) -> String {
        self.agent(id).map(|a| a.name.clone()).unwrap_or_else(|| id.to_string())
    }
    fn active(&self, role: &str) -> usize {
        self.agents.iter().filter(|a| a.role == role && a.status != "done" && a.status != "off").count()
    }
    fn cost(&self) -> f64 {
        self.agents.iter().map(|a| a.cost_usd).sum()
    }
    fn snapshot(&self) -> TeamSnapshot {
        TeamSnapshot {
            project_id: self.project.id.clone(),
            project_name: self.project.name.clone(),
            cwd: self.cwd.clone(),
            branch: self.branch.clone(),
            home: self.home.clone(),
            team: self.project.team.clone(),
            agents: self.agents.clone(),
            tasks: self.tasks.clone(),
            // recent messages, plus any older question still waiting for an answer
            chat: {
                let cut = self.chat.len().saturating_sub(SNAPSHOT_CHAT);
                self.chat
                    .iter()
                    .enumerate()
                    .filter(|(i, m)| *i >= cut || m.escalation.as_ref().is_some_and(|e| e.answer.is_none()) || m.permission.as_ref().is_some_and(|p| p.answer.is_none()))
                    .map(|(_, m)| m.clone())
                    .collect()
            },
            events: self.events.iter().take(SNAPSHOT_EVENTS).cloned().collect(),
            cost_usd: self.cost(),
        }
    }
}

impl TeamManager {
    pub fn new(app: AppHandle, pty: Pty, port: u16, token: String) -> Self {
        let data_dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("prism"));
        Self { app, pty, teams: Mutex::default(), port, token, data_dir, perm_waiters: Mutex::default(), permission_turns: Mutex::default(), drivers: Mutex::default(), transcripts: Mutex::default(), usage: Mutex::default(), dirty: Mutex::default(), outbox: Mutex::default(), report_turns: Mutex::default() }
    }

    /// Queue the team's latest state for the UI. Bursts are coalesced: the first change starts a
    /// short timer, later ones just replace the queued snapshot, and only the newest is sent.
    fn emit(&self, team: &Team) {
        let pid = team.project.id.clone();
        self.dirty.lock().unwrap().insert(pid.clone());
        let first = self.outbox.lock().unwrap().insert(pid.clone(), team.snapshot()).is_none();
        if !first {
            return;
        }
        let app = self.app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(EMIT_EVERY);
            let Some(m) = app.try_state::<Arc<TeamManager>>() else { return };
            let snap = m.outbox.lock().unwrap().remove(&pid);
            if let Some(snap) = snap {
                let _ = app.emit("team://snapshot", snap);
            }
        });
    }

    // ── persistence ───────────────────────────────────

    fn saved_path(&self, pid: &str) -> PathBuf {
        self.data_dir.join("teams").join(format!("{pid}.json"))
    }

    /// Write teams that changed (called every couple of seconds and on exit).
    pub fn flush(&self) {
        let ids: Vec<String> = self.dirty.lock().unwrap().drain().collect();
        for pid in ids {
            let saved = {
                let teams = self.teams.lock().unwrap();
                let Some(t) = teams.get(&pid) else { continue };
                let prefix = format!("{pid}/");
                let transcripts = self
                    .transcripts
                    .lock()
                    .unwrap()
                    .iter()
                    .filter_map(|(k, v)| k.strip_prefix(&prefix).map(|a| (a.to_string(), v.clone())))
                    .collect();
                SavedTeam {
                    run: t.run.clone(),
                    cwd: t.cwd.clone(),
                    branch: t.branch.clone(),
                    home: t.home.clone(),
                    agents: t.agents.clone(),
                    tasks: t.tasks.clone(),
                    chat: t.chat.clone(),
                    events: t.events.clone(),
                    next_task: t.next_task,
                    next_msg: t.next_msg,
                    next_mgr: t.next_mgr,
                    next_lone: t.next_lone,
                    always_allow: t.always_allow.iter().cloned().collect(),
                    transcripts,
                }
            };
            let path = self.saved_path(&pid);
            let _ = std::fs::create_dir_all(path.parent().unwrap());
            if let Ok(text) = serde_json::to_string(&saved) {
                let tmp = path.with_extension("json.tmp");
                if std::fs::write(&tmp, text).is_ok() {
                    let _ = std::fs::rename(tmp, &path);
                }
            }
        }
    }

    /// Bring back saved teams (stopped) so their history shows and they can pick up again.
    pub fn load_saved(&self, projects: &Projects) {
        let Ok(dir) = std::fs::read_dir(self.data_dir.join("teams")) else { return };
        for f in dir.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")) {
            let Some(pid) = f.file_stem().map(|s| s.to_string_lossy().into_owned()) else { continue };
            let Some(project) = projects.get(&pid) else { continue };
            let Some(saved) = std::fs::read_to_string(&f).ok().and_then(|t| serde_json::from_str::<SavedTeam>(&t).ok()) else { continue };
            let mut agents = saved.agents;
            for a in &mut agents {
                a.pty_id = None;
                if a.status != "done" {
                    a.status = "off".into();
                }
            }
            // worker numbering continues where it left off
            let counts: Vec<(String, u32)> = agents
                .iter()
                .filter(|m| m.role == "mgr")
                .map(|m| (m.id.clone(), agents.iter().filter(|w| w.parent_id.as_deref() == Some(&m.id)).count() as u32))
                .collect();
            for (id, n) in counts {
                if let Some(m) = agents.iter_mut().find(|a| a.id == id) {
                    m.children = n;
                }
            }
            {
                let mut t = self.transcripts.lock().unwrap();
                for (aid, list) in saved.transcripts {
                    t.insert(format!("{pid}/{aid}"), list);
                }
            }
            self.teams.lock().unwrap().insert(
                pid.clone(),
                Team {
                    project,
                    homes: HashMap::new(),
                    run: saved.run,
                    cwd: saved.cwd,
                    branch: saved.branch,
                    home: saved.home,
                    agents,
                    tasks: saved.tasks,
                    chat: saved.chat,
                    events: saved.events,
                    next_task: saved.next_task,
                    next_msg: saved.next_msg,
                    next_mgr: saved.next_mgr,
                    next_lone: saved.next_lone,
                    always_allow: saved.always_allow.into_iter().collect(),
                },
            );
        }
    }

    /// A stopped team clocks back in: the lead and anyone mid-task continue their sessions.
    fn resume_team(&self, team: &mut Team) {
        let ids: Vec<(String, String)> = team
            .agents
            .iter()
            .filter(|a| a.status == "off")
            .filter(|a| a.role == "lead" || a.task_id.as_deref().and_then(|t| team.tasks.iter().find(|x| x.id == t)).is_some_and(|t| t.stage == "running"))
            .map(|a| (a.id.clone(), a.session_id.clone()))
            .collect();
        for (aid, sid) in ids {
            let resume = (!sid.is_empty()).then_some(sid);
            if self.launch_agent(team, &aid, resume).is_err() {
                // the old session can't be found: start this member fresh
                let _ = self.launch_agent(team, &aid, None);
            }
        }
        team.log("팀이 다시 출근했다. 하던 일을 이어서 한다.", None);
    }

    pub fn pause_agent(&self, pid: &str, aid: &str) -> Result<(), String> {
        {
            let mut teams = self.teams.lock().unwrap();
            let team = teams.get_mut(pid).ok_or("no team")?;
            let name = team.name_of(aid);
            team.set_status(aid, "off");
            team.log(format!("{name}을(를) 잠시 멈췄다."), None);
            self.emit(team);
        }
        self.kill_driver(pid, aid);
        Ok(())
    }

    pub fn resume_agent(&self, pid: &str, aid: &str) -> Result<(), String> {
        let mut teams = self.teams.lock().unwrap();
        let team = teams.get_mut(pid).ok_or("no team")?;
        let a = team.agent(aid).cloned().ok_or("no agent")?;
        if self.drivers.lock().unwrap().contains_key(&format!("{pid}/{aid}")) {
            return Ok(());
        }
        let resume = (!a.session_id.is_empty()).then_some(a.session_id.clone());
        if self.launch_agent(team, aid, resume).is_err() {
            self.launch_agent(team, aid, None)?;
        }
        team.log(format!("{}이(가) 다시 일을 시작했다.", a.name), None);
        self.emit(team);
        Ok(())
    }

    fn notify(&self, title: &str, body: &str) {
        let _ = self.app.notification().builder().title(title).body(body).show();
    }

    // ── lifecycle ─────────────────────────────────────

    pub fn snapshot(&self, pid: &str) -> Option<TeamSnapshot> {
        self.teams.lock().unwrap().get(pid).map(|t| t.snapshot())
    }

    pub fn start(&self, project: Project, cwd: String, homes: HashMap<String, Option<String>>) -> Result<TeamSnapshot, String> {
        let mut teams = self.teams.lock().unwrap();
        if let Some(t) = teams.get_mut(&project.id) {
            if t.agents.iter().any(|a| a.role == "lead" && a.status != "off") {
                return Ok(t.snapshot());
            }
            // a saved (stopped) team: same history, sessions continue
            if t.agents.iter().any(|a| a.role == "lead") {
                t.project = project;
                Self::place(t)?;
                for (kind, home) in &homes {
                    crate::launch::trust(kind, &t.project.path, home.as_deref());
                    crate::launch::trust(kind, &t.cwd, home.as_deref());
                }
                t.homes = homes;
                self.resume_team(t);
                let snap = t.snapshot();
                self.emit(t);
                return Ok(snap);
            }
        }
        if project.is_git {
            sys::exclude_prism_dir(&project.path);
        }
        let mut team = Team {
            branch: if project.is_git { sys::current_branch(&cwd) } else { None },
            project,
            homes: HashMap::new(),
            run: uuid::Uuid::new_v4().to_string()[..4].to_string(),
            cwd,
            home: None,
            agents: vec![],
            tasks: vec![],
            chat: vec![],
            events: vec![],
            next_task: 0,
            next_msg: 0,
            next_mgr: 0,
            next_lone: 0,
            always_allow: Default::default(),
        };
        Self::place(&mut team)?;
        for (kind, home) in &homes {
            crate::launch::trust(kind, &team.project.path, home.as_deref());
            crate::launch::trust(kind, &team.cwd, home.as_deref());
        }
        team.homes = homes;
        self.spawn_agent(&mut team, "lead", None, None)?;
        team.log("팀이 출근했다. 총괄이 지시를 기다린다.", None);
        let snap = team.snapshot();
        let _ = self.app.emit("team://snapshot", &snap);
        teams.insert(team.project.id.clone(), team);
        Ok(snap)
    }

    /// Where the team works. Safe mode: its own copy of the project (`.prism/worktrees/`) on a team
    /// branch with a readable name ("prism/쇼핑몰"), cut from the original folder's branch; the original
    /// folder is never touched — results leave as a PR when the user asks the 총괄. Otherwise: the
    /// original folder itself.
    fn place(team: &mut Team) -> Result<(), String> {
        let root = team.project.path.clone();
        let safe = team.project.team.safe && team.project.is_git;
        let was = team.cwd.clone();
        if safe {
            let path = PathBuf::from(&root).join(".prism").join("worktrees").join(format!("team-{}", team.run));
            if team.home.is_none() {
                team.home = Some(sys::current_branch(&root).unwrap_or_else(|| "main".into()));
            }
            let branch = if path.exists() {
                // whatever the team is on now (the user may have switched it)
                sys::current_branch(&path.to_string_lossy()).unwrap_or_default()
            } else {
                let _ = sys::git(&root, &["worktree", "prune"]);
                std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
                let p = path.to_string_lossy().into_owned();
                let exists = |b: &str| sys::git(&root, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{b}")]).is_ok();
                // a team coming back keeps its branch; a new one gets "prism/<project>"
                let keep = team.branch.clone().filter(|b| b.starts_with("prism/") && exists(b));
                match keep {
                    Some(b) => {
                        sys::git(&root, &["worktree", "add", &p, &b]).map_err(|e| format!("작업 공간 준비 실패: {e}"))?;
                        b
                    }
                    None => {
                        let mut b = format!("prism/{}", branch_slug(&team.project.name, &team.run));
                        if exists(&b) {
                            b = format!("{b}-{}", team.run);
                        }
                        sys::git(&root, &["worktree", "add", "-b", &b, &p, "HEAD"]).map_err(|e| format!("작업 공간 준비 실패: {e}"))?;
                        b
                    }
                }
            };
            team.cwd = path.to_string_lossy().into_owned();
            team.branch = Some(branch);
        } else {
            // safe mode turned off: back to the original folder (the team branch stays for later)
            team.home = None;
            team.cwd = root.clone();
            team.branch = sys::current_branch(&root);
        }
        // the 총괄 works wherever the team works (a moved one starts a fresh conversation there)
        if team.cwd != was {
            let cwd = team.cwd.clone();
            for a in team.agents.iter_mut().filter(|a| a.role == "lead") {
                a.cwd = cwd.clone();
                a.branch = None;
            }
        }
        Ok(())
    }

    /// Branches the team can work on: the original folder's own, plus the team's current one
    /// (other Prism branches — other teams', members' — are left out).
    pub fn branches(&self, pid: &str) -> Result<BranchList, String> {
        let (root, current) = {
            let teams = self.teams.lock().unwrap();
            let team = teams.get(pid).ok_or("팀이 없어요")?;
            (team.project.path.clone(), team.branch.clone().unwrap_or_default())
        };
        let out = sys::git(&root, &["branch", "--format=%(refname:short)"])?;
        let list = out.lines().map(str::trim).filter(|b| !b.is_empty() && (!b.starts_with("prism/") || *b == current)).map(String::from).collect();
        Ok(BranchList { current, list })
    }

    /// Put the team on another branch (`create`: a new one — in safe mode cut from the branch the
    /// team started from, for the next PR). Safe mode switches the team's copy; otherwise the
    /// original folder. Refused while anyone's working or while there are unsaved edits.
    pub fn set_branch(&self, pid: &str, branch: &str, create: bool) -> Result<(), String> {
        let branch = branch.trim();
        if branch.is_empty() || branch.contains(char::is_whitespace) || branch.starts_with('-') {
            return Err("쓸 수 없는 브랜치 이름이에요".into());
        }
        let mut teams = self.teams.lock().unwrap();
        let team = teams.get_mut(pid).ok_or("팀이 없어요")?;
        if team.tasks.iter().any(|t| t.stage == "running" || t.stage == "queued") {
            return Err("팀원이 일하는 중에는 바꿀 수 없어요. 일이 끝난 뒤 바꿔주세요.".into());
        }
        let from = team.branch.clone().unwrap_or_default();
        if branch == from && !create {
            return Ok(());
        }
        // where to switch: the team's copy (safe mode) or the original folder
        let dir = if team.home.is_some() { team.cwd.clone() } else { team.project.path.clone() };
        if !sys::changes(&dir).is_empty() {
            return Err("저장하지 않은 수정이 있어요. 팀원이 일을 마치거나 정리한 뒤 바꿔주세요.".into());
        }
        let result = if create {
            let base = team.home.clone().unwrap_or_else(|| from.clone());
            sys::git(&dir, &["switch", "-c", branch, &base])
        } else {
            sys::git(&dir, &["switch", branch])
        };
        result.map_err(|e| {
            if e.contains("already checked out") || e.contains("already used by worktree") || e.contains("is already used") {
                format!("'{branch}'는 다른 곳(원래 폴더나 다른 팀)에서 쓰고 있어요. 새 브랜치를 만들어 쓰세요.")
            } else if e.contains("already exists") {
                format!("'{branch}' 브랜치가 이미 있어요. 목록에서 골라주세요.")
            } else {
                format!("브랜치를 바꾸지 못했어요: {e}")
            }
        })?;
        team.branch = Some(branch.into());
        team.log(format!("작업 브랜치를 '{from}'에서 '{branch}'(으)로 바꿨다."), None);
        // the 총괄 should know which branch it's on now (a quiet turn: nothing for the chat)
        if self.drivers.lock().unwrap().contains_key(&format!("{pid}/lead")) {
            self.inject(team, "lead", format!("[Prism 알림] 작업 브랜치가 '{branch}'(으)로 바뀌었어요. 이제부터 이 브랜치에서 일하고, PR도 이 브랜치로 만드세요. 이 알림에는 — 한 글자로만 답하세요."));
        }
        self.emit(team);
        Ok(())
    }

    pub fn stop(&self, pid: &str) {
        let mut teams = self.teams.lock().unwrap();
        if let Some(team) = teams.get_mut(pid) {
            for a in &mut team.agents {
                if let Some(id) = a.pty_id.take() {
                    self.pty.kill(id);
                }
                if a.status != "done" {
                    a.status = "off".into();
                }
            }
            let ids: Vec<String> = team.agents.iter().map(|a| a.id.clone()).collect();
            for id in ids {
                self.kill_driver(pid, &id);
            }
            team.log("팀이 퇴근했다.", None);
            self.emit(team);
        }
    }

    /// Any agent still working in any team?
    pub fn any_running(&self) -> bool {
        !self.drivers.lock().unwrap().is_empty() || self.teams.lock().unwrap().values().any(|t| t.agents.iter().any(|a| a.pty_id.is_some()))
    }

    pub fn stop_all(&self) {
        let ids: Vec<String> = self.teams.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.stop(&id);
        }
    }

    /// Create a team member (name, worktree, record) and start it.
    fn spawn_agent(&self, team: &mut Team, role: &str, task_id: Option<String>, parent: Option<String>) -> Result<String, String> {
        let cfg = team.project.team.clone();
        let role_cfg = match role {
            "lead" => &cfg.lead,
            "mgr" => &cfg.managers,
            _ => &cfg.workers,
        };
        let (id, name, model) = match role {
            "lead" => ("lead".to_string(), "총괄".to_string(), cfg.lead.model.clone()),
            "mgr" => {
                let letter = (b'A' + team.next_mgr % 26) as char;
                team.next_mgr += 1;
                (letter.to_string(), format!("팀장 {letter}"), cfg.managers.model.clone())
            }
            _ => {
                let parent_agent = parent.as_deref().and_then(|p| team.agent_mut(p)).filter(|a| a.role == "mgr");
                let id = match parent_agent {
                    Some(p) => {
                        p.children += 1;
                        format!("{}{}", p.id, p.children)
                    }
                    None => {
                        team.next_lone += 1;
                        format!("W{}", team.next_lone)
                    }
                };
                (id.clone(), id, cfg.workers.model.clone())
            }
        };
        let task = task_id.as_deref().and_then(|t| team.tasks.iter().find(|x| x.id == t)).cloned();
        let model = task.as_ref().and_then(|t| t.model.clone()).unwrap_or(model);

        // working directory: own worktree for managers/workers when isolation is on
        let parent_cwd = parent.as_deref().and_then(|p| team.agent(p)).map(|a| a.cwd.clone()).unwrap_or_else(|| team.cwd.clone());
        let (cwd, branch) = match (&task, role) {
            (Some(t), "mgr" | "worker") if team.project.is_git && cfg.isolate => {
                let slug = t.id.to_lowercase();
                let branch = format!("prism/{}/{slug}", team.run);
                let path = PathBuf::from(&team.project.path).join(".prism").join("worktrees").join(format!("{}-{slug}", team.run));
                let base = sys::git(&parent_cwd, &["rev-parse", "HEAD"]).ok();
                sys::add_worktree(&parent_cwd, &path, &branch)?;
                if let Some(t) = team.task_mut(&t.id.clone()) {
                    t.base = base;
                }
                (path.to_string_lossy().into_owned(), Some(branch))
            }
            _ if role == "lead" => (team.cwd.clone(), team.branch.clone()),
            _ => (parent_cwd, None),
        };

        let now = now_ms();
        team.agents.push(Agent {
            id: id.clone(),
            name,
            role: role.into(),
            kind: role_cfg.agent.clone(),
            model,
            effort: role_cfg.effort.clone(),
            status: if role == "lead" { "wait".into() } else { "work".into() },
            task_id,
            parent_id: parent,
            pty_id: None,
            structured: true,
            cwd,
            branch,
            session_id: String::new(),
            cost_usd: 0.0,
            started_at: now,
            status_since: now,
            last_note: None,
            activity: vec![],
            thought: None,
            last_active: now,
            ready: true,
            pending: vec![],
            children: 0,
        });
        if let Err(e) = self.launch_agent(team, &id, None) {
            team.agents.retain(|a| a.id != id);
            return Err(e);
        }
        Ok(id)
    }

    /// Start (or, with `resume`, continue) an existing member's AI session — terminal-less.
    fn launch_agent(&self, team: &mut Team, aid: &str, resume: Option<String>) -> Result<(), String> {
        let cfg = team.project.team.clone();
        let a = team.agent(aid).cloned().ok_or("no agent")?;
        let task = a.task_id.as_deref().and_then(|t| team.tasks.iter().find(|x| x.id == t)).cloned();
        let mut system = match a.role.as_str() {
            "lead" => prompts::lead(cfg.managers.max > 0),
            "mgr" => prompts::manager(task.as_ref().map(|t| t.id.as_str()).unwrap_or("?")),
            _ => prompts::worker(),
        };
        // what the user wrote down for every AI: shared, then this team's (latest saved, not the
        // copy the team clocked in with)
        let team_notes = self.app.try_state::<Projects>().and_then(|p| p.get(&team.project.id)).map(|p| p.knowledge).unwrap_or_default();
        system += &prompts::knowledge(&crate::projects::shared_knowledge(&self.app), &team_notes);
        // safe mode: the 총괄 works in a copy; it should describe that the way the user sees it
        if let (Some(home), Some(work), "lead") = (team.home.as_deref(), team.branch.as_deref(), a.role.as_str()) {
            system += &prompts::workspace(home, work);
        }
        let pid = team.project.id.clone();
        // a Claude session that never got a message has nothing saved to resume: start it fresh
        let home = team.homes.get(&a.kind).cloned().flatten();
        let resume = resume.filter(|sid| a.kind != "claude" || crate::launch::claude_session_exists(home.as_deref(), sid, &a.cwd));
        let session_id = resume.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        // a fresh session gets its task card; a resumed one already has it
        let prompt = if resume.is_none() {
            task.as_ref().map(|t| prompts::task_card(&t.id, &t.title, &t.goal, &t.files, &t.done_when, a.branch.as_deref()))
        } else {
            None
        };
        let launch = crate::launch::build(&crate::launch::Ctx {
            kind: &a.kind,
            agent_id: aid,
            project_id: &pid,
            base: &format!("http://127.0.0.1:{}", self.port),
            token: &self.token,
            dir: &self.data_dir.join("agents").join(&team.run),
            model: &a.model,
            effort: &a.effort,
            permission_mode: &cfg.permission_mode,
            system: &system,
            prompt,
            session_id: &session_id,
            resume: resume.clone(),
            cwd: &a.cwd,
            attach_dir: Some(attachments_dir(&team.project.path).to_string_lossy().into_owned()),
            home,
        })?;

        let env: Vec<(String, String)> = [("PRISM_AGENT".to_string(), aid.to_string()), ("PRISM_PROJECT".to_string(), pid.clone())]
            .into_iter()
            .chain(launch.env)
            .collect();
        // Drivers report from anywhere — including inside `send`/`kill`, which we call while holding
        // the team lock that on_event needs. So events go through a queue to this member's own
        // thread, in order; handling them inline deadlocked the app on its own lock.
        let (tx, rx) = std::sync::mpsc::channel::<crate::structured::Event>();
        let app = self.app.clone();
        let (pid2, id2) = (pid.clone(), aid.to_string());
        std::thread::spawn(move || {
            for ev in rx {
                if let Some(m) = app.try_state::<Arc<TeamManager>>() {
                    m.on_event(&pid2, &id2, ev);
                }
            }
        });
        let sink: crate::structured::Sink = Arc::new(move |ev| {
            let _ = tx.send(ev);
        });
        let spawn = crate::structured::Spawn { program: launch.program, args: launch.args, cwd: a.cwd.clone(), env };
        let driver: Arc<dyn crate::structured::Driver> = match a.kind.as_str() {
            "antigravity" => {
                let app = self.app.clone();
                let (pid3, id3) = (pid.clone(), aid.to_string());
                // approval cards for ACP permission requests: block until the person answers
                let ask: crate::structured::Ask = Arc::new(move |title, raw| {
                    let Some(m) = app.try_state::<Arc<TeamManager>>() else { return false };
                    match m.permission_request(&pid3, &id3, &json!({ "tool_name": title, "tool_input": raw })) {
                        PermWait::Now(d) => d == "allow",
                        PermWait::Wait(_, rx) => rx.blocking_recv().map(|d| d == "allow").unwrap_or(false),
                    }
                });
                let setup = launch.acp.ok_or("ACP 설정이 없어요")?;
                crate::structured::Acp::start(spawn, setup, sink, ask)?
            }
            "codex" => {
                let codex = crate::structured::Codex::new(spawn, launch.resume_args, launch.fallback_models, sink);
                if let Some(thread) = &resume {
                    codex.continue_thread(thread);
                }
                Arc::new(crate::structured::CodexHandle(codex))
            }
            _ => crate::structured::Claude::start(spawn, sink)?,
        };
        if let Some(first) = &launch.first_message {
            driver.send(first)?;
        }
        self.drivers.lock().unwrap().insert(format!("{pid}/{aid}"), driver);
        let briefed = launch.first_message.is_some();
        if let Some(first) = launch.first_message {
            self.push_entry(&pid, aid, "in", first);
        }
        if let Some(m) = team.agent_mut(aid) {
            m.session_id = session_id;
            m.structured = true;
            m.ready = true;
            // a member coming back (resumed, or restarted fresh because its old session was gone)
            // is at work again; brand-new members already got their status in spawn_agent
            if resume.is_some() || m.status == "off" {
                m.status = if resume.is_none() && briefed { "work" } else { "wait" }.into();
                m.status_since = now_ms();
                m.last_note = None;
            }
        }
        Ok(())
    }

    fn mark_ready(&self, pid: &str, aid: &str) {
        let mut teams = self.teams.lock().unwrap();
        let Some(team) = teams.get_mut(pid) else { return };
        let Some(a) = team.agent_mut(aid) else { return };
        if a.ready {
            return;
        }
        a.ready = true;
        let pending = std::mem::take(&mut a.pending);
        if let (Some(pty), false) = (a.pty_id, pending.is_empty()) {
            self.pty.type_line(pty, pending.join(" / "));
        }
    }

    /// Sends a line to an agent's Claude Code input, queuing it until the session is up.
    fn inject(&self, team: &mut Team, aid: &str, text: String) {
        let pid = team.project.id.clone();
        let driver = self.drivers.lock().unwrap().get(&format!("{pid}/{aid}")).cloned();
        if let Some(d) = driver {
            if d.send(&text).is_ok() {
                team.set_status(aid, "work");
                self.push_entry(&pid, aid, "in", text);
            }
            return;
        }
        let Some(a) = team.agent_mut(aid) else { return };
        match (a.ready, a.pty_id) {
            (true, Some(pty)) => self.pty.type_line(pty, text),
            (_, Some(_)) => a.pending.push(text),
            _ => {}
        }
    }

    // ── structured agents ─────────────────────────────

    fn push_entry(&self, pid: &str, aid: &str, kind: &str, text: String) {
        let entry = crate::structured::Entry { at: now_ms(), kind: kind.into(), text };
        {
            let mut t = self.transcripts.lock().unwrap();
            let list = t.entry(format!("{pid}/{aid}")).or_default();
            list.push(entry.clone());
            if list.len() > 400 {
                list.drain(..list.len() - 400);
            }
        }
        let _ = self.app.emit("agent://entry", json!({ "projectId": pid, "agentId": aid, "entry": entry }));
    }

    pub fn transcript(&self, pid: &str, aid: &str) -> Vec<crate::structured::Entry> {
        self.transcripts.lock().unwrap().get(&format!("{pid}/{aid}")).cloned().unwrap_or_default()
    }

    /// Events from a structured agent → status, activity, conversation, lead chat.
    fn on_event(&self, pid: &str, aid: &str, ev: crate::structured::Event) {
        use crate::structured::Event;
        match ev {
            Event::Exit(code) => {
                self.drivers.lock().unwrap().remove(&format!("{pid}/{aid}"));
                self.on_exit(pid, aid, code.map(|c| c as u32));
                return;
            }
            Event::Text(ref t) => self.push_entry(pid, aid, "text", t.clone()),
            Event::Tool { ref name, ref input } => {
                let payload = json!({ "tool_name": name, "tool_input": input });
                if let Some(line) = describe_tool(&payload) {
                    self.push_entry(pid, aid, "tool", line);
                }
            }
            _ => {}
        }
        let mut teams = self.teams.lock().unwrap();
        let Some(team) = teams.get_mut(pid) else { return };
        match ev {
            Event::Started(sid) => {
                if let Some(a) = team.agent_mut(aid) {
                    a.session_id = sid;
                }
            }
            Event::TurnStart => {
                team.set_status(aid, "work");
                if let Some(a) = team.agent_mut(aid) {
                    a.thought = None;
                    a.last_active = now_ms();
                }
            }
            Event::Thought(t) => {
                if let Some(a) = team.agent_mut(aid) {
                    // the end is what it's on now
                    let tail: String = t.chars().rev().take(240).collect::<Vec<_>>().into_iter().rev().collect();
                    a.thought = Some(tail);
                    a.last_active = now_ms();
                }
            }
            Event::Text(t) => {
                if let Some(a) = team.agent_mut(aid) {
                    a.last_note = Some(short(&t, 200));
                    a.last_active = now_ms();
                }
            }
            Event::Tool { name, input } => {
                let payload = json!({ "tool_name": name, "tool_input": input });
                if let (Some(text), Some(a)) = (describe_tool(&payload), team.agent_mut(aid)) {
                    if a.status != "block" {
                        a.status = "work".into();
                    }
                    a.activity.push(Activity { at: now_ms(), text });
                    a.last_active = now_ms();
                    if a.activity.len() > 8 {
                        a.activity.remove(0);
                    }
                }
            }
            Event::TurnEnd { result, cost, error } => {
                let role = team.agent(aid).map(|a| a.role.clone()).unwrap_or_default();
                let permission_turn = self.permission_turns.lock().unwrap().remove(&format!("{pid}/{aid}"));
                let report = self.report_turns.lock().unwrap().remove(&format!("{pid}/{aid}"));
                if let Some(a) = team.agent_mut(aid) {
                    a.thought = None;
                    a.last_active = now_ms();
                    if let Some(c) = cost {
                        a.cost_usd = c;
                    }
                    if a.status != "done" && a.status != "block" {
                        a.status = "wait".into();
                        a.status_since = now_ms();
                    }
                }
                if let Some(text) = result.filter(|r| !r.trim().is_empty()) {
                    // a turn spent only on a teammate's permission request ends with "—": nothing to tell the user
                    // (the model sometimes answers with another lone mark, so that turn drops any punctuation-only reply)
                    let bare = text.trim().chars().count() <= 2 && !text.chars().any(char::is_alphanumeric);
                    if role == "lead" && !matches!(text.trim(), "—" | "-" | "–") && !(permission_turn && bare) {
                        say_reply(team, report, text.trim().to_string());
                    }
                    drop(teams);
                    self.push_entry(pid, aid, if error { "error" } else { "done" }, short(&text, 300));
                    let mut teams = self.teams.lock().unwrap();
                    if let Some(team) = teams.get_mut(pid) {
                        self.emit(team);
                    }
                    return;
                }
            }
            Event::Exit(_) => {}
        }
        self.emit(team);
    }

    fn on_exit(&self, pid: &str, aid: &str, code: Option<u32>) {
        let mut teams = self.teams.lock().unwrap();
        let Some(team) = teams.get_mut(pid) else { return };
        let name = team.name_of(aid);
        if let Some(a) = team.agent_mut(aid) {
            a.pty_id = None;
            let finished = a.status == "done";
            let paused = a.status == "off";
            a.status = if finished { "done".into() } else { "off".into() };
            a.status_since = now_ms();
            if !finished && !paused {
                let note = match code {
                    Some(0) | None => format!("{name}의 세션이 종료됐다."),
                    Some(c) => format!("{name}의 세션이 종료됐다 (코드 {c}). claude CLI가 설치돼 있는지 확인하세요."),
                };
                team.log(note, Some("block"));
            }
        }
        self.process_queue(team);
        self.emit(team);
    }

    // ── user actions ──────────────────────────────────

    /// "Keep going on T-n": more work for whoever did T-n, with their context intact.
    /// Still working on it → the instruction goes straight to them. Already reported or finished →
    /// a follow-up card (`follow_of`) for the same member; a member who clocked out comes back with
    /// its own conversation, in its own work folder (Claude keeps a conversation per folder), which
    /// is recreated from the latest state if it was cleared after merging.
    fn follow_up(&self, team: &mut Team, tid: &str, text: &str, from_user: bool) -> Result<String, String> {
        let task = team.tasks.iter().find(|t| t.id == tid).cloned().ok_or("그런 작업 카드가 없어요")?;
        if task.stage == "queued" {
            return Err(format!("{tid}는 아직 시작 전이에요"));
        }
        let aid = task.assignee.clone().ok_or("아직 아무도 맡지 않은 일이에요")?;
        let agent = team.agent(&aid).cloned().ok_or("담당자를 찾을 수 없어요")?;
        let pid = team.project.id.clone();
        let running = |a: &str| self.drivers.lock().unwrap().contains_key(&format!("{pid}/{a}"));
        let alive = running(&aid);
        let by = if from_user { "사용자" } else { "총괄" };

        if task.stage == "running" && alive {
            if let Some(t) = team.task_mut(tid) {
                t.goal = format!("{}\n추가: {text}", t.goal);
                t.updated_at = now_ms();
            }
            team.log(format!("{by}가 {}에게 {tid} 추가 지시를 보냈다.", agent.name), None);
            self.inject(team, &aid, format!("[Prism 추가 지시 · {tid}] {text}"));
            return Ok(format!("{tid}를 하고 있는 {}에게 추가 지시를 바로 전달했어요.", agent.name));
        }

        team.next_task += 1;
        let fid = format!("T-{}", team.next_task);
        let now = now_ms();
        team.tasks.push(Task {
            id: fid.clone(),
            title: short(text, 30),
            goal: text.into(),
            files: vec![],
            done_when: vec![],
            requested_by: task.requested_by.clone(),
            assignee: Some(aid.clone()),
            role: task.role.clone(),
            model: None,
            stage: "running".into(),
            summary: None,
            branch: None,
            base: None,
            created_at: now,
            updated_at: now,
            follow_of: Some(tid.into()),
        });

        let mut fresh = false;
        if !alive {
            let wt = agent.cwd.clone();
            let base = if wt.contains("/.prism/worktrees/") && !std::path::Path::new(&wt).exists() {
                // its folder was cleared after merging: same place, cut from the latest state
                let parent_cwd = agent
                    .parent_id
                    .as_deref()
                    .and_then(|p| team.agent(p))
                    .map(|p| p.cwd.clone())
                    .filter(|c| std::path::Path::new(c).exists())
                    .unwrap_or_else(|| team.cwd.clone());
                let branch = format!("prism/{}/{}", team.run, fid.to_lowercase());
                let base = sys::git(&parent_cwd, &["rev-parse", "HEAD"]).ok();
                sys::add_worktree(&parent_cwd, std::path::Path::new(&wt), &branch)?;
                if let Some(a) = team.agent_mut(&aid) {
                    a.branch = Some(branch);
                }
                base
            } else {
                sys::git(&wt, &["rev-parse", "HEAD"]).ok()
            };
            if let Some(t) = team.task_mut(&fid) {
                t.base = base;
            }
            // whoever it used to report to may have clocked out: report to the 총괄 then
            let parent_alive = agent.parent_id.as_deref().is_some_and(&running);
            if let Some(a) = team.agent_mut(&aid) {
                a.task_id = Some(fid.clone());
                if !parent_alive {
                    a.parent_id = Some("lead".into());
                }
            }
            let resume = (!agent.session_id.is_empty()).then(|| agent.session_id.clone());
            if self.launch_agent(team, &aid, resume).is_err() {
                self.launch_agent(team, &aid, None)?;
                fresh = true; // a fresh start already got the card as its first message
            }
        } else {
            if let Some(t) = team.task_mut(&fid) {
                t.base = sys::git(&agent.cwd, &["rev-parse", "HEAD"]).ok();
            }
            if let Some(a) = team.agent_mut(&aid) {
                a.task_id = Some(fid.clone());
            }
        }
        team.log(format!("{by}가 {tid}에 이어서 {fid}를 {}에게 맡겼다.", agent.name), None);
        if !fresh {
            let branch = team.agent(&aid).and_then(|a| a.branch.clone());
            let card = prompts::task_card(&fid, &short(text, 30), text, &[], &[], branch.as_deref());
            self.inject(team, &aid, format!("[Prism 추가 작업 · {tid}에 이어서]\n{card}"));
        }
        Ok(format!("{tid}에 이어서 {fid}를 {}에게 맡겼어요. 끝나면 '[Prism 보고]'가 와요.", agent.name))
    }

    /// The report card's "이어서 시키기": the user hands more work to whoever did `tid`.
    pub fn task_follow_up(&self, pid: &str, tid: &str, text: String) -> Result<(), String> {
        let mut teams = self.teams.lock().unwrap();
        let team = teams.get_mut(pid).ok_or("팀이 출근하지 않았어요")?;
        let out = self.follow_up(team, tid, text.trim(), true)?;
        team.say("me", format!("{tid}에 이어서: {}", text.trim()), None);
        // the 총괄 stays in the loop: it reviews and merges when the report comes
        self.inject(
            team,
            "lead",
            format!("[Prism 알림] 사용자가 작업 카드에서 직접 맡겼어요 — {out} 보고가 오면 평소처럼 검토·머지하고 complete_task 하세요. 사용자에게는 접수했다고 한 줄만 답하세요."),
        );
        self.emit(team);
        Ok(())
    }

    pub fn lead_send(&self, pid: &str, text: String) -> Result<(), String> {
        let mut teams = self.teams.lock().unwrap();
        let team = teams.get_mut(pid).ok_or("팀이 출근하지 않았어요")?;
        team.say("me", text.clone(), None);
        team.set_status("lead", "work");
        self.inject(team, "lead", text);
        self.emit(team);
        Ok(())
    }

    pub fn answer_escalation(&self, pid: &str, msg_id: u64, answer: String) -> Result<(), String> {
        let mut teams = self.teams.lock().unwrap();
        let team = teams.get_mut(pid).ok_or("no team")?;
        let msg = team.chat.iter_mut().find(|m| m.id == msg_id).ok_or("no such message")?;
        let esc = msg.escalation.as_mut().ok_or("not an escalation")?;
        if esc.answer.is_some() {
            return Ok(());
        }
        esc.answer = Some(answer.clone());
        let aid = esc.agent_id.clone();
        let name = team.name_of(&aid);
        team.say("me", answer.clone(), None);
        team.set_status(&aid, "work");
        team.log(format!("사용자가 {name}에게 답했다: {}", short(&answer, 40)), None);
        self.inject(team, &aid, format!("[Prism 답변] 사용자: {answer}"));
        self.emit(team);
        Ok(())
    }

    pub fn message_agent(&self, pid: &str, aid: &str, text: String) -> Result<(), String> {
        let mut teams = self.teams.lock().unwrap();
        let team = teams.get_mut(pid).ok_or("no team")?;
        let name = team.name_of(aid);
        team.log(format!("사용자가 {name}에게 직접 지시했다: {}", short(&text, 40)), None);
        team.set_status(aid, "work");
        self.inject(team, aid, text);
        self.emit(team);
        Ok(())
    }

    pub fn set_model(&self, pid: &str, aid: &str, model: String) -> Result<(), String> {
        let mut teams = self.teams.lock().unwrap();
        let team = teams.get_mut(pid).ok_or("no team")?;
        let a = team.agent_mut(aid).ok_or("no agent")?;
        if a.kind != "claude" {
            return Err("실행 중 모델 변경은 Claude 에이전트만 돼요".into());
        }
        a.model = model.clone();
        let name = a.name.clone();
        team.log(format!("{name}의 모델을 {model}(으)로 바꿨다."), None);
        self.inject(team, aid, format!("/model {model}"));
        self.emit(team);
        Ok(())
    }

    fn kill_driver(&self, pid: &str, aid: &str) {
        let d = self.drivers.lock().unwrap().get(&format!("{pid}/{aid}")).cloned();
        if let Some(d) = d {
            d.kill();
        }
    }

    pub fn kill_agent(&self, pid: &str, aid: &str) {
        self.kill_driver(pid, aid);
        let teams = self.teams.lock().unwrap();
        if let Some(pty) = teams.get(pid).and_then(|t| t.agent(aid)).and_then(|a| a.pty_id) {
            self.pty.kill(pty);
        }
    }

    pub fn set_usage(&self, list: Vec<Usage>) {
        let mut usage = self.usage.lock().unwrap();
        for u in list {
            usage.insert(u.provider.clone(), u);
        }
        let _ = self.app.emit("usage://update", usage.values().cloned().collect::<Vec<_>>());
    }

    // ── permission requests ───────────────────────────

    pub fn permission_request(&self, pid: &str, aid: &str, payload: &Value) -> PermWait {
        let tool = payload.get("tool_name").and_then(Value::as_str).unwrap_or("도구").to_string();
        let input = payload.get("tool_input").cloned().unwrap_or(Value::Null);
        let detail = input
            .get("command")
            .or_else(|| input.get("file_path"))
            .or_else(|| input.get("url"))
            .and_then(Value::as_str)
            .map(String::from)
            .unwrap_or_else(|| short(&input.to_string(), 160));

        let mut teams = self.teams.lock().unwrap();
        let Some(team) = teams.get_mut(pid) else { return PermWait::Now("") };
        if team.always_allow.contains(&perm_key(&tool, &detail)) {
            return PermWait::Now("allow");
        }
        let name = team.name_of(aid);
        // the boss decides first (팀장 for a 작업자, 총괄 for a 팀장) — unless it's risky or nobody's there
        let boss = team
            .agent(aid)
            .and_then(|a| a.parent_id.clone())
            .filter(|b| !needs_user(&tool, &detail, &team.project.path) && self.drivers.lock().unwrap().contains_key(&format!("{pid}/{b}")));
        let (tx, rx) = tokio::sync::oneshot::channel();
        let id = team.say("permission", format!("{name}이(가) 실행하려고 해요"), None);
        if let Some(m) = team.chat.iter_mut().find(|m| m.id == id) {
            m.task_ids.clear();
            m.permission = Some(Permission { agent_id: aid.into(), tool: tool.clone(), detail: detail.clone(), answer: None, decider: boss.clone(), decided_by: None });
        }
        team.set_status(aid, "block");
        self.perm_waiters.lock().unwrap().insert(id, tx);
        match &boss {
            Some(b) => {
                let boss_name = team.name_of(b);
                team.log(format!("{name}이(가) {boss_name}에게 허락을 구한다: {tool} {}", short(&detail, 50)), None);
                self.permission_turns.lock().unwrap().insert(format!("{pid}/{b}"));
                self.inject(
                    team,
                    b,
                    format!(
                        "[Prism 허락 요청 #{id}] {name}이(가) 실행하려고 해요 — {tool}: {}\n\
프로젝트 안의 평범한 개발 작업(설치·빌드·테스트·파일 작업)이면 decide_permission(request_id: {id}, decision: \"allow\"), \
맡긴 일과 상관없거나 위험하면 \"deny\", 사용자 판단이 필요하면 \"ask_user\". 판단한 뒤 하던 일을 이어서 하세요.",
                        short(&detail, 300)
                    ),
                );
                // a busy boss mustn't stall the team: hand it to the user after a while
                let app = self.app.clone();
                let pid2 = pid.to_string();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(90));
                    if let Some(m) = app.try_state::<Arc<TeamManager>>() {
                        m.escalate_permission(&pid2, id, "윗선이 바로 답하지 못했어요");
                    }
                });
            }
            None => {
                team.log(format!("{name}이(가) 허락을 기다린다: {tool} {}", short(&detail, 50)), Some("block"));
                self.notify(&format!("[{}] {name} 허락 요청", team.project.name), &format!("{tool}: {}", short(&detail, 80)));
            }
        }
        self.emit(team);
        PermWait::Wait(id, rx)
    }

    /// Hand a request the boss is holding over to the user (boss asked, or took too long).
    fn escalate_permission(&self, pid: &str, msg_id: u64, why: &str) {
        let mut teams = self.teams.lock().unwrap();
        let Some(team) = teams.get_mut(pid) else { return };
        let Some(m) = team.chat.iter_mut().find(|m| m.id == msg_id) else { return };
        let Some(p) = m.permission.as_mut() else { return };
        if p.answer.is_some() || p.decider.is_none() {
            return;
        }
        p.decider = None;
        let (aid, tool, detail) = (p.agent_id.clone(), p.tool.clone(), p.detail.clone());
        let name = team.name_of(&aid);
        team.log(format!("{name}의 허락 요청을 사용자에게 넘겼다 ({why})."), Some("block"));
        self.notify(&format!("[{}] {name} 허락 요청", team.project.name), &format!("{tool}: {}", short(&detail, 80)));
        self.emit(team);
    }

    /// One way to settle a request, whoever answers. `by`: "사용자" or the deciding boss's name.
    fn resolve_permission(&self, team: &mut Team, msg_id: u64, answer: &str, by: &str) -> Result<(), String> {
        let msg = team.chat.iter_mut().find(|m| m.id == msg_id).ok_or("no such message")?;
        let perm = msg.permission.as_mut().ok_or("not a permission request")?;
        if perm.answer.is_some() {
            return Ok(());
        }
        perm.answer = Some(answer.into());
        perm.decided_by = Some(by.into());
        perm.decider = None;
        let (aid, key, detail) = (perm.agent_id.clone(), perm_key(&perm.tool, &perm.detail), perm.detail.clone());
        if answer == "always" {
            team.always_allow.insert(key);
        }
        if let Some(tx) = self.perm_waiters.lock().unwrap().remove(&msg_id) {
            let _ = tx.send(match answer {
                "allow" | "always" => "allow",
                "deny" => "deny",
                _ => "",
            });
        }
        if answer != "timeout" {
            team.set_status(&aid, "work");
            let name = team.name_of(&aid);
            team.log(format!("{by}가 {name}의 요청을 {}했다: {}", if answer == "deny" { "거부" } else { "허락" }, short(&detail, 40)), None);
        }
        self.emit(team);
        Ok(())
    }

    /// `answer`: "allow" | "always" | "deny" | "timeout"
    pub fn answer_permission(&self, pid: &str, msg_id: u64, answer: &str) -> Result<(), String> {
        let mut teams = self.teams.lock().unwrap();
        let team = teams.get_mut(pid).ok_or("no team")?;
        self.resolve_permission(team, msg_id, answer, if answer == "timeout" { "시간 초과" } else { "사용자" })
    }

    // ── hooks & status line ───────────────────────────

    pub fn on_hook(&self, pid: &str, aid: &str, event: &str, payload: Value) {
        if event == "SessionStart" {
            self.mark_ready(pid, aid);
        }
        let mut teams = self.teams.lock().unwrap();
        let Some(team) = teams.get_mut(pid) else { return };
        let Some(agent) = team.agent(aid).cloned() else { return };
        match event {
            "UserPromptSubmit" => team.set_status(aid, "work"),
            "PostToolUse" => {
                if agent.status == "block" {
                    team.set_status(aid, "work");
                }
                if let Some(text) = describe_tool(&payload) {
                    if let Some(a) = team.agent_mut(aid) {
                        a.activity.push(Activity { at: now_ms(), text });
                    a.last_active = now_ms();
                        if a.activity.len() > 8 {
                            a.activity.remove(0);
                        }
                    }
                }
            }
            "Notification" => {
                let kind = payload.get("notification_type").and_then(Value::as_str).unwrap_or("");
                let message = payload.get("message").and_then(Value::as_str).unwrap_or("").to_string();
                if kind == "permission_prompt" || message.to_lowercase().contains("permission") {
                    team.set_status(aid, "block");
                }
            }
            "Stop" => {
                let report = self.report_turns.lock().unwrap().remove(&format!("{pid}/{aid}"));
                let text = payload
                    .get("last_assistant_message")
                    .and_then(Value::as_str)
                    .map(String::from)
                    .or_else(|| payload.get("transcript_path").and_then(Value::as_str).and_then(last_assistant_text))
                    .unwrap_or_default();
                if agent.status != "done" && agent.status != "block" {
                    team.set_status(aid, "wait");
                }
                if !text.trim().is_empty() {
                    if let Some(a) = team.agent_mut(aid) {
                        a.last_note = Some(short(&text, 200));
                    }
                    if agent.role == "lead" {
                        say_reply(team, report, text.trim().to_string());
                    }
                }
            }
            _ => {}
        }
        self.emit(team);
    }

    /// Claude Code status line: record cost, answer with the line Claude shows.
    pub fn on_status(&self, pid: &str, aid: &str, payload: Value) -> String {
        let mut teams = self.teams.lock().unwrap();
        let Some(team) = teams.get_mut(pid) else { return "Prism".into() };
        let cost = payload.pointer("/cost/total_cost_usd").and_then(Value::as_f64);
        if let Some(rl) = payload.get("rate_limits") {
            let windows = parse_rate_limits(rl);
            if !windows.is_empty() {
                let plan = self.usage.lock().unwrap().get("claude").and_then(|u| u.plan.clone());
                self.set_usage(vec![Usage { provider: "claude".into(), windows, plan, note: None, updated_at: now_ms() }]);
            }
        }
        let Some(a) = team.agent_mut(aid) else { return "Prism".into() };
        let line = format!("🗼 Prism · {} · {}{}", a.name, a.model, a.task_id.as_ref().map(|t| format!(" · {t}")).unwrap_or_default());
        if let Some(c) = cost {
            if (c - a.cost_usd).abs() >= 0.001 {
                a.cost_usd = c;
                self.emit(team);
            }
        }
        line
    }

    // ── MCP ───────────────────────────────────────────

    pub fn tools_for(&self, pid: &str, aid: &str) -> Vec<Value> {
        let teams = self.teams.lock().unwrap();
        let role = teams.get(pid).and_then(|t| t.agent(aid)).map(|a| a.role.clone()).unwrap_or_default();
        let can_mgr = teams.get(pid).map(|t| t.project.team.managers.max > 0).unwrap_or(false);
        drop(teams);

        let strs = json!({ "type": "array", "items": { "type": "string" } });
        let to_enum: Vec<&str> = if role == "lead" && can_mgr { vec!["manager", "worker"] } else { vec!["worker"] };
        let delegate = json!({
            "name": "delegate",
            "description": "작업 카드를 만들어 하위 에이전트(팀장/작업자)에게 하청을 준다. 즉시 반환되며, 결과는 나중에 '[Prism 보고]' 메시지로 온다.",
            "inputSchema": { "type": "object", "properties": {
                "title": { "type": "string", "description": "짧은 제목 (예: 카카오 로그인)" },
                "goal": { "type": "string", "description": "무엇을 해야 하는지 구체적으로" },
                "to": { "type": "string", "enum": to_enum },
                "files": strs, "done_when": strs,
                "model": { "type": "string", "description": "이 카드만 다른 모델로 (opus/sonnet/haiku). 보통 생략" },
                "follow_up": { "type": "string", "description": "이미 있는 카드의 추가·수정 작업이면 그 카드 ID (예: T-1). 같은 담당자가 맥락을 이어서 맡는다. 새 일이면 생략" }
            }, "required": ["title", "goal", "to"] }
        });
        let list = json!({ "name": "list_tasks", "description": "팀의 작업 카드와 에이전트 상태를 본다.", "inputSchema": { "type": "object", "properties": {} } });
        let message = json!({
            "name": "message_agent", "description": "하위 에이전트에게 추가 지시를 보낸다.",
            "inputSchema": { "type": "object", "properties": { "agent": { "type": "string" }, "message": { "type": "string" } }, "required": ["agent", "message"] }
        });
        let complete = json!({
            "name": "complete_task", "description": "하위 작업을 검토·머지한 뒤 완료 처리한다. 해당 에이전트 세션이 정리된다.",
            "inputSchema": { "type": "object", "properties": { "task_id": { "type": "string" }, "note": { "type": "string" } }, "required": ["task_id"] }
        });
        let report = json!({
            "name": "report", "description": "맡은 작업 카드의 결과를 상위에 보고한다.",
            "inputSchema": { "type": "object", "properties": {
                "status": { "type": "string", "enum": ["done", "failed"] },
                "summary": { "type": "string", "description": "3줄 이내 요약" }
            }, "required": ["status", "summary"] }
        });
        let escalate = json!({
            "name": "escalate", "description": "사람의 판단이나 비밀값이 필요할 때 사용자에게 질문한다. 답은 '[Prism 답변]'으로 온다.",
            "inputSchema": { "type": "object", "properties": {
                "question": { "type": "string" },
                "options": { "type": "array", "items": { "type": "string" }, "description": "선택지 (최대 3개)" }
            }, "required": ["question"] }
        });
        // used by Claude Code itself (--permission-prompt-tool), not by the model
        let approve = json!({
            "name": "approve",
            "description": "Prism이 사용자에게 도구 사용 허락을 받는다 (Claude Code가 자동으로 호출).",
            "inputSchema": { "type": "object", "properties": {
                "tool_name": { "type": "string" }, "input": { "type": "object" }, "tool_use_id": { "type": "string" }
            }, "required": ["tool_name", "input"] }
        });
        let decide = json!({
            "name": "decide_permission",
            "description": "아래 팀원이 보낸 '[Prism 허락 요청 #번호]'에 답한다. 평범한 개발 작업이면 allow, 맡긴 일과 상관없거나 위험하면 deny, 사용자가 정해야 하면 ask_user.",
            "inputSchema": { "type": "object", "properties": {
                "request_id": { "type": "integer" },
                "decision": { "type": "string", "enum": ["allow", "deny", "ask_user"] },
                "reason": { "type": "string", "description": "한 줄 이유 (기록용)" }
            }, "required": ["request_id", "decision"] }
        });
        match role.as_str() {
            "lead" => vec![delegate, list, message, complete, decide, approve],
            "mgr" => vec![delegate, list, message, complete, report, escalate, decide, approve],
            "worker" => vec![report, escalate, approve],
            _ => vec![],
        }
    }

    pub fn call_tool(&self, pid: &str, aid: &str, tool: &str, args: Value) -> Result<String, String> {
        let s = |k: &str| args.get(k).and_then(Value::as_str).map(str::to_string);
        let v = |k: &str| {
            args.get(k)
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect::<Vec<_>>())
                .unwrap_or_default()
        };
        let mut teams = self.teams.lock().unwrap();
        let team = teams.get_mut(pid).ok_or("팀이 없습니다")?;
        let me = team.agent(aid).cloned().ok_or("알 수 없는 에이전트")?;

        let out = match tool {
            "delegate" if s("follow_up").is_some_and(|x| !x.trim().is_empty()) => {
                let of = s("follow_up").unwrap();
                let mine = team.tasks.iter().any(|t| t.id == of && (t.requested_by == aid || me.role == "lead"));
                if !mine {
                    return Err(format!("{of}는 네가 맡긴 카드가 아니에요"));
                }
                let text = [s("title"), s("goal")].into_iter().flatten().collect::<Vec<_>>().join(" — ");
                self.follow_up(team, &of, &text, false)?
            }
            "delegate" => {
                let role = if s("to").as_deref() == Some("manager") && me.role == "lead" { "mgr" } else { "worker" };
                team.next_task += 1;
                let id = format!("T-{}", team.next_task);
                let now = now_ms();
                team.tasks.push(Task {
                    id: id.clone(),
                    title: s("title").unwrap_or_else(|| "작업".into()),
                    goal: s("goal").unwrap_or_default(),
                    files: v("files"),
                    done_when: v("done_when"),
                    requested_by: aid.into(),
                    assignee: None,
                    role: role.into(),
                    model: s("model").filter(|m| !m.is_empty()),
                    stage: "queued".into(),
                    summary: None,
                    branch: None,
                    base: None,
                    created_at: now,
                    updated_at: now,
                    follow_of: None,
                });
                team.log(format!("{}이(가) {id} \"{}\"를 만들었다.", me.name, short(&s("title").unwrap_or_default(), 30)), None);
                self.process_queue(team);
                let t = team.tasks.iter().find(|t| t.id == id).unwrap();
                match &t.assignee {
                    Some(a) => format!("{id} 배정 → {} ({}). 끝나면 '[Prism 보고]'가 옵니다. 기다리지 말고 다음 일을 하세요.", team.name_of(a), team.agent(a).map(|x| x.model.clone()).unwrap_or_default()),
                    None => format!("{id} 대기열에 들어갔어요 (동시 실행 한도). 자리가 나면 자동 배정됩니다."),
                }
            }
            "decide_permission" => {
                let id = args.get("request_id").and_then(Value::as_u64).ok_or("request_id 필요")?;
                let decision = s("decision").unwrap_or_default();
                let perm = team.chat.iter().find(|m| m.id == id).and_then(|m| m.permission.clone()).ok_or("그런 허락 요청이 없어요")?;
                if perm.answer.is_some() {
                    "이미 처리된 요청이에요. 하던 일을 이어서 하세요.".to_string()
                } else if perm.decider.as_deref() != Some(aid) {
                    return Err("네가 판단할 요청이 아니에요".into());
                } else {
                    match decision.as_str() {
                        "allow" | "deny" => {
                            self.resolve_permission(team, id, &decision, &me.name)?;
                            format!("{} 처리했어요. 하던 일을 이어서 하세요.", if decision == "allow" { "허락" } else { "거부" })
                        }
                        _ => {
                            drop(teams);
                            self.escalate_permission(pid, id, &s("reason").unwrap_or_else(|| "윗선이 사용자 판단을 요청".into()));
                            return Ok("사용자에게 넘겼어요. 답은 그 팀원에게 바로 가요. 하던 일을 이어서 하세요.".into());
                        }
                    }
                }
            }
            "list_tasks" => {
                let mut lines = vec![];
                for t in &team.tasks {
                    let who = t.assignee.as_deref().map(|a| team.name_of(a)).unwrap_or_else(|| "-".into());
                    lines.push(format!("{} [{}] {} · 담당 {} · 요청 {}{}", t.id, t.stage, t.title, who, team.name_of(&t.requested_by),
                        t.summary.as_ref().map(|s| format!(" · {}", short(s, 60))).unwrap_or_default()));
                }
                if lines.is_empty() { "작업 카드가 없어요.".into() } else { lines.join("\n") }
            }
            "message_agent" => {
                let target = s("agent").ok_or("agent 필요")?;
                let target = team.agents.iter().find(|a| a.id == target || a.name == target).map(|a| a.id.clone()).ok_or("그런 에이전트가 없어요")?;
                self.inject(team, &target, format!("[Prism {}] {}", me.name, s("message").unwrap_or_default()));
                team.set_status(&target, "work");
                format!("{}에게 전달했어요.", team.name_of(&target))
            }
            "complete_task" => {
                let tid = s("task_id").ok_or("task_id 필요")?;
                let t = team.task_mut(&tid).ok_or("그런 작업 카드가 없어요")?;
                t.stage = "done".into();
                t.updated_at = now_ms();
                // clock the member out only if this is still the card it holds: after a follow-up
                // ("이어서") it is already busy with the next one in the same folder
                let assignee = t.assignee.clone().filter(|a| team.agent(a).is_some_and(|x| x.task_id.as_deref() == Some(tid.as_str())));
                if let Some(a) = assignee.as_deref().and_then(|a| team.agent_mut(a)) {
                    a.status = "done".into();
                    a.status_since = now_ms();
                    if let Some(p) = a.pty_id {
                        self.pty.kill(p);
                    }
                }
                if let Some(a) = assignee.as_deref() {
                    self.kill_driver(pid, a);
                    // its work is merged: drop the work copy (the branch stays, so results remain viewable)
                    let wt = team.agent(a).map(|x| x.cwd.clone()).filter(|c| c.contains("/.prism/worktrees/"));
                    if let Some(wt) = wt {
                        let repo = team.project.path.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_secs(3));
                            // no --force: anything left uncommitted keeps the folder
                            let _ = sys::git(&repo, &["worktree", "remove", &wt]);
                        });
                    }
                }
                team.log(format!("{}이(가) {tid}를 완료 처리했다.{}", me.name, s("note").map(|n| format!(" {}", short(&n, 40))).unwrap_or_default()), None);
                self.process_queue(team);
                format!("{tid} 완료 처리했어요.")
            }
            "report" => {
                let tid = me.task_id.clone().ok_or("맡은 작업 카드가 없어요")?;
                let ok = s("status").as_deref() != Some("failed");
                let summary = s("summary").unwrap_or_default();
                let branch = me.branch.clone();
                if let Some(t) = team.task_mut(&tid) {
                    t.stage = if ok { "review".into() } else { "failed".into() };
                    t.summary = Some(summary.clone());
                    t.branch = branch.clone();
                    t.updated_at = now_ms();
                }
                team.set_status(aid, if ok { "done" } else { "block" });
                team.log(format!("{}이(가) {tid}를 {}했다.", me.name, if ok { "보고" } else { "실패 보고" }), if ok { None } else { Some("block") });
                if let Some(parent) = me.parent_id.clone() {
                    let mut msg = format!("[Prism 보고] {tid} ({}) {}: {summary}", me.name, if ok { "완료" } else { "실패" });
                    if let Some(b) = branch {
                        msg += &format!(" — 브랜치 {b} 를 검토·머지한 뒤 complete_task(\"{tid}\")를 호출하세요.");
                    } else {
                        msg += &format!(" — 확인 후 complete_task(\"{tid}\")를 호출하세요.");
                    }
                    self.report_turns.lock().unwrap().insert(format!("{}/{parent}", team.project.id), tid.clone());
                    team.set_status(&parent, "work");
                    self.inject(team, &parent, msg);
                }
                "보고를 전달했어요. 이제 멈추고 기다리세요.".into()
            }
            "escalate" => {
                let question = s("question").ok_or("question 필요")?;
                let mut path = vec![aid.to_string()];
                let mut cur = me.parent_id.clone();
                while let Some(p) = cur {
                    path.push(p.clone());
                    cur = team.agent(&p).and_then(|a| a.parent_id.clone());
                }
                let names = path.iter().map(|p| team.name_of(p)).collect::<Vec<_>>().join(" → ");
                let mut options = v("options");
                options.truncate(3);
                team.set_status(aid, "block");
                team.say("escalation", question.clone(), Some(Escalation { agent_id: aid.into(), task_id: me.task_id.clone(), path, options, answer: None }));
                team.log(format!("{}이(가) 막혔다: {}", me.name, short(&question, 50)), Some("block"));
                self.notify(&format!("[{}] 막힘 · {names}", team.project.name), &question);
                "사용자에게 질문했어요. 답은 '[Prism 답변]'으로 옵니다. 지금은 멈추고 기다리세요.".into()
            }
            _ => return Err(format!("알 수 없는 도구: {tool}")),
        };
        self.emit(team);
        Ok(out)
    }

    /// Starts queued cards while the role and team limits allow.
    fn process_queue(&self, team: &mut Team) {
        let cfg = team.project.team.clone();
        let queued: Vec<(String, String, String)> = team
            .tasks
            .iter()
            .filter(|t| t.stage == "queued")
            .map(|t| (t.id.clone(), t.role.clone(), t.requested_by.clone()))
            .collect();
        for (tid, role, parent) in queued {
            let max = if role == "mgr" { cfg.managers.max } else { cfg.workers.max } as usize;
            let busy = team.active("mgr") + team.active("worker");
            if team.active(&role) >= max || busy >= cfg.concurrent as usize {
                continue;
            }
            match self.spawn_agent(team, &role, Some(tid.clone()), Some(parent)) {
                Ok(aid) => {
                    let name = team.name_of(&aid);
                    if let Some(t) = team.task_mut(&tid) {
                        t.assignee = Some(aid);
                        t.stage = "running".into();
                        t.updated_at = now_ms();
                    }
                    team.log(format!("{tid}이(가) {name}에게 배정됐다."), None);
                }
                Err(e) => {
                    if let Some(t) = team.task_mut(&tid) {
                        t.stage = "failed".into();
                        t.summary = Some(format!("에이전트 시작 실패: {e}"));
                    }
                    team.log(format!("{tid} 에이전트 시작 실패: {}", short(&e, 60)), Some("block"));
                }
            }
        }
    }
}

/// One short line for a finished tool call, for the live activity feed.
fn describe_tool(payload: &Value) -> Option<String> {
    let tool = payload.get("tool_name").and_then(Value::as_str)?;
    let input = payload.get("tool_input").cloned().unwrap_or(Value::Null);
    let s = |k: &str| input.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let file = || {
        let p = s("file_path");
        p.rsplit(['/', '\\']).next().unwrap_or(&p).to_string()
    };
    Some(match tool {
        "Edit" | "MultiEdit" | "apply_patch" => format!("✏️ {} 수정", file()),
        "Write" => format!("📝 {} 작성", file()),
        "Read" => format!("📖 {} 읽음", file()),
        "Bash" | "shell" | "exec_command" => {
            let cmd = input.get("command").map(|v| v.as_str().map(String::from).unwrap_or_else(|| v.to_string())).unwrap_or_default();
            format!("$ {}", short(&cmd, 70))
        }
        "Grep" => format!("🔍 \"{}\" 검색", short(&s("pattern"), 40)),
        "Glob" => format!("🔍 {} 찾기", short(&s("pattern"), 40)),
        "WebFetch" | "WebSearch" => format!("🌐 {}", short(&(s("url") + &s("query")), 60)),
        "TodoWrite" => "🗒️ 할 일 정리".into(),
        t if t.starts_with("mcp__prism__") || t.starts_with("prism") => return None, // shown elsewhere
        t => format!("🔧 {t}"),
    })
}

/// Fallback when the Stop hook has no `last_assistant_message`: read the transcript tail.
fn last_assistant_text(path: &str) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    for line in text.lines().rev() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if v.get("type").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let parts: Vec<&str> = v
            .pointer("/message/content")
            .and_then(Value::as_array)
            .map(|c| c.iter().filter(|b| b.get("type").and_then(Value::as_str) == Some("text")).filter_map(|b| b.get("text").and_then(Value::as_str)).collect())
            .unwrap_or_default();
        if !parts.is_empty() {
            return Some(parts.join("\n"));
        }
    }
    None
}

/// Where attached files are copied: inside the project (git-excluded via `.prism/`), so agents
/// can read them without leaving their sandbox.
pub fn attachments_dir(project: &str) -> PathBuf {
    PathBuf::from(project).join(".prism").join("attachments")
}

fn attach_name(name: &str) -> String {
    let clean: String = name.chars().map(|c| if c == '/' || c == '\\' || c == ':' { '_' } else { c }).collect();
    format!("{}-{clean}", now_ms())
}

/// Copies files the user picked/dropped into the project's attachment folder; returns new paths.
#[tauri::command]
pub fn attach_files(projects: tauri::State<'_, Projects>, project_id: String, paths: Vec<String>) -> Result<Vec<String>, String> {
    let p = projects.get(&project_id).ok_or("no such project")?;
    let dir = attachments_dir(&p.path);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut out = vec![];
    for src in paths {
        let src = PathBuf::from(src);
        if !src.is_file() {
            return Err(format!("파일이 아니에요: {}", src.display()));
        }
        let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
        let dst = dir.join(attach_name(&name));
        std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
        out.push(dst.to_string_lossy().into_owned());
    }
    Ok(out)
}

/// Saves pasted bytes (e.g. a clipboard screenshot) as an attachment.
#[tauri::command]
pub fn attach_bytes(projects: tauri::State<'_, Projects>, project_id: String, name: String, data: Vec<u8>) -> Result<String, String> {
    let p = projects.get(&project_id).ok_or("no such project")?;
    let dir = attachments_dir(&p.path);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dst = dir.join(attach_name(&name));
    std::fs::write(&dst, data).map_err(|e| e.to_string())?;
    Ok(dst.to_string_lossy().into_owned())
}

// ── commands ──────────────────────────────────────────

type Teams<'a> = tauri::State<'a, Arc<TeamManager>>;

/// Error string the UI recognises to open the login sheet.
pub const LOGIN_REQUIRED: &str = "LOGIN_REQUIRED";

#[tauri::command]
pub async fn team_start(app: AppHandle, project_id: String, cwd: Option<String>) -> Result<TeamSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let accounts = app.state::<crate::accounts::Accounts>();
        let projects = app.state::<Projects>();
        let mut p = projects.get(&project_id).ok_or("no such project")?;
        let mut homes = HashMap::new();
        for kind in [&p.team.lead.agent, &p.team.managers.agent, &p.team.workers.agent] {
            if homes.contains_key(kind) {
                continue;
            }
            if !accounts.active_status(kind).logged_in {
                return Err(format!("{LOGIN_REQUIRED}:{kind}"));
            }
            homes.insert(kind.clone(), accounts.active_dir(kind));
        }
        sys::ensure_repo(&p.path).map_err(|e| format!("git 준비 실패: {e}"))?;
        if !p.is_git {
            projects.mark_git(&p.id);
            p.is_git = true;
        }
        let cwd = cwd.filter(|c| !c.is_empty()).unwrap_or_else(|| p.path.clone());
        app.state::<Arc<TeamManager>>().start(p, cwd, homes)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn agent_transcript(teams: Teams<'_>, project_id: String, agent_id: String) -> Vec<crate::structured::Entry> {
    teams.transcript(&project_id, &agent_id)
}

#[tauri::command]
pub fn agent_pause(teams: Teams<'_>, project_id: String, agent_id: String) -> Result<(), String> {
    teams.pause_agent(&project_id, &agent_id)
}

#[tauri::command]
pub fn agent_resume(teams: Teams<'_>, project_id: String, agent_id: String) -> Result<(), String> {
    teams.resume_agent(&project_id, &agent_id)
}

#[tauri::command]
pub fn usage_get(teams: Teams<'_>) -> Vec<Usage> {
    teams.usage.lock().unwrap().values().cloned().collect()
}

/// Fetch every provider's remaining subscription usage now (also runs every 5 minutes).
pub fn refresh_usage(app: &AppHandle) {
    let accounts = app.state::<crate::accounts::Accounts>();
    let (claude_dir, codex_dir) = (accounts.active_dir("claude"), accounts.active_dir("codex"));
    let a = std::thread::spawn(move || crate::usage::claude(claude_dir.as_deref()));
    let b = std::thread::spawn(move || crate::usage::codex(codex_dir.as_deref()));
    let c = std::thread::spawn(crate::usage::antigravity);
    let list: Vec<Usage> = [a, b, c].into_iter().filter_map(|h| h.join().ok()).collect();
    app.state::<Arc<TeamManager>>().set_usage(list);
}

#[tauri::command]
pub async fn usage_refresh(app: AppHandle) {
    let _ = tauri::async_runtime::spawn_blocking(move || refresh_usage(&app)).await;
}

#[tauri::command]
pub fn team_stop(teams: Teams<'_>, project_id: String) {
    teams.stop(&project_id)
}

#[tauri::command]
pub fn team_get(teams: Teams<'_>, project_id: String) -> Option<TeamSnapshot> {
    teams.snapshot(&project_id)
}

#[tauri::command]
pub fn task_follow_up(teams: Teams<'_>, project_id: String, task_id: String, text: String) -> Result<(), String> {
    teams.task_follow_up(&project_id, &task_id, text)
}

#[tauri::command]
pub fn lead_send(teams: Teams<'_>, project_id: String, text: String) -> Result<(), String> {
    teams.lead_send(&project_id, text)
}

#[tauri::command]
pub fn escalation_answer(teams: Teams<'_>, project_id: String, msg_id: u64, answer: String) -> Result<(), String> {
    teams.answer_escalation(&project_id, msg_id, answer)
}

#[tauri::command]
pub fn permission_answer(teams: Teams<'_>, project_id: String, msg_id: u64, answer: String) -> Result<(), String> {
    teams.answer_permission(&project_id, msg_id, &answer)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchList {
    /// the branch the team works on now
    pub current: String,
    pub list: Vec<String>,
}

#[tauri::command]
pub async fn team_branches(app: AppHandle, project_id: String) -> Result<BranchList, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Arc<TeamManager>>().branches(&project_id)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn team_set_branch(app: AppHandle, project_id: String, branch: String, create: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Arc<TeamManager>>().set_branch(&project_id, &branch, create)).await.map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub path: String,
    pub added: i64,
    pub removed: i64,
}

impl TeamManager {
    /// (repo dir, base commit, task branch) for reading a task's results.
    fn task_refs(&self, pid: &str, tid: &str) -> Result<(String, String, String), String> {
        let teams = self.teams.lock().unwrap();
        let team = teams.get(pid).ok_or("no team")?;
        let t = team.tasks.iter().find(|t| t.id == tid).ok_or("no task")?;
        let branch = t.branch.clone().or_else(|| t.assignee.as_deref().and_then(|a| team.agent(a)).and_then(|a| a.branch.clone()));
        match (t.base.clone(), branch) {
            (Some(b), Some(br)) => Ok((team.project.path.clone(), b, br)),
            _ => Err("이 작업은 별도 브랜치 없이 진행돼서 결과 파일을 따로 볼 수 없어요".into()),
        }
    }
}

#[tauri::command]
pub fn task_files(teams: Teams<'_>, project_id: String, task_id: String) -> Result<Vec<FileStat>, String> {
    let (repo, base, branch) = teams.task_refs(&project_id, &task_id)?;
    let out = sys::git(&repo, &["diff", "--numstat", &base, &branch])?;
    Ok(out
        .lines()
        .filter_map(|l| {
            let mut it = l.splitn(3, '\t');
            let (a, r, p) = (it.next()?, it.next()?, it.next()?);
            Some(FileStat { path: p.into(), added: a.parse().unwrap_or(-1), removed: r.parse().unwrap_or(-1) })
        })
        .filter(|f| !f.path.starts_with(".prism/"))
        .collect())
}

#[tauri::command]
pub fn task_diff(teams: Teams<'_>, project_id: String, task_id: String, path: String) -> Result<String, String> {
    let (repo, base, branch) = teams.task_refs(&project_id, &task_id)?;
    sys::git(&repo, &["diff", &base, &branch, "--", &path])
}

/// File content as it is on the task's branch (for previews).
#[tauri::command]
pub fn task_file(teams: Teams<'_>, project_id: String, task_id: String, path: String) -> Result<String, String> {
    let (repo, _, branch) = teams.task_refs(&project_id, &task_id)?;
    sys::git(&repo, &["show", &format!("{branch}:{path}")])
}

#[tauri::command]
pub fn agent_message(teams: Teams<'_>, project_id: String, agent_id: String, text: String) -> Result<(), String> {
    teams.message_agent(&project_id, &agent_id, text)
}

#[tauri::command]
pub fn agent_set_model(teams: Teams<'_>, project_id: String, agent_id: String, model: String) -> Result<(), String> {
    teams.set_model(&project_id, &agent_id, model)
}

#[tauri::command]
pub fn agent_kill(teams: Teams<'_>, project_id: String, agent_id: String) {
    teams.kill_agent(&project_id, &agent_id)
}
