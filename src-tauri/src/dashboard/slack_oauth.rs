//! [슬랙으로 연결] 버튼: Slack OAuth v2 + PKCE, 사용자 토큰(읽기 전용 권한)만 받는다.
//!
//! client secret은 쓰지 않는다. PKCE를 켠 슬랙 앱은 "공개 클라이언트"라서 code_verifier만으로 토큰을 받고
//! 갱신한다. 허락 결과는 이 컴퓨터의 `http://localhost:<포트>/slack/callback`으로 돌아온다.
//! 근거와 설정 방법: docs/slack-app.md

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use axum::Router;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::Html;
use axum::routing::get;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot};

/// 지금 쓰는 API에 필요한 것만: conversations.list(channels·groups:read), conversations.history
/// (channels·groups:history), users.info(users:read). auth.test는 권한이 필요 없다.
/// docs/slack-app-manifest.json 과 같아야 한다.
pub const USER_SCOPES: [&str; 5] = ["channels:read", "channels:history", "groups:read", "groups:history", "users:read"];
/// 슬랙 앱에 등록한 포트. 앞의 것이 사용 중이면 다음 것을 쓴다. 매니페스트의 redirect_urls와 같아야 한다.
pub const PORTS: [u16; 3] = [47823, 47824, 47825];
const CALLBACK_PATH: &str = "/slack/callback";
const AUTHORIZE: &str = "https://slack.com/oauth/v2/authorize";
const WAIT: Duration = Duration::from_secs(300);

/// Prism 공식 슬랙 앱의 Client ID를 적는 곳 (비밀값이 아니라서 저장소에 넣어도 된다)
const BUNDLED: &str = include_str!("../../slack-app.json");

pub const NOT_CONFIGURED: &str = "아직 슬랙 앱의 Client ID가 없어요. [고급]에서 넣어 주세요";
pub const CANCELLED: &str = "슬랙 연결을 그만뒀어요";
const TIMED_OUT: &str = "5분 동안 허락이 오지 않았어요. 관리자 승인을 요청했다면 승인 알림을 받은 뒤 [슬랙으로 연결]을 다시 눌러 주세요";
const PORT_BUSY: &str = "연결 결과를 받을 자리를 열지 못했어요. Prism을 껐다 켠 뒤 다시 시도해 주세요";

/// 지금 진행 중인 연결 번호. 새로 시작하거나 취소하면 올라가고, 예전 시도는 스스로 멈춘다.
static ATTEMPT: AtomicU64 = AtomicU64::new(0);
/// 브라우저를 다시 열 때 쓸 (연결 번호, 허락 화면 주소)
static PENDING: Mutex<Option<(u64, String)>> = Mutex::new(None);
/// 예전 시도가 포트를 놓기 전에 새 시도가 시작하지 않게 한다
static LISTENING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthConfig {
    pub client_id: Option<String>,
    /// 사용자가 직접 넣은 값인지
    pub custom: bool,
}

/// 슬랙이 내어 준 사용자 토큰
#[derive(Debug, Clone, PartialEq)]
pub struct Grant {
    pub access_token: String,
    /// 만료되는 토큰일 때만 있다
    pub refresh_token: Option<String>,
    pub expires_in: Option<i64>,
    pub team: String,
}

/// 시험에서 가짜 서버로 바꿔 끼울 수 있게 주소를 모아 둔다
pub struct Endpoints {
    pub authorize: String,
    pub api: String,
    pub ports: Vec<u16>,
    pub wait: Duration,
}

impl Endpoints {
    pub fn slack(api: &str) -> Self {
        Endpoints { authorize: AUTHORIZE.into(), api: api.into(), ports: PORTS.to_vec(), wait: WAIT }
    }
}

// ── 설정 ───────────────────────────────────────────────

/// "숫자.숫자" 모양만 받는다. Client Secret이나 토큰을 잘못 넣는 것을 막는다.
pub fn valid_client_id(id: &str) -> bool {
    let digits = |s: &str| !s.is_empty() && s.len() <= 32 && s.bytes().all(|b| b.is_ascii_digit());
    matches!(id.split_once('.'), Some((a, b)) if digits(a) && digits(b))
}

fn bundled_client_id() -> Option<String> {
    let v: Value = serde_json::from_str(BUNDLED).ok()?;
    v.get("clientId")?.as_str().map(String::from)
}

/// 사용자가 넣은 값 → 환경 변수 PRISM_SLACK_CLIENT_ID → slack-app.json 순서
pub fn config(user: Option<String>) -> OAuthConfig {
    let ok = |v: Option<String>| v.map(|s| s.trim().to_string()).filter(|s| valid_client_id(s));
    if let Some(id) = ok(user) {
        return OAuthConfig { client_id: Some(id), custom: true };
    }
    let client_id = ok(std::env::var("PRISM_SLACK_CLIENT_ID").ok()).or_else(|| ok(bundled_client_id()));
    OAuthConfig { client_id, custom: false }
}

// ── 시도 관리 ──────────────────────────────────────────

pub fn begin() -> u64 {
    ATTEMPT.fetch_add(1, Ordering::SeqCst) + 1
}

