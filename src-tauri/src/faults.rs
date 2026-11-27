//! 고장 난 팀원: which members count as broken, and what their boss is told about it.
//!
//! The rules live here (plain functions, easy to test); `team.rs` watches the sessions, sends the
//! notices and does the restart.
//!
//! A member is broken when its card is still 진행 중 but it can't finish it by itself: its program
//! ended, its turn ended in an error (or a usage limit), it went silent, or it stopped without
//! reporting. Why is kept in `Agent::stuck`, which the screens show next to a 다시 시작 button.

use crate::team::{Agent, Task};

/// Notices wait this long, so one crash (the turn's error, then the exit) makes one notice.
pub const GATHER: std::time::Duration = std::time::Duration::from_secs(3);
/// A member shown as working with no program behind it for this long is broken.
pub const GHOST_AFTER_MS: u64 = 60 * 1000;
/// A turn ended, no report came and nothing happened for this long: it won't go on by itself.
pub const IDLE_NO_REPORT_MS: u64 = 10 * 60 * 1000;
/// Mid-turn with no sign of life this long: the boss is told (the screens say so earlier).
pub const SILENT_TELL_MS: u64 = 10 * 60 * 1000;
/// A request waiting on the user this long: the boss is told, so it can remind the user.
pub const PERMISSION_WAIT_MS: u64 = 3 * 60 * 1000;
/// How many times an AI boss may restart a member on one card. The user has no limit.
pub const MAX_AI_RESTARTS: u32 = 3;

/// `stuck` when the user closed the member with 종료.
pub const KILLED_BY_USER: &str = "사용자가 껐어요";

/// What kind of trouble a reason text describes — it decides the advice that goes with the notice.
#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Kind {
    /// usage or rate limit: starting again right away fails again
    Limit,
    /// not signed in: only the user can fix it
    Login,
    ByUser,
    /// a long silence: it may just be a slow command
    Silent,
    Other,
}

pub fn classify(reason: &str) -> Kind {
    let r = reason.to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| r.contains(w));
    if r == KILLED_BY_USER {
        Kind::ByUser
    } else if has(&["usage limit", "rate limit", "rate_limit", "hit your limit", "session limit", "weekly limit", "limit reached", "too many requests", "429", "quota", "credit balance", "사용량 한도", "사용 한도"]) {
        Kind::Limit
    } else if has(&["/login", "log in", "logged in", "sign in", "unauthorized", "401", "authentication", "invalid api key", "oauth", "로그인"]) {
        Kind::Login
    } else if has(&["응답이 없어요"]) {
        Kind::Silent
    } else {
        Kind::Other
    }
}

fn advice(kind: Kind) -> &'static str {
    match kind {
        Kind::Limit => "사용량 한도 때문으로 보여요. 지금 다시 시작해도 같은 이유로 멈춰요. restart_agent를 바로 쓰지 말고 사용자에게 한도가 풀린 뒤 이어서 하겠다고 쉬운 말로 알려주세요.",
        Kind::Login => "로그인 문제로 보여요. 다시 시작해도 해결되지 않으니 사용자에게 설정에서 다시 로그인해 달라고 쉬운 말로 알려주세요.",
        Kind::ByUser => "사용자가 직접 끈 것이니 시키기 전에는 다시 시작하지 마세요.",
        Kind::Silent => "오래 걸리는 작업일 수도 있어요. list_tasks로 확인하고, 멈춘 게 맞으면 restart_agent로 다시 시작하세요.",
        Kind::Other => "restart_agent로 같은 카드를 이어서 다시 시작할 수 있어요. 필요하면 note에 알려줄 말을 적으세요. 같은 문제가 반복되면 사용자에게 쉬운 말로 알려주세요.",
    }
}

/// The notice a boss gets about a broken member.
pub fn notice(name: &str, card: &str, title: &str, reason: &str) -> String {
    format!("[Prism 고장 알림] {name} (카드 {card} \"{title}\"): {reason}\n{}", advice(classify(reason)))
}

/// The notice about a request that has waited on the user for a while.
pub fn permission_notice(name: &str, detail: &str) -> String {
    format!(
        "[Prism 고장 알림] {name}이(가) 사용자의 허락을 {}분째 기다리며 멈춰 있어요: {detail}\n네가 대신 허락할 수 없어요. 사용자에게 화면의 허락 요청에 답해 달라고 쉬운 말로 한 줄 알려주세요.",
        PERMISSION_WAIT_MS / 60_000
    )
}

fn card_of<'a>(a: &Agent, tasks: &'a [Task]) -> Option<&'a Task> {
    a.task_id.as_deref().and_then(|id| tasks.iter().find(|t| t.id == id))
}

/// A 팀장·작업자 whose card is still 진행 중 (and who isn't resting): the only ones that can be broken.
pub fn on_open_work<'a>(a: &Agent, tasks: &'a [Task]) -> Option<&'a Task> {
    (a.role != "lead" && a.rest_since.is_none()).then(|| card_of(a, tasks)).flatten().filter(|t| t.stage == "running")
}

