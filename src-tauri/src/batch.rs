//! 묶음 지시: one instruction sent to several teams at once.
//!
//! The frontend calls `batch_create` (which only records the batch: id, targets, time sent) and then
//! sends the text to each team with `lead_send`. A watcher thread checks every team until it has
//! finished that instruction, then writes one short summary of all the results (Claude Haiku, with a
//! plain fallback). Every change goes to the UI as a `batch-update` event with the whole batch.

use std::collections::HashSet;
use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

use crate::projects::now_ms;
use crate::sys;
use crate::team::TeamManager;

/// How often every unfinished batch is checked.
const WATCH_EVERY: Duration = Duration::from_secs(3);
/// The summary call gives up after this long and the fallback is used.
const SUMMARY_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    pub id: String,
    pub text: String,
    /// when the instruction was sent (ms since the epoch)
    pub sent_at: u64,
    pub teams: Vec<BatchTeam>,
    pub summary: Option<String>,
    pub finished_at: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BatchTeam {
    pub project_id: String,
    /// "run" | "done" | "failed"
    pub state: String,
}

/// What a team looks like right now, as far as batches care (see `TeamManager::batch_facts`).
#[derive(Clone, Debug, Default)]
pub struct Facts {
    pub name: String,
    /// the 총괄's status: "work" | "wait" | "block" | "done" | "off"
    pub lead_status: String,
    /// the 총괄 ran into a problem (stopped, no answer…)
    pub lead_stuck: bool,
    /// (created_at, stage) of every task card
    pub tasks: Vec<(u64, String)>,
    /// (at, text) of the 총괄's latest answers and reports, oldest first
    pub replies: Vec<(u64, String)>,
}

/// The 총괄's last answer given after the instruction went out, if there is one.
pub fn reply_since(f: &Facts, sent_at: u64) -> Option<&str> {
    f.replies.last().filter(|(at, _)| *at >= sent_at).map(|(_, text)| text.as_str())
}

/// `Some("done")` / `Some("failed")` once a team has finished the instruction sent at `sent_at`;
/// `None` while it is still going.
pub fn team_outcome(f: &Facts, sent_at: u64) -> Option<&'static str> {
    if f.lead_status == "off" || (f.lead_stuck && f.lead_status != "work") {
        return Some("failed");
    }
    // "block" = waiting for the person to allow something: not finished either
    let busy = f.lead_status == "work" || f.lead_status == "block";
    let cards_finished = f.tasks.iter().filter(|(at, _)| *at >= sent_at).all(|(_, stage)| stage == "done" || stage == "failed");
    let answered = reply_since(f, sent_at).is_some();
    (!busy && cards_finished && answered).then_some("done")
}

/// One team's line in the summary.
#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    pub name: String,
    pub failed: bool,
    pub reply: Option<String>,
}