pub fn cancel() {
    ATTEMPT.fetch_add(1, Ordering::SeqCst);
}

pub fn is_current(attempt: u64) -> bool {
    ATTEMPT.load(Ordering::SeqCst) == attempt
}

pub fn pending_url() -> Option<String> {
    let pending = PENDING.lock().unwrap_or_else(|e| e.into_inner());
    pending.as_ref().filter(|(a, _)| is_current(*a)).map(|(_, url)| url.clone())
}

// ── PKCE ──────────────────────────────────────────────

/// 추측할 수 없는 글자 (uuid v4는 운영체제의 안전한 난수를 쓴다)
fn random() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn authorize_url(base: &str, client_id: &str, redirect: &str, state: &str, verifier: &str) -> Result<String, String> {
    let scopes = USER_SCOPES.join(",");
    let code_challenge = challenge(verifier);
    reqwest::Url::parse_with_params(
        base,
        [
            ("client_id", client_id),
            ("user_scope", scopes.as_str()),
            ("redirect_uri", redirect),
            ("state", state),
            ("code_challenge", code_challenge.as_str()),
            ("code_challenge_method", "S256"),
        ],
    )
    .map(String::from)
    .map_err(|_| "슬랙 허락 화면 주소를 만들지 못했어요".to_string())
}

// ── 결과 받기 (이 컴퓨터 안의 작은 서버) ───────────────

#[derive(Deserialize)]
struct Callback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[derive(Clone)]
struct CallbackState {
    state: String,
    tx: mpsc::Sender<Result<String, String>>,
}

fn page(title: &str, body: &str) -> Html<String> {
    Html(format!(
        "<!doctype html><html lang=\"ko\"><meta charset=\"utf-8\"><title>Prism</title>\
         <body style=\"font-family:-apple-system,sans-serif;text-align:center;padding:80px 20px\">\
         <h1>{title}</h1><p>{body}</p></body></html>"
    ))
}

/// 슬랙이 돌려보낸 에러를 쉬운 말로. 슬랙이 준 글자는 화면에 그대로 옮기지 않는다.
fn redirect_error(code: &str) -> String {
    match code {
        "access_denied" => "슬랙에서 허용하지 않았어요. 다시 하려면 [슬랙으로 연결]을 눌러 주세요".into(),
        other => oauth_error(other),
    }
}

fn oauth_error(code: &str) -> String {
    match code {
        "invalid_team_for_non_distributed_app" => {
            "이 슬랙 앱은 아직 다른 워크스페이스에서 쓸 수 없어요. 앱을 만든 사람에게 '배포(Public Distribution)'를 켜 달라고 해 주세요".into()
        }
        "unapproved_scope" | "scope_not_allowed_on_enterprise" | "access_limited" | "team_access_not_granted" => {
            "회사 슬랙에서 관리자 승인이 필요해요. 슬랙 관리자에게 Prism 앱 승인을 부탁한 뒤 다시 연결해 주세요".into()
        }
        "bad_client_secret" | "pkce_not_allowed" => "슬랙 앱 설정에서 PKCE가 꺼져 있어요. 안내 문서(docs/slack-app.md)대로 켜 주세요".into(),
        "invalid_client_id" => "Client ID가 맞지 않아요. [고급]에서 다시 확인해 주세요".into(),
        "bad_redirect_uri" => "슬랙 앱에 돌아올 주소(Redirect URL)가 등록되지 않았어요. 안내 문서대로 매니페스트를 확인해 주세요".into(),
        "invalid_scope" => "슬랙 앱에 필요한 권한이 빠져 있어요. 안내 문서의 매니페스트를 확인해 주세요".into(),
        "invalid_code" | "code_already_used" | "invalid_code_verifier" => "연결 시간이 지났어요. [슬랙으로 연결]을 다시 눌러 주세요".into(),
        "invalid_refresh_token" | "token_expired" | "token_revoked" => "슬랙 연결이 만료됐어요. 연결을 끊고 [슬랙으로 연결]을 다시 눌러 주세요".into(),
        _ => "슬랙 연결에 실패했어요. 잠시 뒤에 다시 시도해 주세요".into(),
    }
}

async fn callback(State(st): State<CallbackState>, Query(q): Query<Callback>) -> (StatusCode, Html<String>) {
    // state가 다르면 우리가 시작한 요청이 아니다. 무시하고 진짜 답을 계속 기다린다.
    if q.state.as_deref() != Some(st.state.as_str()) {
        return (StatusCode::BAD_REQUEST, page("확인할 수 없는 요청이에요", "Prism에서 [슬랙으로 연결]을 다시 눌러 주세요."));
    }
    let (result, view) = match (q.error, q.code) {
        (Some(e), _) => (Err(redirect_error(&e)), page("연결하지 않았어요", "이 창을 닫고 Prism으로 돌아가 주세요.")),
        (None, Some(code)) => (Ok(code), page("허락을 받았어요 ✅", "이 창을 닫고 Prism으로 돌아가 주세요.")),
        (None, None) => (Err(oauth_error("")), page("연결하지 못했어요", "Prism으로 돌아가 다시 시도해 주세요.")),
    };
    let _ = st.tx.try_send(result);
    (StatusCode::OK, view)
}

