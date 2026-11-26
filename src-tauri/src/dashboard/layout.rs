//! 배치 저장: 앱 데이터 폴더의 dashboard.json.
//!
//! 내용은 프론트가 정하는 불투명 JSON이다. 설계도 형식(`{version, widgets:[…]}`)을 그대로 저장하며,
//! `version`이 없으면 1로 채운다. 슬랙 토큰처럼 보이는 값이나 토큰 키가 있으면 저장을 거부한다.

use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::atomic_write;

const FILE: &str = "dashboard.json";
/// 설계도 형식 버전. 없으면 1로 채운다.
pub const VERSION: u64 = 1;

fn file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(FILE))
}

fn empty() -> Value {
    json!({ "widgets": [] })
}

/// 슬랙 토큰 키·값을 찾는다. 토큰은 키체인에만 있어야 하므로 파일에 들어오면 안 된다.
pub fn contains_secret(v: &Value) -> bool {
    match v {
        Value::String(s) => looks_like_slack_token(s),
        Value::Array(items) => items.iter().any(contains_secret),
        Value::Object(map) => map.iter().any(|(k, v)| is_secret_key(k) || contains_secret(v)),
        _ => false,
    }
}

fn looks_like_slack_token(s: &str) -> bool {
    s.to_ascii_lowercase().contains("xox")
}

fn is_secret_key(k: &str) -> bool {
    let k = k.to_ascii_lowercase();
    ["token", "password", "secret", "xoxb", "xoxp"].iter().any(|w| k.contains(w))
}

/// 저장 전 검사와 version 채우기. 토큰이 있으면 거부한다.
pub fn prepare(mut v: Value) -> Result<Value, String> {
    if !v.is_object() {
        return Err("대시보드 형식이 맞지 않아요".into());
    }
    if contains_secret(&v) {
        return Err("대시보드에 슬랙 토큰이 들어 있어서 저장을 거부했어요. 토큰은 키체인에만 저장돼요".into());
    }
    if v.get("version").is_none() {
        v["version"] = json!(VERSION);
    }
    Ok(v)
}

/// 파일을 읽는다. 없거나 깨졌으면 빈 배치.
pub fn load_from(path: &std::path::Path) -> Value {
    let loaded = std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
    match loaded {
        Some(mut v) if v.is_object() => {
            if v.get("version").is_none() {
                v["version"] = json!(VERSION);
            }
            v
        }
        _ => empty(),
    }
}

pub fn save_to(path: &std::path::Path, v: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(v).map_err(|_| "대시보드를 저장하지 못했어요".to_string())?;
    atomic_write(path, &bytes)
}

#[tauri::command]
pub fn dashboard_load(app: AppHandle) -> Result<Value, String> {
    Ok(file(&app).map(|p| load_from(&p)).unwrap_or_else(empty))
}

#[tauri::command]
pub fn dashboard_save(app: AppHandle, dashboard: Value) -> Result<(), String> {
    let v = prepare(dashboard)?;
    let path = file(&app).ok_or_else(|| "저장 폴더를 찾지 못했어요".to_string())?;
    save_to(&path, &v)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("prism-dash-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn refuses_layouts_containing_slack_tokens() {
        let by_value = json!({"widgets":[{"id":"s1","kind":"slack","config":{"slack":{"channelName":"xoxb-1234-abcd"}}}]});
        let by_key = json!({"widgets":[{"id":"s1","token":"anything"}]});
        let by_bot_key = json!({"xoxp": "x"});
        assert!(contains_secret(&by_value));
        assert!(contains_secret(&by_key));
        assert!(contains_secret(&by_bot_key));
        assert!(prepare(by_value).is_err());
        assert!(prepare(by_key).is_err());
    }

    #[test]
    fn normal_layouts_pass_and_get_version() {
        let v = prepare(json!({"widgets":[{"id":"w1","kind":"web","title":"뉴스","config":{"web":{"url":"https://example.com"}}}]})).unwrap();
        assert_eq!(v["version"], json!(1));
        assert_eq!(v["widgets"][0]["kind"], json!("web"));
        // an existing version is kept as-is
        let kept = prepare(json!({"version": 2, "widgets": []})).unwrap();
        assert_eq!(kept["version"], json!(2));
    }

    #[test]
    fn rejects_non_object_layouts() {
        assert!(prepare(json!([1, 2])).is_err());
    }

    #[test]
    fn save_then_load_round_trips_without_leftover_tmp() {
        let dir = temp_dir();
        let path = dir.join(FILE);
        let v = prepare(json!({"widgets":[{"id":"a","kind":"sheet","x":0,"y":0,"w":6,"h":4}]})).unwrap();
        save_to(&path, &v).unwrap();
        assert_eq!(load_from(&path), v);
        assert!(!dir.join("dashboard.json.tmp").exists(), "temp file must be renamed away");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_or_broken_file_loads_as_empty() {
        let dir = temp_dir();
        assert_eq!(load_from(&dir.join(FILE)), json!({"widgets": []}));
        std::fs::write(dir.join(FILE), "{not json").unwrap();
        assert_eq!(load_from(&dir.join(FILE)), json!({"widgets": []}));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn file_loaded_without_version_gets_version_one() {
        let dir = temp_dir();
        std::fs::write(dir.join(FILE), r#"{"widgets":[]}"#).unwrap();
        assert_eq!(load_from(&dir.join(FILE))["version"], json!(1));
        std::fs::remove_dir_all(&dir).ok();
    }
}
