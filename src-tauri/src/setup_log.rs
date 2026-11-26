//! `setup.log` in the app data folder: what a failed sign-in or install really printed, for
//! whoever has to fix it. The screen shows plain words (src/lib/setupFailure.ts).

use std::io::Write;

use tauri::{AppHandle, Manager};

use crate::pty::{ExitHook, PtyManager, SpawnSpec};

/// The log starts over once it grows past this.
const LIMIT: u64 = 256 * 1024;

/// Runs a sign-in or install program, noting in the log when it can't start or ends badly.
pub fn spawn(app: &AppHandle, pty: &PtyManager, spec: SpawnSpec, what: String) -> Result<u32, String> {
    let (log_app, log_what) = (app.clone(), what.clone());
    let hook: ExitHook = Box::new(move |code, tail| {
        if code != Some(0) {
            write(&log_app, &log_what, &format!("exit {code:?}\n{tail}"));
        }
    });
    pty.spawn(spec, Some(hook)).inspect_err(|e| write(app, &what, &format!("could not start: {e}")))
}

fn write(app: &AppHandle, what: &str, text: &str) {
    let line = format!("--- {} {what}\n{}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), redact(text));
    #[cfg(debug_assertions)]
    eprintln!("[prism] {line}");
    let Ok(dir) = app.path().app_data_dir() else { return };
    let _ = std::fs::create_dir_all(&dir);
    let file = dir.join("setup.log");
    let fresh = std::fs::metadata(&file).is_ok_and(|m| m.len() > LIMIT);
    let opened = std::fs::OpenOptions::new().create(true).write(true).append(!fresh).truncate(fresh).open(file);
    if let Ok(mut f) = opened {
        let _ = f.write_all(line.as_bytes());
    }
}

/// Hides what must not sit in a file: everything after `?` or `#` in addresses (sign-in codes),
/// token-looking words and e-mail addresses.
fn redact(text: &str) -> String {
    let word = |c: char| c.is_ascii_alphanumeric() || "_-.~+=@%".contains(c);
    let secret = |w: &str| {
        w.len() >= 40
            || ["sk-", "eyJ", "ya29."].iter().any(|p| w.starts_with(p))
            || ["code=", "token=", "key="].iter().any(|p| w.contains(p))
            || w.split_once('@').is_some_and(|(a, b)| !a.is_empty() && b.contains('.') && !b.starts_with(|c: char| c.is_ascii_digit()))
    };
    let mut out = String::new();
    let mut rest = text;
    while !rest.is_empty() {
        if rest.starts_with("http://") || rest.starts_with("https://") {
            let end = rest.find(|c: char| c.is_whitespace() || c.is_control() || "\"'<>`".contains(c)).unwrap_or(rest.len());
            let url = &rest[..end];
            match url.find(['?', '#']) {
                Some(at) => {
                    out.push_str(&url[..at]);
                    out.push_str("?[가림]");
                }
                None => out.push_str(url),
            }
            rest = &rest[end..];
            continue;
        }
        let len = rest.find(|c| !word(c)).unwrap_or(rest.len());
        if len == 0 {
            let c = rest.chars().next().unwrap();
            out.push(c);
            rest = &rest[c.len_utf8()..];
            continue;
        }
        // a scheme in the middle of a word ("url=https://…") is handled on its own
        let len = rest[..len].find("http").filter(|&i| i > 0).unwrap_or(len);
        let w = &rest[..len];
        out.push_str(if secret(w) { "[가림]" } else { w });
        rest = &rest[len..];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::redact;

    #[test]
    fn hides_codes_tokens_and_addresses_but_keeps_the_error() {
        let out = redact("open https://claude.ai/oauth/authorize?code=abc&state=xyz now");
        assert_eq!(out, "open https://claude.ai/oauth/authorize?[가림] now");
        assert_eq!(redact("key sk-ant-123 for me@example.com"), "key [가림] for [가림]");
        assert_eq!(redact(&"a".repeat(48)), "[가림]");
        let error = r"Access is denied. (os error 5) C:\Users\kim\AppData\Roaming\npm @openai/codex@latest";
        assert_eq!(redact(error), error);
    }
}
