//! 슬랙 칸 (읽기 전용). 쓰기 API(chat.postMessage 등)는 만들지 않는다.
//!
//! 토큰은 맥 키체인(keyring, service "prism.slack")에만 저장한다. 파일·로그·에러·반환값에 넣지 않는다.
//! 키체인에는 토큰 말고 팀/사용자 이름(JSON)도 따로 둔다. 상태 확인은 키체인만 보고 네트워크를 쓰지 않는다.
//! 버튼 연결(OAuth)은 `slack_oauth`에 있다. 슬랙이 만료되는 토큰을 주면 갱신용 값도 키체인에 두고 쓰기 직전에 새로 받는다.

use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::Duration;

use keyring::Entry;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri_plugin_opener::OpenerExt;

use super::slack_oauth::{self as oauth, Grant};

const SERVICE: &str = "prism.slack";
const TOKEN_KEY: &str = "token";
const INFO_KEY: &str = "info";
const REFRESH_KEY: &str = "refresh";
const CLIENT_ID_KEY: &str = "client_id";
const API: &str = "https://slack.com/api/";
/// 만료가 이만큼 남으면 미리 새 토큰을 받는다 (초)
const REFRESH_MARGIN: i64 = 300;
const CHANNEL_CAP: usize = 1000;
const NET_ERR: &str = "슬랙에 연결하지 못했어요. 인터넷 연결을 확인해 주세요";
const KEYCHAIN_ERR: &str = "키체인에 접근하지 못했어요. 맥 설정에서 키체인 접근을 허용해 주세요";
const NOT_CONNECTED: &str = "슬랙이 연결되어 있지 않아요. [슬랙으로 연결]을 먼저 눌러 주세요";

/// 키체인의 토큰을 바꾸는 일(저장·갱신·삭제)은 한 번에 하나만. 갱신용 값은 한 번만 쓸 수 있다.
static TOKEN_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// 만료되는 토큰을 새로 받는 데 필요한 값
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Refresh {
    token: String,
    expires_at: i64,
    client_id: String,
}

/// 사용자 id → 표시 이름. users.info 호출을 줄이려고 캐시한다.
static NAMES: Mutex<BTreeMap<String, String>> = Mutex::new(BTreeMap::new());

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TokenInfo {
    pub team: String,
    pub user: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TokenStatus {
    pub connected: bool,
    pub team: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub is_private: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub ts: String,
    pub user: String,
    pub user_name: String,
    pub text: String,
    pub time: String,
}

// ── 키체인 ─────────────────────────────────────────────

fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key).map_err(|_| KEYCHAIN_ERR.to_string())
}

fn is_no_entry(e: &keyring::Error) -> bool {
    matches!(e, keyring::Error::NoEntry)
}

fn read_token() -> Result<String, String> {
    match entry(TOKEN_KEY)?.get_password() {
        Ok(t) => Ok(t),
        Err(e) if is_no_entry(&e) => Err(NOT_CONNECTED.into()),
        Err(_) => Err(KEYCHAIN_ERR.into()),
    }
}

fn read_info() -> Option<TokenInfo> {
    let text = entry(INFO_KEY).ok()?.get_password().ok()?;
    serde_json::from_str(&text).ok()
}

fn delete_key(key: &str) -> Result<(), String> {
    match entry(key)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(e) if is_no_entry(&e) => Ok(()),
        Err(_) => Err(KEYCHAIN_ERR.into()),
    }
}

fn write_key(key: &str, value: &str) -> Result<(), String> {
    entry(key)?.set_password(value).map_err(|_| KEYCHAIN_ERR.to_string())
}

/// 갱신용 값을 먼저 저장한다. 슬랙은 새 값을 주면서 예전 값을 못 쓰게 하므로 잃어버리면 다시 연결해야 한다.
fn store_grant(client_id: &str, grant: &Grant) -> Result<(), String> {
    match (&grant.refresh_token, grant.expires_in) {
        (Some(token), Some(secs)) => {
            let r = Refresh { token: token.clone(), expires_at: now() + secs, client_id: client_id.to_string() };
            let text = serde_json::to_string(&r).map_err(|_| "연결 정보를 저장하지 못했어요".to_string())?;
            write_key(REFRESH_KEY, &text)?;
        }
        _ => delete_key(REFRESH_KEY)?,
    }
    write_key(TOKEN_KEY, &grant.access_token)
}

