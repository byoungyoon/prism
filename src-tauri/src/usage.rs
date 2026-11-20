//! Remaining subscription usage, fetched the way Orca does it:
//!   Claude      GET api.anthropic.com/api/oauth/usage   (OAuth token from Keychain / .credentials.json)
//!   Codex       GET chatgpt.com/backend-api/wham/usage  (token from $CODEX_HOME/auth.json)
//! Tokens are only read locally and sent to the provider's own endpoint; never refreshed or stored.

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};


#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    /// "five_hour" | "seven_day" | other bucket id
    pub id: String,
    pub label: String,
    /// 0–100
    pub used_percent: f64,
    /// epoch seconds or ISO string
    pub resets_at: Option<Value>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// "claude" | "codex" | "antigravity"
    pub provider: String,
    pub windows: Vec<UsageWindow>,
    pub plan: Option<String>,
    /// why there are no windows (not signed in, API billing, …)
    pub note: Option<String>,
    pub updated_at: u64,
}

fn now_ms() -> u64 {
    crate::projects::now_ms()
}

fn win(id: &str, label: &str, used: f64, resets_at: Option<Value>) -> UsageWindow {
    UsageWindow { id: id.into(), label: label.into(), used_percent: used.clamp(0.0, 100.0), resets_at }
}

fn note(provider: &str, msg: &str) -> Usage {
    Usage { provider: provider.into(), windows: vec![], plan: None, note: Some(msg.into()), updated_at: now_ms() }
}

fn http() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder().timeout(Duration::from_secs(10)).build().unwrap_or_default()
}

// ── Claude ────────────────────────────────────────────