/// Is `a` broken right now (marked, with its card still to be done)?
pub fn is_broken(a: &Agent, tasks: &[Task]) -> bool {
    a.stuck.is_some() && on_open_work(a, tasks).is_some()
}

/// Members that broke without any event saying so: `(id, reason)`. `alive`: has a program running.
pub fn silent_faults(agents: &[Agent], tasks: &[Task], now: u64, alive: &dyn Fn(&str) -> bool) -> Vec<(String, String)> {
    agents
        .iter()
        .filter(|a| a.stuck.is_none() && on_open_work(a, tasks).is_some())
        .filter_map(|a| {
            let quiet = now.saturating_sub(a.last_active.max(a.status_since));
            let running = alive(&a.id) || a.pty_id.is_some();
            if !running {
                // "off" was set on purpose (paused, clocked out): not a surprise
                let looks_busy = matches!(a.status.as_str(), "work" | "wait" | "block");
                return (looks_busy && quiet > GHOST_AFTER_MS).then(|| (a.id.clone(), "프로그램이 꺼졌는데 일하는 중으로 남아 있었어요".to_string()));
            }
            // a 팀장 waiting for its own members is doing what it should
            let waits_for_members = a.role == "mgr" && tasks.iter().any(|t| t.requested_by == a.id && matches!(t.stage.as_str(), "queued" | "running" | "review"));
            (a.status == "wait" && !waits_for_members && quiet > IDLE_NO_REPORT_MS)
                .then(|| (a.id.clone(), format!("보고 없이 {}분째 멈춰 있어요", IDLE_NO_REPORT_MS / 60_000)))
        })
        .collect()
}

/// Members mid-turn and silent long enough that their boss should hear (they are already marked).
pub fn long_silent(agents: &[Agent], tasks: &[Task], now: u64) -> Vec<String> {
    agents
        .iter()
        .filter(|a| a.status == "work" && a.stuck.as_deref().is_some_and(|r| classify(r) == Kind::Silent))
        .filter(|a| on_open_work(a, tasks).is_some() && now.saturating_sub(a.last_active.max(a.status_since)) > SILENT_TELL_MS)
        .map(|a| a.id.clone())
        .collect()
}

/// May this member be restarted on its card? `by_ai` counts against `MAX_AI_RESTARTS`.
pub fn restart_check(a: &Agent, tasks: &[Task], by_ai: bool, restarts: u32) -> Result<(), String> {
    if a.role == "lead" {
        return Err("총괄은 총괄 대화의 '멈추고 다시'로 다시 시작해요.".into());
    }
    let card = card_of(a, tasks).ok_or("이 팀원은 맡은 작업 카드가 없어요.")?;
    if a.rest_since.is_some() || !matches!(card.stage.as_str(), "running" | "review") {
        return Err(format!("{}는 이미 끝난 카드예요. 더 할 일이 있으면 delegate의 follow_up으로 맡기세요.", card.id));
    }
    if by_ai && restarts >= MAX_AI_RESTARTS {
        return Err(format!("{}는 이미 {MAX_AI_RESTARTS}번 다시 시작했어요. 더 하지 말고 사용자에게 무슨 문제인지 쉬운 말로 알려주세요.", card.id));
    }
    Ok(())
}

/// What a restarted member is told: why it was restarted and anything its boss added.
pub fn restart_message(reason: Option<&str>, note: Option<&str>, fresh: bool) -> String {
    let mut s = String::from("[Prism 다시 시작] ");
    s += &match reason {
        Some(r) => format!("이전 실행이 멈춰서 다시 시작했어요 (이유: {r})."),
        None => "이 카드를 다시 시작했어요.".into(),
    };
    if fresh {
        s += " 이전 대화는 이어지지 않아요. 이 폴더의 코드와 git 기록·상태를 먼저 확인하고,";
    } else {
        s += " 하던 곳을 확인하고";
    }
    s += " 남은 일을 이어서 한 뒤 report로 보고하세요.";
    if let Some(n) = note.map(str::trim).filter(|n| !n.is_empty()) {
        s += &format!("\n전달할 말: {n}");
    }
    s
}

