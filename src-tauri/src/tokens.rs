//! Token ledger: what every turn of every member spent, kept per day, team, card, member and model,
//! so the screens can say "오늘 약 12만 토큰" or "이 카드 …" and flag a runaway turn.
//!
//! Numbers come from the CLIs themselves: Claude's `result` event (`usage`, `modelUsage`) and
//! Codex's `turn.completed` (`usage`). Saved as one file in the app data folder, so it survives restarts.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// A turn whose conversation reaches this many tokens is flagged: every turn re-sends all of it.
pub const BIG_CONTEXT: u64 = 150_000;
/// This many turns from one member within `RAPID_WINDOW_MS` is flagged as a burst.
const RAPID_TURNS: usize = 6;
const RAPID_WINDOW_MS: u64 = 5 * 60_000;
/// Alerts kept in memory (newest last); the team view shows the latest few.
const KEEP_ALERTS: usize = 30;
const SHOW_ALERTS: usize = 5;

/// Token counts. `input` is new (uncached) input; the cache counts are separate, as the CLIs report them.
#[derive(Serialize, Deserialize, Default, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    #[serde(default)]
    pub input: u64,
    #[serde(default)]
    pub output: u64,
    #[serde(default)]
    pub cache_read: u64,
    #[serde(default)]
    pub cache_write: u64,
}

impl Bucket {
    fn add(&mut self, o: &Bucket) {
        self.input += o.input;
        self.output += o.output;
        self.cache_read += o.cache_read;
        self.cache_write += o.cache_write;
    }

    pub fn total(&self) -> u64 {
        self.input + self.output + self.cache_read + self.cache_write
    }
}

/// One row of the ledger: what one member spent on one model, for one card, on one day.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Row {
    /// local calendar day, "2026-11-25"
    day: String,
    project: String,
    /// the card the turn was for; "" when none (the 총괄's own talk)
    #[serde(default)]
    task: String,
    agent: String,
    /// the member's name at the time (kept after the member is cleared from the team)
    agent_name: String,
    /// model family: "opus" | "sonnet" | "haiku" | "fable", else the model's own name
    model: String,
    #[serde(flatten)]
    b: Bucket,
}

#[derive(Clone)]
struct Alert {
    project: String,
    at: u64,
    kind: &'static str,
    agent_name: String,
    task: Option<String>,
    peak_tokens: Option<u64>,
    turns: Option<u64>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Ledger {
    #[serde(default)]
    rows: Vec<Row>,
    #[serde(skip)]
    path: PathBuf,
    /// the biggest conversation a request of the current turn sent, by "project/agent"
    #[serde(skip)]
    peaks: HashMap<String, u64>,
    /// when a member's recent turns ended, by "project/agent"
    #[serde(skip)]
    recent: HashMap<String, Vec<u64>>,
    #[serde(skip)]
    alerts: Vec<Alert>,
}

/// What a team's screens show about tokens (sent with every snapshot).
#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TeamUsage {
    /// today, the whole team
    pub today: Bucket,
    /// today, by model (biggest first)
    pub models: Vec<ModelUse>,
    /// today, by member (biggest first)
    pub members: Vec<MemberUse>,
    /// every card so far, by card id
    pub cards: Vec<CardUse>,
    /// latest warnings, newest first
    pub alerts: Vec<AlertOut>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelUse {
    pub model: String,
    #[serde(flatten)]
    pub bucket: Bucket,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemberUse {
    pub agent_id: String,
    pub name: String,
    #[serde(flatten)]
    pub bucket: Bucket,
    pub models: Vec<ModelUse>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CardUse {
    pub task_id: String,
    #[serde(flatten)]
    pub bucket: Bucket,
    pub models: Vec<ModelUse>,
}

/// A warning: "big" (one turn re-sent a huge conversation) or "rapid" (many turns in a short time).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AlertOut {
    pub at: u64,
    pub kind: &'static str,
    pub agent_name: String,
    pub task_id: Option<String>,
    pub peak_tokens: Option<u64>,
    pub turns: Option<u64>,
}

/// Local calendar day, "2026-11-25": "today" for the usage screens.
pub fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// A model's family for grouping ("claude-haiku-5-5" → "haiku"); other models keep their name.
pub fn family(model: &str) -> String {
    let m = model.to_lowercase();
    for f in ["fable", "opus", "sonnet", "haiku"] {
        if m.contains(f) {
            return f.to_string();
        }
    }
    model.to_string()
}

fn key(pid: &str, aid: &str) -> String {
    format!("{pid}/{aid}")
}

/// Totals per model, biggest first.
fn models_of<'a>(rows: impl Iterator<Item = &'a Row>) -> Vec<ModelUse> {
    let mut by: BTreeMap<String, Bucket> = BTreeMap::new();
    for r in rows {
        by.entry(r.model.clone()).or_default().add(&r.b);
    }
    let mut out: Vec<ModelUse> = by.into_iter().map(|(model, bucket)| ModelUse { model, bucket }).collect();
    out.sort_by_key(|m| std::cmp::Reverse(m.bucket.total()));
    out
}

impl Ledger {
    /// Reads the saved ledger; a file that can't be read is kept aside (as `.bad`) and a new one starts.
    pub fn load(path: PathBuf) -> Self {
        let mut ledger = match std::fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<Ledger>(&text) {
                Ok(l) => l,
                Err(_) => {
                    let _ = std::fs::rename(&path, path.with_extension("json.bad"));
                    Ledger::default()
                }
            },
            Err(_) => Ledger::default(),
        };
        ledger.path = path;
        ledger
    }