/// Keychain service for a config dir: "Claude Code-credentials" or "…-<sha256(dir)[..8]>".
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn claude_service(config_dir: Option<&str>) -> String {
    match config_dir {
        None => "Claude Code-credentials".into(),
        Some(dir) => {
            let hash = Sha256::digest(dir.as_bytes());
            format!("Claude Code-credentials-{}", hex8(&hash))
        }
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn hex8(bytes: &[u8]) -> String {
    bytes.iter().take(4).map(|b| format!("{b:02x}")).collect()
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn keychain_account() -> String {
    let user = std::env::var("USER").or_else(|_| std::env::var("USERNAME")).unwrap_or_default();
    if !user.is_empty() && user.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) { user } else { "claude-code-user".into() }
}

fn claude_credentials(config_dir: Option<&str>) -> Option<Value> {
    #[cfg(target_os = "macos")]
    {
        let mut services = vec![claude_service(config_dir)];
        if let Some(real) = config_dir.and_then(|d| std::fs::canonicalize(d).ok()).map(|p| p.to_string_lossy().into_owned()) {
            if Some(real.as_str()) != config_dir {
                services.push(claude_service(Some(&real)));
            }
        }
        for service in services {
            let out = crate::sys::command("/usr/bin/security").args(["find-generic-password", "-s", &service, "-a", &keychain_account(), "-w"]).output();
            if let Ok(out) = out {
                if out.status.success() {
                    if let Ok(v) = serde_json::from_slice::<Value>(&out.stdout) {
                        return Some(v);
                    }
                }
            }
        }
    }
    let dir = config_dir.map(PathBuf::from).or_else(|| std::env::home_dir().map(|h| h.join(".claude")))?;
    serde_json::from_str(&std::fs::read_to_string(dir.join(".credentials.json")).ok()?).ok()
}

pub fn claude(config_dir: Option<&str>) -> Usage {
    // the inherited "default" account may itself point at a custom CLAUDE_CONFIG_DIR
    let env_dir = std::env::var("CLAUDE_CONFIG_DIR").ok();
    let dir = config_dir.map(String::from).or(env_dir);
    let Some(creds) = claude_credentials(dir.as_deref()) else {
        return note("claude", "구독 로그인 정보가 없어요");
    };
    let Some(token) = creds.pointer("/claudeAiOauth/accessToken").and_then(Value::as_str) else {
        return note("claude", "구독 로그인 정보가 없어요");
    };
    let plan = creds.pointer("/claudeAiOauth/subscriptionType").and_then(Value::as_str).map(String::from);
    let res = http()
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", format!("Bearer {token}"))
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("User-Agent", "claude-code/2.1.0")
        .send();
    let res = match res {
        Ok(r) if r.status().as_u16() == 401 => return note("claude", "Claude를 한 번 실행하면 갱신돼요"),
        Ok(r) if !r.status().is_success() => return note("claude", &format!("사용량 조회 실패 ({})", r.status().as_u16())),
        Ok(r) => r,
        Err(_) => return note("claude", "사용량 서버에 연결하지 못했어요"),
    };
    let Ok(v) = res.json::<Value>() else { return note("claude", "사용량 응답을 읽지 못했어요") };
    let window = |key: &str| {
        let w = v.get(key)?;
        let used = w.get("utilization").or_else(|| w.get("used_percentage")).and_then(Value::as_f64)?;
        Some((used, w.get("resets_at").cloned()))
    };
    let mut windows = vec![];
    if let Some((u, r)) = window("five_hour") {
        windows.push(win("five_hour", "5시간", u, r));
    }
    if let Some((u, r)) = window("seven_day") {
        windows.push(win("seven_day", "주간", u, r));
    }
    for key in ["seven_day_opus", "seven_day_fable", "fable_seven_day", "seven_day_sonnet"] {
        if let Some((u, r)) = window(key) {
            let model = ["opus", "fable", "sonnet"].into_iter().find(|m| key.contains(m)).unwrap_or("");
            windows.push(win(key, &format!("주간 · {}", model[..1].to_uppercase() + &model[1..]), u, r));
        }
    }
    Usage { provider: "claude".into(), windows, plan, note: None, updated_at: now_ms() }
}

// ── Codex ─────────────────────────────────────────────

pub fn codex(home: Option<&str>) -> Usage {
    let file = crate::launch::codex_account_home(home).join("auth.json");
    let Some(auth) = std::fs::read_to_string(file).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else {
        return note("codex", "ChatGPT 로그인 정보가 없어요");
    };
    let Some(token) = auth.pointer("/tokens/access_token").and_then(Value::as_str) else {
        return note("codex", "ChatGPT 구독 로그인이 아니에요");
    };
    let mut req = http()
        .get("https://chatgpt.com/backend-api/wham/usage")
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "codex-cli")
        .header("OpenAI-Beta", "codex-1")
        .header("originator", "Codex Desktop");
    if let Some(acct) = auth.pointer("/tokens/account_id").and_then(Value::as_str) {
        req = req.header("ChatGPT-Account-Id", acct);
    }
    let v = match req.send() {
        Ok(r) if r.status().is_success() => match r.json::<Value>() {
            Ok(v) => v,
            Err(_) => return note("codex", "사용량 응답을 읽지 못했어요"),
        },
        Ok(r) if r.status().as_u16() == 401 => return note("codex", "Codex를 한 번 실행하면 갱신돼요"),
        Ok(r) => return note("codex", &format!("사용량 조회 실패 ({})", r.status().as_u16())),
        Err(_) => return note("codex", "사용량 서버에 연결하지 못했어요"),
    };
    let plan = v.get("plan_type").and_then(Value::as_str).map(String::from);
    let mut windows = vec![];
    for (i, key) in ["primary_window", "secondary_window"].into_iter().enumerate() {
        let Some(w) = v.pointer(&format!("/rate_limit/{key}")) else { continue };
        let Some(used) = w.get("used_percent").and_then(Value::as_f64) else { continue };
        let mins = w.get("limit_window_seconds").and_then(Value::as_f64).map(|s| (s / 60.0).ceil() as i64);
        let (id, label) = match mins {
            Some(m) if (m - 300).abs() <= 1 => ("five_hour", "5시간"),
            Some(m) if (m - 10080).abs() <= 1 => ("seven_day", "주간"),
            Some(m) if m >= 40000 => ("month", "월간"),
            Some(m) if m >= 1440 => ("day", "일간"),
            _ if i == 0 => ("five_hour", "5시간"),
            _ => ("seven_day", "주간"),
        };
        windows.push(win(id, label, used, w.get("reset_at").cloned()));
    }
    Usage { provider: "codex".into(), windows, plan, note: None, updated_at: now_ms() }
}


// ── Antigravity (Google) ──────────────────────────────

/// `agy -p /usage --output-format json` (no model turn on agy ≥ 1.1.11).
pub fn antigravity() -> Usage {
    if crate::sys::which("agy").is_none() {
        return note("antigravity", "Antigravity가 설치돼 있지 않아요");
    }
    let mut cmd = crate::sys::command("agy");
    cmd.args(["-p", "/usage", "--output-format", "json", "--print-timeout", "20s"]).env("AGY_CLI_DISABLE_AUTO_UPDATE", "true");
    let Ok(out) = cmd.output() else { return note("antigravity", "Antigravity를 실행하지 못했어요") };
    let text = String::from_utf8_lossy(&out.stdout);
    let Some(v) = text.lines().filter(|l| l.trim_start().starts_with('{')).filter_map(|l| serde_json::from_str::<Value>(l).ok()).find(|v| v.get("status").is_some()) else {
        return note("antigravity", "Google 계정으로 로그인해 주세요");
    };
    if v.get("status").and_then(Value::as_str) != Some("SUCCESS") {
        return note("antigravity", "Google 계정으로 로그인해 주세요");
    }
    // the most constrained enabled bucket per window
    let mut best: std::collections::HashMap<&str, (f64, Option<Value>)> = Default::default();
    for g in v.pointer("/command/data/groups").and_then(Value::as_array).into_iter().flatten() {
        for b in g.get("buckets").and_then(Value::as_array).into_iter().flatten() {
            if b.get("disabled").and_then(Value::as_bool) == Some(true) {
                continue;
            }
            let Some(rem) = b.get("remaining_fraction").and_then(Value::as_f64) else { continue };
            let used = ((1.0 - rem) * 100.0).round();
            let key = match b.get("window").and_then(Value::as_str) {
                Some("5h") => "five_hour",
                Some("weekly") => "seven_day",
                _ => continue,
            };
            if best.get(key).is_none_or(|(u, _)| used > *u) {
                best.insert(key, (used, b.get("reset_time").cloned()));
            }
        }
    }
    let mut windows = vec![];
    for (key, label) in [("five_hour", "5시간"), ("seven_day", "주간")] {
        if let Some((u, r)) = best.remove(key) {
            windows.push(win(key, label, u, r));
        }
    }
    Usage { provider: "antigravity".into(), windows, plan: None, note: None, updated_at: now_ms() }
}

#[cfg(test)]
mod tests {
    /// live check against the real endpoints: `cargo test usage_live -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn usage_live() {
        for u in [super::claude(None), super::codex(None)] {
            let w: Vec<String> = u.windows.iter().map(|w| format!("{} {:.0}% used (reset {:?})", w.label, w.used_percent, w.resets_at)).collect();
            println!("{:<12} plan={:?} note={:?} {:?}", u.provider, u.plan, u.note, w);
        }
    }
}