fn store_info(info: &TokenInfo) -> Result<(), String> {
    let text = serde_json::to_string(info).map_err(|_| "연결 정보를 저장하지 못했어요".to_string())?;
    write_key(INFO_KEY, &text)?;
    NAMES.lock().unwrap_or_else(|e| e.into_inner()).clear();
    Ok(())
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

/// API에 쓸 토큰. 곧 만료되면 새로 받아 저장한다.
async fn fresh_token() -> Result<String, String> {
    let _guard = TOKEN_LOCK.lock().await;
    let token = read_token()?;
    let refresh = match entry(REFRESH_KEY)?.get_password() {
        Ok(text) => serde_json::from_str::<Refresh>(&text).ok(),
        Err(e) if is_no_entry(&e) => None,
        Err(_) => return Err(KEYCHAIN_ERR.into()),
    };
    let Some(r) = refresh else { return Ok(token) };
    if r.expires_at - now() > REFRESH_MARGIN {
        return Ok(token);
    }
    match oauth::refresh(API, &r.client_id, &r.token).await {
        Ok(grant) => {
            store_grant(&r.client_id, &grant)?;
            Ok(grant.access_token)
        }
        // 아직 만료 전이면 잠깐의 실패는 넘기고 지금 토큰을 쓴다
        Err(_) if r.expires_at > now() => Ok(token),
        Err(e) => Err(e),
    }
}

// ── 슬랙 API (GET만) ──────────────────────────────────

/// 슬랙 에러 코드를 쉬운 한국어로 바꾼다.
pub fn slack_error(code: &str) -> String {
    match code {
        "invalid_auth" | "not_authed" | "token_revoked" | "token_expired" | "account_inactive" => "토큰이 맞지 않아요".into(),
        "missing_scope" => "슬랙 앱에 필요한 권한(scope)이 빠져 있어요. 앱 권한을 확인해 주세요".into(),
        "not_in_channel" => "이 채널을 볼 권한이 없어요 — 봇을 채널에 초대해 주세요".into(),
        "channel_not_found" => "채널을 찾을 수 없어요".into(),
        "ratelimited" => "슬랙 요청이 많아요. 잠시 뒤에 다시 시도해 주세요".into(),
        _ => "슬랙에서 답을 받지 못했어요".into(),
    }
}

pub(super) fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| NET_ERR.to_string())
}

/// 슬랙 메서드를 GET으로 부른다. 토큰은 Authorization 헤더로만 보낸다.
async fn slack_get(token: &str, method: &str, query: &[(&str, String)]) -> Result<Value, String> {
    slack_get_at(API, token, method, query).await
}

async fn slack_get_at(api: &str, token: &str, method: &str, query: &[(&str, String)]) -> Result<Value, String> {
    let resp = client()?
        .get(format!("{api}{method}"))
        .bearer_auth(token)
        .query(query)
        .send()
        .await
        .map_err(|_| NET_ERR.to_string())?;
    if resp.status().as_u16() == 429 {
        return Err(slack_error("ratelimited"));
    }
    let v: Value = resp.json().await.map_err(|_| "슬랙 응답을 읽지 못했어요".to_string())?;
    if v.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(v)
    } else {
        Err(slack_error(v.get("error").and_then(Value::as_str).unwrap_or("")))
    }
}

fn display_name(user: &Value) -> Option<String> {
    let profile = user.get("profile");
    let pick = |v: Option<&Value>| v.and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(String::from);
    pick(profile.and_then(|p| p.get("display_name")))
        .or_else(|| pick(profile.and_then(|p| p.get("real_name"))))
        .or_else(|| pick(user.get("real_name")))
        .or_else(|| pick(user.get("name")))
}

/// 사용자 이름. 못 찾으면 id를 그대로 쓴다.
async fn user_name(token: &str, id: &str) -> String {
    if let Some(name) = NAMES.lock().unwrap_or_else(|e| e.into_inner()).get(id) {
        return name.clone();
    }
    let name = match slack_get(token, "users.info", &[("user", id.to_string())]).await {
        Ok(v) => display_name(&v["user"]).unwrap_or_else(|| id.to_string()),
        Err(_) => id.to_string(),
    };
    NAMES.lock().unwrap_or_else(|e| e.into_inner()).insert(id.to_string(), name.clone());
    name
}

/// 슬랙 ts("1700000000.123456")를 ISO 시각으로 바꾼다.
pub fn ts_to_iso(ts: &str) -> String {
    let (secs, frac) = ts.split_once('.').unwrap_or((ts, ""));
    let Ok(secs) = secs.parse::<i64>() else { return String::new() };
    let mut digits: String = frac.chars().take(9).collect();
    while digits.len() < 9 {
        digits.push('0');
    }
    let nanos: u32 = digits.parse().unwrap_or(0);
    chrono::DateTime::from_timestamp(secs, nanos).map(|d| d.to_rfc3339()).unwrap_or_default()
}