    fn save(&self) {
        let Ok(text) = serde_json::to_string(self) else { return };
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let tmp = self.path.with_extension("json.tmp");
        if std::fs::write(&tmp, text).is_ok() {
            let _ = std::fs::rename(&tmp, &self.path);
        }
    }

    /// The tokens one turn used, for one model. `context` is the largest conversation a request of
    /// the turn sent (0 when unknown); the turn's end checks it.
    pub fn add(&mut self, pid: &str, aid: &str, name: &str, task: Option<&str>, model: &str, b: Bucket, context: u64) {
        let day = today();
        let task = task.unwrap_or("");
        let family = family(model);
        let pos = self.rows.iter().position(|r| r.day == day && r.project == pid && r.task == task && r.agent == aid && r.model == family);
        let row = match pos {
            Some(i) => &mut self.rows[i],
            None => {
                self.rows.push(Row {
                    day,
                    project: pid.into(),
                    task: task.into(),
                    agent: aid.into(),
                    agent_name: name.into(),
                    model: family,
                    b: Bucket::default(),
                });
                self.rows.last_mut().expect("just pushed")
            }
        };
        row.agent_name = name.into();
        row.b.add(&b);
        self.note_context(pid, aid, context);
        self.save();
    }

    /// A request of the member's current turn held `n` tokens: the turn keeps the biggest one.
    pub fn note_context(&mut self, pid: &str, aid: &str, n: u64) {
        if n > 0 {
            let peak = self.peaks.entry(key(pid, aid)).or_insert(0);
            *peak = (*peak).max(n);
        }
    }

    /// A member's turn ended: flags a big conversation, and a burst of turns within a short time.
    pub fn turn_end(&mut self, pid: &str, aid: &str, name: &str, task: Option<&str>, now: u64) {
        let k = key(pid, aid);
        let peak = self.peaks.remove(&k).unwrap_or(0);
        let mut raised = Vec::new();
        if peak >= BIG_CONTEXT {
            raised.push(Alert { project: pid.into(), at: now, kind: "big", agent_name: name.into(), task: task.map(String::from), peak_tokens: Some(peak), turns: None });
        }
        let times = self.recent.entry(k).or_default();
        times.retain(|t| now.saturating_sub(*t) <= RAPID_WINDOW_MS);
        times.push(now);
        if times.len() >= RAPID_TURNS {
            raised.push(Alert { project: pid.into(), at: now, kind: "rapid", agent_name: name.into(), task: task.map(String::from), peak_tokens: None, turns: Some(times.len() as u64) });
            times.clear();
        }
        self.alerts.extend(raised);
        let extra = self.alerts.len().saturating_sub(KEEP_ALERTS);
        self.alerts.drain(..extra);
    }