/// Plain summary used when the model is unavailable: "팀이름: 마지막 답의 첫 줄", one team per line.
pub fn fallback_summary(lines: &[Line]) -> String {
    lines
        .iter()
        .map(|l| {
            let body = match (&l.reply, l.failed) {
                (Some(r), false) => first_line(r),
                (Some(r), true) => format!("{} (멈춤)", first_line(r)),
                (None, true) => "멈춰서 결과가 없어요".to_string(),
                (None, false) => "결과 없음".to_string(),
            };
            format!("{}: {body}", l.name)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The prompt for the summary model (Korean).
pub fn summary_prompt(instruction: &str, lines: &[Line]) -> String {
    let mut p = String::from(
        "아래는 여러 팀에 같은 지시를 보낸 뒤, 각 팀 총괄이 마지막으로 보고한 내용입니다.\n\
         팀별로 한 줄씩 결과를 쓰고, 마지막에 전체를 한두 줄로 요약하세요.\n\
         전체 2~5줄, 한국어, 머리말이나 설명 없이 요약 본문만 출력하세요.\n\n",
    );
    p.push_str(&format!("[지시]\n{}\n\n", clip(instruction, 1000)));
    for l in lines {
        let state = if l.failed { " (멈춤)" } else { "" };
        let reply = l.reply.as_deref().map(|r| clip(r, 1500)).unwrap_or_else(|| "(보고 없음)".into());
        p.push_str(&format!("[{}{state}]\n{reply}\n\n", l.name));
    }
    p
}

fn first_line(text: &str) -> String {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    clip(line, 120)
}

fn clip(s: &str, n: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= n { s.to_string() } else { format!("{}…", s.chars().take(n).collect::<String>()) }
}

/// Ask the installed Claude CLI with Haiku. None if it isn't there, fails, or takes too long.
fn ask_haiku(prompt: &str) -> Option<String> {
    let mut child = sys::command("claude")
        .args(["-p", "--model", "haiku"])
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let pid = child.id();
    let mut stdin = child.stdin.take()?;
    let input = prompt.to_string();
    std::thread::spawn(move || {
        let _ = stdin.write_all(input.as_bytes());
    });
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    match rx.recv_timeout(SUMMARY_TIMEOUT) {
        Ok(Ok(out)) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            (!text.is_empty()).then_some(text)
        }
        Ok(_) => None,
        Err(_) => {
            kill(pid);
            None
        }
    }
}

fn kill(pid: u32) {
    #[cfg(unix)]
    let _ = std::process::Command::new("kill").args(["-9", &pid.to_string()]).status();
    #[cfg(windows)]
    crate::sys::kill_pid_tree(pid);
}

pub struct Batches {
    app: AppHandle,
    items: Mutex<Vec<Batch>>,
    file: Option<PathBuf>,
    /// batches whose summary is being written, so the watcher doesn't start it twice
    summarizing: Mutex<HashSet<String>>,
}

impl Batches {
    pub fn load(app: &AppHandle) -> Self {
        let file = app.path().app_data_dir().ok().map(|d| d.join("batches.json"));
        let items = file
            .as_ref()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .and_then(|t| serde_json::from_str::<Vec<Batch>>(&t).ok())
            .unwrap_or_default();
        Self { app: app.clone(), items: Mutex::new(items), file, summarizing: Mutex::default() }
    }

    fn save(&self, items: &[Batch]) {
        let Some(f) = &self.file else { return };
        if let Some(dir) = f.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_string(items) {
            let tmp = f.with_extension("json.tmp");
            if std::fs::write(&tmp, text).is_ok() {
                let _ = std::fs::rename(tmp, f);
            }
        }
    }

    fn emit(&self, batch: &Batch) {
        let _ = self.app.emit("batch-update", batch);
    }

    /// Record a batch (the messages themselves are sent by the frontend with `lead_send`).
    pub fn create(&self, project_ids: Vec<String>, text: String) -> Result<Batch, String> {
        let mut ids: Vec<String> = vec![];
        for id in project_ids {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        if ids.is_empty() {
            return Err("묶음 지시를 보낼 팀이 없어요".into());
        }
        let batch = Batch {
            id: uuid::Uuid::new_v4().simple().to_string(),
            text,
            sent_at: now_ms(),
            teams: ids.into_iter().map(|project_id| BatchTeam { project_id, state: "run".into() }).collect(),
            summary: None,
            finished_at: None,
        };
        {
            let mut items = self.items.lock().unwrap();
            items.push(batch.clone());
            self.save(&items);
        }
        self.emit(&batch);
        Ok(batch)
    }

    pub fn list(&self) -> Vec<Batch> {
        self.items.lock().unwrap().clone()
    }

    /// One watch pass: update each unfinished batch's teams, and once all are finished, summarize.
    pub fn check(self: &Arc<Self>, teams: &TeamManager) {
        let pending: Vec<Batch> = self.items.lock().unwrap().iter().filter(|b| b.finished_at.is_none()).cloned().collect();
        for batch in pending {
            let mut states = batch.teams.clone();
            let mut lines: Vec<Line> = vec![];
            for team in states.iter_mut() {
                let facts = teams.batch_facts(&team.project_id);
                if team.state == "run" {
                    let outcome = match &facts {
                        Some(f) => team_outcome(f, batch.sent_at),
                        None => Some("failed"), // the team is gone
                    };
                    if let Some(o) = outcome {
                        team.state = o.into();
                    }
                }
                let failed = team.state == "failed";
                let name = facts.as_ref().map(|f| f.name.clone()).unwrap_or_else(|| team.project_id.clone());
                let reply = facts.as_ref().and_then(|f| reply_since(f, batch.sent_at)).map(str::to_string);
                lines.push(Line { name, failed, reply });
            }
            let all_finished = states.iter().all(|t| t.state != "run");
            let changed = states != batch.teams;
            if !changed && !all_finished {
                continue;
            }
            if !all_finished {
                self.update(&batch.id, |b| b.teams = states.clone());
                continue;
            }
            if !self.summarizing.lock().unwrap().insert(batch.id.clone()) {
                continue;
            }
            self.update(&batch.id, |b| b.teams = states.clone());
            let me = self.clone();
            std::thread::spawn(move || me.finish(batch.id.clone(), batch.text.clone(), lines));
        }
    }

    /// Apply a change to one batch, persist and emit it.
    fn update(&self, id: &str, f: impl FnOnce(&mut Batch)) {
        let mut items = self.items.lock().unwrap();
        let Some(b) = items.iter_mut().find(|b| b.id == id) else { return };
        f(b);
        let snapshot = b.clone();
        self.save(&items);
        drop(items);
        self.emit(&snapshot);
    }

    /// Write the summary (model, else the plain fallback), then mark the batch finished.
    fn finish(&self, id: String, text: String, lines: Vec<Line>) {
        let summary = ask_haiku(&summary_prompt(&text, &lines))
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| fallback_summary(&lines));
        let first = summary.lines().next().unwrap_or("").to_string();
        self.update(&id, |b| {
            b.summary = Some(summary);
            b.finished_at = Some(now_ms());
        });
        self.summarizing.lock().unwrap().remove(&id);
        let _ = self.app.notification().builder().title("묶음 지시가 끝났어요").body(first).show();
    }
}

/// Start the watcher thread (call after the teams are loaded, so restored teams are judged as they are).
pub fn start_watch(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(WATCH_EVERY);
        if let (Some(batches), Some(teams)) = (app.try_state::<Arc<Batches>>(), app.try_state::<Arc<TeamManager>>()) {
            batches.check(&teams);
        }
    });
}