fn valid_channel_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_alphanumeric())
}

// ── 명령 ───────────────────────────────────────────────

/// 토큰을 auth.test로 확인한 뒤 키체인에 저장한다.
#[tauri::command]
pub async fn slack_token_set(token: String) -> Result<TokenInfo, String> {
    let token = token.trim().to_string();
    if !token.starts_with("xox") {
        return Err("토큰이 맞지 않아요".into());
    }
    let info = token_info(API, &token).await?;
    // 기다리는 중인 버튼 연결이 있으면 그만둔다 (나중에 덮어쓰지 않게)
    oauth::cancel();
    let _guard = TOKEN_LOCK.lock().await;
    store_grant("", &Grant { access_token: token, refresh_token: None, expires_in: None, team: String::new() })?;
    store_info(&info)?;
    Ok(info)
}

/// 토큰이 살아 있는지 확인하고 팀·사용자 이름을 읽는다.
pub(super) async fn token_info(api: &str, token: &str) -> Result<TokenInfo, String> {
    let v = slack_get_at(api, token, "auth.test", &[]).await?;
    Ok(TokenInfo {
        team: v.get("team").and_then(Value::as_str).unwrap_or("").to_string(),
        user: v.get("user").and_then(Value::as_str).unwrap_or("").to_string(),
    })
}

// ── 버튼 한 번으로 연결 ───────────────────────────────

/// Client ID는 비밀값이 아니지만, 토큰과 같은 곳에 두면 데이터 폴더를 건드리지 않아도 된다.
fn client_id_override() -> Option<String> {
    entry(CLIENT_ID_KEY).ok()?.get_password().ok()
}

#[tauri::command]
pub fn slack_oauth_config() -> oauth::OAuthConfig {
    oauth::config(client_id_override())
}

/// 직접 만든 슬랙 앱의 Client ID를 넣는다. 빈 값이면 Prism에 들어 있는 값으로 되돌린다.
#[tauri::command]
pub fn slack_client_id_set(client_id: String) -> Result<oauth::OAuthConfig, String> {
    let id = client_id.trim();
    if id.is_empty() {
        delete_key(CLIENT_ID_KEY)?;
    } else if oauth::valid_client_id(id) {
        write_key(CLIENT_ID_KEY, id)?;
    } else {
        return Err("Client ID는 숫자.숫자 모양이에요 (예: 1234567890.1234567890). Client Secret이 아닌지 확인해 주세요".into());
    }
    Ok(slack_oauth_config())
}

/// 브라우저에서 슬랙 허락 화면을 열고, 허용하면 토큰을 키체인에 저장한다. 끝날 때까지 기다린다.
#[tauri::command]
pub async fn slack_oauth_connect(app: tauri::AppHandle) -> Result<TokenInfo, String> {
    let client_id = slack_oauth_config().client_id.ok_or_else(|| oauth::NOT_CONFIGURED.to_string())?;
    let attempt = oauth::begin();
    let endpoints = oauth::Endpoints::slack(API);
    let grant = oauth::authorize(&endpoints, &client_id, attempt, |url| {
        app.opener().open_url(url, None::<&str>).map_err(|_| "브라우저를 열지 못했어요".to_string())
    })
    .await?;
    // 이름을 못 읽어도 연결은 살린다 (코드는 한 번만 쓸 수 있다)
    let info = token_info(API, &grant.access_token)
        .await
        .unwrap_or_else(|_| TokenInfo { team: grant.team.clone(), user: String::new() });
    let _guard = TOKEN_LOCK.lock().await;
    if !oauth::is_current(attempt) {
        return Err(oauth::CANCELLED.into());
    }
    store_grant(&client_id, &grant)?;
    store_info(&info)?;
    Ok(info)
}

/// 브라우저 창을 닫았을 때 허락 화면을 다시 연다.
#[tauri::command]
pub fn slack_oauth_reopen(app: tauri::AppHandle) -> Result<(), String> {
    let url = oauth::pending_url().ok_or("기다리는 연결이 없어요. [슬랙으로 연결]을 다시 눌러 주세요")?;
    app.opener().open_url(url, None::<&str>).map_err(|_| "브라우저를 열지 못했어요".to_string())
}

#[tauri::command]
pub fn slack_oauth_cancel() {
    oauth::cancel();
}

#[tauri::command]
pub fn slack_token_status() -> TokenStatus {
    let connected = matches!(entry(TOKEN_KEY).map(|e| e.get_password()), Ok(Ok(_)));
    let team = if connected { read_info().map(|i| i.team) } else { None };
    TokenStatus { connected, team }
}