    /// What a team's screens show: today's totals, and every card so far.
    pub fn summary(&self, pid: &str) -> TeamUsage {
        let day = today();
        let mine: Vec<&Row> = self.rows.iter().filter(|r| r.project == pid).collect();
        let todays: Vec<&Row> = mine.iter().copied().filter(|r| r.day == day).collect();

        let mut today = Bucket::default();
        for r in &todays {
            today.add(&r.b);
        }

        let mut by_member: BTreeMap<String, Vec<&Row>> = BTreeMap::new();
        for r in &todays {
            by_member.entry(r.agent.clone()).or_default().push(*r);
        }
        let mut members: Vec<MemberUse> = by_member
            .into_iter()
            .map(|(agent_id, rows)| {
                let mut bucket = Bucket::default();
                for r in &rows {
                    bucket.add(&r.b);
                }
                let name = rows.last().map(|r| r.agent_name.clone()).unwrap_or_default();
                MemberUse { agent_id, name, bucket, models: models_of(rows.into_iter()) }
            })
            .collect();
        members.sort_by_key(|m| std::cmp::Reverse(m.bucket.total()));

        let mut by_card: BTreeMap<String, Vec<&Row>> = BTreeMap::new();
        for r in mine.iter().filter(|r| !r.task.is_empty()) {
            by_card.entry(r.task.clone()).or_default().push(*r);
        }
        let cards = by_card
            .into_iter()
            .map(|(task_id, rows)| {
                let mut bucket = Bucket::default();
                for r in &rows {
                    bucket.add(&r.b);
                }
                CardUse { task_id, bucket, models: models_of(rows.into_iter()) }
            })
            .collect();

        let alerts = self
            .alerts
            .iter()
            .rev()
            .filter(|a| a.project == pid)
            .take(SHOW_ALERTS)
            .map(|a| AlertOut { at: a.at, kind: a.kind, agent_name: a.agent_name.clone(), task_id: a.task.clone(), peak_tokens: a.peak_tokens, turns: a.turns })
            .collect();

        TeamUsage { today, models: models_of(todays.into_iter()), members, cards, alerts }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("prism-tokens-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("usage.json")
    }

    fn b(input: u64, output: u64, cache_read: u64, cache_write: u64) -> Bucket {
        Bucket { input, output, cache_read, cache_write }
    }

    #[test]
    fn family_groups_model_ids_by_name() {
        assert_eq!(family("claude-haiku-5-5"), "haiku");
        assert_eq!(family("claude-opus-5-5"), "opus");
        assert_eq!(family("sonnet"), "sonnet");
        assert_eq!(family("gpt-5.5-codex"), "gpt-5.5-codex");
    }

    #[test]
    fn today_totals_members_models_and_cards_add_up() {
        let mut l = Ledger::load(tmp_file("sums"));
        l.add("p1", "a1", "W1", Some("T-1"), "claude-haiku-5-5", b(10, 5, 100, 20), 0);
        l.add("p1", "a1", "W1", Some("T-1"), "claude-opus-5-5", b(1, 2, 3, 4), 0);
        l.add("p1", "lead", "총괄", None, "opus", b(7, 0, 0, 0), 0);
        l.add("p2", "x", "other", Some("T-9"), "opus", b(999, 0, 0, 0), 0);

        let s = l.summary("p1");
        assert_eq!(s.today.total(), 10 + 5 + 100 + 20 + 1 + 2 + 3 + 4 + 7);
        let haiku = s.models.iter().find(|m| m.model == "haiku").unwrap();
        assert_eq!(haiku.bucket.cache_read, 100);
        assert_eq!(s.members.len(), 2);
        let w1 = s.members.iter().find(|m| m.agent_id == "a1").unwrap();
        assert_eq!(w1.name, "W1");
        assert_eq!(w1.models.len(), 2);
        assert_eq!(s.cards.len(), 1, "the 총괄's talk is not a card; the other team's card is not this team's");
        assert_eq!(s.cards[0].task_id, "T-1");
        assert_eq!(s.cards[0].bucket.total(), 10 + 5 + 100 + 20 + 1 + 2 + 3 + 4);
        assert!(s.alerts.is_empty());
    }

    #[test]
    fn rows_from_other_days_count_for_cards_but_not_today() {
        let mut l = Ledger::load(tmp_file("days"));
        l.rows.push(Row { day: "2000-01-01".into(), project: "p1".into(), task: "T-0".into(), agent: "a1".into(), agent_name: "W1".into(), model: "haiku".into(), b: b(50, 50, 0, 0) });
        let s = l.summary("p1");
        assert_eq!(s.today.total(), 0);
        assert!(s.members.is_empty());
        assert_eq!(s.cards[0].bucket.total(), 100);
    }

    #[test]
    fn saved_ledger_comes_back_after_a_restart() {
        let path = tmp_file("persist");
        {
            let mut l = Ledger::load(path.clone());
            l.add("p1", "a1", "W1", Some("T-1"), "sonnet", b(3, 4, 5, 6), 0);
        }
        let again = Ledger::load(path);
        let s = again.summary("p1");
        assert_eq!(s.today, b(3, 4, 5, 6));
        assert_eq!(s.cards[0].task_id, "T-1");
    }

    #[test]
    fn a_turn_re_sending_a_huge_conversation_is_flagged() {
        let mut l = Ledger::load(tmp_file("big"));
        l.note_context("p1", "a1", 90_000);
        l.note_context("p1", "a1", BIG_CONTEXT + 5_000);
        l.note_context("p1", "a1", 120_000);
        l.turn_end("p1", "a1", "W1", Some("T-1"), 1_000);
        let s = l.summary("p1");
        assert_eq!(s.alerts.len(), 1);
        assert_eq!(s.alerts[0].kind, "big");
        assert_eq!(s.alerts[0].peak_tokens, Some(BIG_CONTEXT + 5_000));
        assert_eq!(s.alerts[0].task_id.as_deref(), Some("T-1"));
        // the peak belongs to that turn only
        l.turn_end("p1", "a1", "W1", Some("T-1"), 2_000);
        assert_eq!(l.summary("p1").alerts.len(), 1);
    }

    #[test]
    fn a_burst_of_turns_in_a_short_time_is_flagged_once() {
        let mut l = Ledger::load(tmp_file("rapid"));
        for i in 0..5 {
            l.turn_end("p1", "a1", "W1", None, i * 1_000);
        }
        assert!(l.summary("p1").alerts.is_empty());
        l.turn_end("p1", "a1", "W1", None, 6_000);
        let s = l.summary("p1");
        assert_eq!(s.alerts.len(), 1);
        assert_eq!(s.alerts[0].kind, "rapid");
        assert_eq!(s.alerts[0].turns, Some(6));
    }

    #[test]
    fn turns_spread_out_over_time_are_not_a_burst() {
        let mut l = Ledger::load(tmp_file("spread"));
        for i in 0..10 {
            l.turn_end("p1", "a1", "W1", None, i * (RAPID_WINDOW_MS + 1));
        }
        assert!(l.summary("p1").alerts.is_empty());
    }

    #[test]
    fn a_corrupt_file_is_set_aside_and_a_new_ledger_starts() {
        let path = tmp_file("corrupt");
        std::fs::write(&path, "{ not json").unwrap();
        let l = Ledger::load(path.clone());
        assert!(l.rows.is_empty());
        assert!(path.with_extension("json.bad").exists());
    }
}