/// localhost는 브라우저에 따라 127.0.0.1이나 ::1로 간다. 둘 다 열고, 하나라도 남이 쓰고 있으면 다음 포트로 간다.
async fn listen(ports: &[u16]) -> Result<(u16, Vec<TcpListener>), String> {
    for &port in ports {
        let Ok(v4) = TcpListener::bind(("127.0.0.1", port)).await else { continue };
        let Ok(addr) = v4.local_addr() else { continue };
        match TcpListener::bind(("::1", addr.port())).await {
            Ok(v6) => return Ok((addr.port(), vec![v4, v6])),
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => continue,
            Err(_) => return Ok((addr.port(), vec![v4])), // IPv6가 없는 컴퓨터
        }
    }
    Err(PORT_BUSY.into())
}

// ── 토큰 받기 · 갱신 ───────────────────────────────────

/// `authed_user` 안(처음 받을 때)과 맨 위(갱신할 때) 어느 쪽에 있어도 사용자 토큰을 읽는다.
fn parse_grant(v: &Value) -> Option<Grant> {
    let node = match v.get("authed_user") {
        Some(user) if user.get("access_token").is_some() => user,
        _ => v,
    };
    let text = |key: &str| node.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from);
    Some(Grant {
        access_token: text("access_token")?,
        refresh_token: text("refresh_token"),
        expires_in: node.get("expires_in").and_then(Value::as_i64),
        team: v.pointer("/team/name").and_then(Value::as_str).unwrap_or("").to_string(),
    })
}

async fn token_request(api: &str, form: &[(&str, &str)]) -> Result<Grant, String> {
    let net = || "슬랙에 연결하지 못했어요. 인터넷 연결을 확인해 주세요".to_string();
    let resp = super::slack::client()?.post(format!("{api}oauth.v2.access")).form(form).send().await.map_err(|_| net())?;
    let v: Value = resp.json().await.map_err(|_| "슬랙 응답을 읽지 못했어요".to_string())?;
    if v.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(oauth_error(v.get("error").and_then(Value::as_str).unwrap_or("")));
    }
    parse_grant(&v).ok_or_else(|| oauth_error(""))
}

/// 만료되는 토큰을 새로 받는다 (client secret 없이)
pub async fn refresh(api: &str, client_id: &str, refresh_token: &str) -> Result<Grant, String> {
    token_request(api, &[("grant_type", "refresh_token"), ("client_id", client_id), ("refresh_token", refresh_token)]).await
}

/// 허락 화면을 열고(`open`), 돌아온 코드를 토큰으로 바꾼다.
pub async fn authorize(
    endpoints: &Endpoints,
    client_id: &str,
    attempt: u64,
    open: impl FnOnce(&str) -> Result<(), String>,
) -> Result<Grant, String> {
    let _only_one = LISTENING.lock().await;
    if !is_current(attempt) {
        return Err(CANCELLED.into());
    }
    let (port, listeners) = listen(&endpoints.ports).await?;
    let redirect = format!("http://localhost:{port}{CALLBACK_PATH}");
    let (state, verifier) = (random(), random());
    let url = authorize_url(&endpoints.authorize, client_id, &redirect, &state, &verifier)?;

    let (tx, mut rx) = mpsc::channel(1);
    let app = Router::new().route(CALLBACK_PATH, get(callback)).with_state(CallbackState { state, tx });
    let mut servers = vec![];
    for listener in listeners {
        let (stop, stopped) = oneshot::channel::<()>();
        let serve = axum::serve(listener, app.clone()).with_graceful_shutdown(async move {
            let _ = stopped.await;
        });
        servers.push((stop, tokio::spawn(async move { serve.await })));
    }

    *PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some((attempt, url.clone()));
    let code = match open(&url) {
        Err(e) => Err(e),
        Ok(()) => {
            let deadline = tokio::time::Instant::now() + endpoints.wait;
            loop {
                if !is_current(attempt) {
                    break Err(CANCELLED.to_string());
                }
                if tokio::time::Instant::now() >= deadline {
                    break Err(TIMED_OUT.to_string());
                }
                // 취소를 알아챌 수 있게 짧게 끊어서 기다린다
                if let Ok(Some(result)) = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
                    break result;
                }
            }
        }
    };
    // 브라우저에 안내 화면을 다 보낸 뒤 닫는다. 붙잡고 있는 연결이 있으면 잠깐만 기다린다.
    for (stop, mut task) in servers {
        let _ = stop.send(());
        if tokio::time::timeout(Duration::from_secs(1), &mut task).await.is_err() {
            task.abort();
        }
    }

    let code = code?;
    token_request(
        &endpoints.api,
        &[("client_id", client_id), ("code", &code), ("code_verifier", &verifier), ("redirect_uri", &redirect)],
    )
    .await
}

#[cfg(test)]
#[path = "slack_oauth_tests.rs"]
mod tests;