#[tauri::command]
pub async fn slack_token_clear() -> Result<(), String> {
    oauth::cancel();
    let _guard = TOKEN_LOCK.lock().await;
    delete_key(REFRESH_KEY)?;
    delete_key(TOKEN_KEY)?;
    delete_key(INFO_KEY)?;
    NAMES.lock().unwrap_or_else(|e| e.into_inner()).clear();
    Ok(())
}

/// 공개·비공개 채널 목록(보관된 채널 제외), 최대 1000개.
#[tauri::command]
pub async fn slack_channels() -> Result<Vec<Channel>, String> {
    let token = fresh_token().await?;
    let mut out: Vec<Channel> = vec![];
    let mut cursor = String::new();
    loop {
        let mut query = vec![
            ("types", "public_channel,private_channel".to_string()),
            ("exclude_archived", "true".to_string()),
            ("limit", "200".to_string()),
        ];
        if !cursor.is_empty() {
            query.push(("cursor", cursor.clone()));
        }
        let v = slack_get(&token, "conversations.list", &query).await?;
        for c in v.get("channels").and_then(Value::as_array).into_iter().flatten() {
            let Some(id) = c.get("id").and_then(Value::as_str) else { continue };
            out.push(Channel {
                id: id.to_string(),
                name: c.get("name").and_then(Value::as_str).unwrap_or("").to_string(),
                is_private: c.get("is_private").and_then(Value::as_bool).unwrap_or(false),
            });
        }
        cursor = v
            .pointer("/response_metadata/next_cursor")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if cursor.is_empty() || out.len() >= CHANNEL_CAP {
            break;
        }
    }
    out.truncate(CHANNEL_CAP);
    Ok(out)
}

/// 채널의 최근 메시지(슬랙 순서: 최신 먼저). limit은 1~200으로 맞춘다.
#[tauri::command]
pub async fn slack_history(channel_id: String, limit: u32) -> Result<Vec<Message>, String> {
    if !valid_channel_id(&channel_id) {
        return Err("채널 번호가 맞지 않아요".into());
    }
    let token = fresh_token().await?;
    let limit = limit.clamp(1, 200);
    let v = slack_get(&token, "conversations.history", &[("channel", channel_id), ("limit", limit.to_string())]).await?;
    let mut out = vec![];
    for m in v.get("messages").and_then(Value::as_array).into_iter().flatten() {
        let ts = m.get("ts").and_then(Value::as_str).unwrap_or("").to_string();
        let (user, user_name) = match m.get("user").and_then(Value::as_str) {
            Some(u) => (u.to_string(), user_name(&token, u).await),
            None => {
                let bot_id = m.get("bot_id").and_then(Value::as_str).unwrap_or("").to_string();
                let name = m
                    .pointer("/bot_profile/name")
                    .or_else(|| m.get("username"))
                    .and_then(Value::as_str)
                    .unwrap_or("봇")
                    .to_string();
                (bot_id, name)
            }
        };
        out.push(Message {
            time: ts_to_iso(&ts),
            text: m.get("text").and_then(Value::as_str).unwrap_or("").to_string(),
            ts,
            user,
            user_name,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn slack_errors_are_plain_korean() {
        assert_eq!(slack_error("invalid_auth"), "토큰이 맞지 않아요");
        assert!(slack_error("not_in_channel").contains("봇을 채널에 초대"));
        assert!(slack_error("missing_scope").contains("권한"));
        assert_eq!(slack_error("who_knows"), "슬랙에서 답을 받지 못했어요");
    }

    #[test]
    fn ts_becomes_iso_time() {
        assert!(ts_to_iso("1700000000.123456").starts_with("2023-11-14T22:13:20"));
        assert!(ts_to_iso("1700000000").starts_with("2023-11-14T22:13:20"));
        assert_eq!(ts_to_iso("abc"), "");
    }

    #[test]
    fn display_name_prefers_profile_display_name() {
        let u = json!({"name":"hong","real_name":"홍길동","profile":{"display_name":"길동","real_name":"홍길동"}});
        assert_eq!(display_name(&u).unwrap(), "길동");
        let bare = json!({"name":"hong","profile":{"display_name":""}});
        assert_eq!(display_name(&bare).unwrap(), "hong");
    }

    #[test]
    fn channel_ids_are_alnum_only() {
        assert!(valid_channel_id("C012AB3CD"));
        assert!(!valid_channel_id("C1?limit=9"));
        assert!(!valid_channel_id(""));
    }
}