/// The broken members, one line each — for a 총괄 that just came back and may have missed notices.
pub fn broken_lines(agents: &[Agent], tasks: &[Task]) -> Vec<String> {
    agents
        .iter()
        .filter(|a| is_broken(a, tasks))
        .map(|a| format!("- {} (카드 {}): {}", a.name, a.task_id.as_deref().unwrap_or("-"), a.stuck.as_deref().unwrap_or("")))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn member(id: &str, role: &str, status: &str, task: &str) -> Agent {
        serde_json::from_value(json!({
            "id": id, "name": id, "role": role, "kind": "claude", "model": "", "effort": "", "status": status,
            "taskId": task, "parentId": "lead", "ptyId": null, "cwd": "/tmp", "branch": null, "sessionId": "",
            "costUsd": 0.0, "startedAt": 0, "statusSince": 0, "lastNote": null, "structured": true, "activity": []
        }))
        .expect("agent json")
    }

    fn card(id: &str, stage: &str, by: &str) -> Task {
        serde_json::from_value(json!({
            "id": id, "title": "", "goal": "", "files": [], "doneWhen": [], "requestedBy": by, "assignee": null,
            "role": "worker", "model": null, "stage": stage, "summary": null, "branch": null, "base": null,
            "createdAt": 0, "updatedAt": 0
        }))
        .expect("task json")
    }

    #[test]
    fn limits_and_logins_are_not_answered_with_a_restart() {
        assert_eq!(classify("문제가 생겨 멈췄어요: Claude AI usage limit reached|1764"), Kind::Limit);
        assert_eq!(classify("You've hit your limit · resets 5pm"), Kind::Limit);
        assert_eq!(classify("API Error: 401 authentication_error · Please run /login"), Kind::Login);
        assert_eq!(classify("10분째 응답이 없어요"), Kind::Silent);
        assert_eq!(classify(KILLED_BY_USER), Kind::ByUser);
        assert_eq!(classify("W1이(가) 예상치 못하게 꺼졌어요"), Kind::Other);
        assert!(notice("W1", "T-1", "로그인 화면", "usage limit").contains("바로 쓰지 말고"), "a card about login is not a login problem");
        assert!(notice("W1", "T-1", "t", "프로그램이 끝났어요").starts_with("[Prism 고장 알림] W1 (카드 T-1"));
    }

    #[test]
    fn a_member_with_no_program_is_broken_after_a_minute() {
        let tasks = vec![card("T-1", "running", "lead")];
        let agents = vec![member("W1", "worker", "work", "T-1")];
        let dead = |_: &str| false;
        assert!(silent_faults(&agents, &tasks, GHOST_AFTER_MS, &dead).is_empty());
        assert_eq!(silent_faults(&agents, &tasks, GHOST_AFTER_MS + 1, &dead).len(), 1);
        let paused = vec![member("W1", "worker", "off", "T-1")];
        assert!(silent_faults(&paused, &tasks, u64::MAX, &dead).is_empty(), "stopped on purpose");
    }

    #[test]
    fn stopping_without_a_report_is_broken_unless_a_manager_waits_for_its_members() {
        let alive = |_: &str| true;
        let late = IDLE_NO_REPORT_MS + 1;
        let tasks = vec![card("T-1", "running", "lead"), card("T-2", "running", "A")];
        let agents = vec![member("W1", "worker", "wait", "T-1"), member("A", "mgr", "wait", "T-1")];
        let found = silent_faults(&agents, &tasks, late, &alive);
        assert_eq!(found.iter().map(|f| f.0.as_str()).collect::<Vec<_>>(), ["W1"]);
        // all of the 팀장's cards are closed: now it is the one holding things up
        let closed = vec![card("T-1", "running", "lead"), card("T-2", "done", "A")];
        assert_eq!(silent_faults(&agents, &closed, late, &alive).len(), 2);
        // reported (review) and waiting for the boss is normal
        let reviewed = vec![card("T-1", "review", "lead")];
        assert!(silent_faults(&agents, &reviewed, late, &alive).is_empty());
        // working or asking the user is not "stopped"
        let busy = vec![member("W1", "worker", "block", "T-1"), member("W2", "worker", "work", "T-1")];
        assert!(silent_faults(&busy, &tasks, late, &alive).is_empty());
    }

    #[test]
    fn a_long_silence_is_told_later_than_it_is_shown() {
        let tasks = vec![card("T-1", "running", "lead")];
        let mut a = member("W1", "worker", "work", "T-1");
        a.stuck = Some("5분째 응답이 없어요".into());
        assert!(long_silent(std::slice::from_ref(&a), &tasks, SILENT_TELL_MS).is_empty());
        assert_eq!(long_silent(std::slice::from_ref(&a), &tasks, SILENT_TELL_MS + 1), ["W1"]);
    }

    #[test]
    fn only_open_cards_restart_and_an_ai_boss_only_three_times() {
        let a = member("W1", "worker", "off", "T-1");
        assert!(restart_check(&a, &[card("T-1", "running", "lead")], true, 0).is_ok());
        assert!(restart_check(&a, &[card("T-1", "review", "lead")], true, 0).is_ok());
        assert!(restart_check(&a, &[card("T-1", "done", "lead")], false, 0).is_err());
        assert!(restart_check(&a, &[card("T-1", "running", "lead")], true, MAX_AI_RESTARTS).is_err());
        assert!(restart_check(&a, &[card("T-1", "running", "lead")], false, MAX_AI_RESTARTS).is_ok(), "the user may");
        let lead = member("lead", "lead", "off", "T-1");
        assert!(restart_check(&lead, &[card("T-1", "running", "lead")], false, 0).is_err());
    }

    #[test]
    fn the_returning_lead_hears_only_about_broken_open_cards() {
        let mut a = member("W1", "worker", "off", "T-1");
        a.stuck = Some("꺼졌어요".into());
        let mut b = member("W2", "worker", "off", "T-2");
        b.stuck = Some("꺼졌어요".into());
        let tasks = vec![card("T-1", "running", "lead"), card("T-2", "done", "lead")];
        assert_eq!(broken_lines(&[a, b], &tasks).len(), 1);
    }
}