#[tauri::command]
pub fn batch_create(batches: State<'_, Arc<Batches>>, project_ids: Vec<String>, text: String) -> Result<Batch, String> {
    batches.create(project_ids, text)
}

#[tauri::command]
pub fn batch_list(batches: State<'_, Arc<Batches>>) -> Vec<Batch> {
    batches.list()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(lead: &str, tasks: &[(u64, &str)], replies: &[(u64, &str)]) -> Facts {
        Facts {
            name: "쇼핑몰".into(),
            lead_status: lead.into(),
            lead_stuck: false,
            tasks: tasks.iter().map(|(at, s)| (*at, s.to_string())).collect(),
            replies: replies.iter().map(|(at, s)| (*at, s.to_string())).collect(),
        }
    }

    #[test]
    fn team_is_running_while_lead_works() {
        let f = facts("work", &[], &[(200, "좋아요")]);
        assert_eq!(team_outcome(&f, 100), None);
    }

    #[test]
    fn team_is_done_when_lead_waits_cards_finished_and_answered() {
        let f = facts("wait", &[(110, "done"), (120, "failed")], &[(200, "끝났어요")]);
        assert_eq!(team_outcome(&f, 100), Some("done"));
    }

    #[test]
    fn team_is_running_while_a_card_from_the_batch_is_unfinished() {
        let f = facts("wait", &[(110, "done"), (120, "running")], &[(200, "맡겼어요")]);
        assert_eq!(team_outcome(&f, 100), None);
    }

    #[test]
    fn cards_from_before_the_batch_are_ignored() {
        let f = facts("wait", &[(50, "running")], &[(200, "끝났어요")]);
        assert_eq!(team_outcome(&f, 100), Some("done"));
    }

    #[test]
    fn team_needs_an_answer_after_the_batch() {
        let f = facts("wait", &[], &[(50, "지난 답")]);
        assert_eq!(team_outcome(&f, 100), None);
        assert_eq!(reply_since(&f, 100), None);
    }

    #[test]
    fn team_waiting_for_permission_is_not_finished() {
        let f = facts("block", &[], &[(200, "허락을 기다려요")]);
        assert_eq!(team_outcome(&f, 100), None);
    }

    #[test]
    fn lead_off_or_stuck_means_failed() {
        let off = facts("off", &[], &[]);
        assert_eq!(team_outcome(&off, 100), Some("failed"));
        let mut stuck = facts("wait", &[], &[(200, "문제")]);
        stuck.lead_stuck = true;
        assert_eq!(team_outcome(&stuck, 100), Some("failed"));
        // stuck but still working: not decided yet
        let mut slow = facts("work", &[], &[]);
        slow.lead_stuck = true;
        assert_eq!(team_outcome(&slow, 100), None);
    }

    #[test]
    fn fallback_lists_each_team_with_its_first_line() {
        let lines = vec![
            Line { name: "쇼핑몰".into(), failed: false, reply: Some("\n  결제 기능 완료\n세부 내용".into()) },
            Line { name: "게시판".into(), failed: false, reply: None },
            Line { name: "문제은행".into(), failed: true, reply: None },
        ];
        assert_eq!(
            fallback_summary(&lines),
            "쇼핑몰: 결제 기능 완료\n게시판: 결과 없음\n문제은행: 멈춰서 결과가 없어요"
        );
    }

    #[test]
    fn summary_prompt_names_every_team_and_the_instruction() {
        let lines = vec![Line { name: "쇼핑몰".into(), failed: true, reply: Some("실패 보고".into()) }];
        let p = summary_prompt("버튼 색 바꿔줘", &lines);
        assert!(p.contains("버튼 색 바꿔줘"));
        assert!(p.contains("[쇼핑몰 (멈춤)]"));
        assert!(p.contains("실패 보고"));
    }

    #[test]
    fn clip_counts_characters_not_bytes() {
        assert_eq!(clip("가나다라", 2), "가나…");
        assert_eq!(clip("가나", 2), "가나");
    }
}
