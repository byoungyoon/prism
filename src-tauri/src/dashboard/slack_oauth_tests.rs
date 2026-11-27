//! 가짜 슬랙 서버로 버튼 연결 흐름을 끝까지 시험한다. 키체인·브라우저·진짜 슬랙은 쓰지 않는다.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::Form;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Json, Router};
use serde_json::json;

use super::*;
use crate::dashboard::slack::token_info;

/// ATTEMPT는 하나뿐이라 흐름 시험은 차례로 돌린다
static ONE_AT_A_TIME: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

type Seen = Arc<Mutex<Vec<HashMap<String, String>>>>;

/// oauth.v2.access와 auth.test만 흉내 낸다. 받은 폼은 `Seen`에 남긴다.
async fn fake_slack() -> (String, Seen) {
    let seen: Seen = Default::default();
    let log = seen.clone();
    let app = Router::new()
        .route(
            "/api/oauth.v2.access",
            post(move |Form(form): Form<HashMap<String, String>>| {
                let log = log.clone();
                async move {
                    log.lock().unwrap().push(form.clone());
                    Json(if form.get("grant_type").map(String::as_str) == Some("refresh_token") {
                        if form["refresh_token"] == "xoxe-1-old" {
                            json!({"ok":true,"token_type":"user","access_token":"xoxe.xoxp-new","refresh_token":"xoxe-1-new","expires_in":43200})
                        } else {
                            json!({"ok":false,"error":"invalid_refresh_token"})
                        }
                    } else if form.get("code").map(String::as_str) == Some("good-code") {
                        json!({"ok":true,"team":{"id":"T1","name":"고객센터팀"},
                               "authed_user":{"id":"U1","access_token":"xoxp-fake","token_type":"user"}})
                    } else {
                        json!({"ok":false,"error":"invalid_code"})
                    })
                }
            }),
        )
        .route(
            "/api/auth.test",
            get(|headers: HeaderMap| async move {
                let ok = headers.get("authorization").and_then(|v| v.to_str().ok()) == Some("Bearer xoxp-fake");
                Json(if ok { json!({"ok":true,"team":"고객센터팀","user":"demo"}) } else { json!({"ok":false,"error":"invalid_auth"}) })
            }),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let api = format!("http://{}/api/", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await });
    (api, seen)
}

fn endpoints(api: &str) -> Endpoints {
    Endpoints { authorize: "https://fake.slack.test/oauth/v2/authorize".into(), api: api.into(), ports: vec![0], wait: Duration::from_secs(5) }
}

fn params(url: &str) -> HashMap<String, String> {
    reqwest::Url::parse(url).unwrap().query_pairs().into_owned().collect()
}

/// 가짜 브라우저: 허락 화면 주소를 받아 `reply`에 적힌 값을 돌아올 주소로 보낸다.
fn browser(reply: Vec<(&'static str, &'static str)>, forge_first: bool) -> (impl FnOnce(&str) -> Result<(), String>, Arc<Mutex<String>>) {
    let opened = Arc::new(Mutex::new(String::new()));
    let keep = opened.clone();
    let open = move |url: &str| {
        *keep.lock().unwrap() = url.to_string();
        let q = params(url);
        tokio::spawn(async move {
            let http = reqwest::Client::new();
            if forge_first {
                let r = http.get(&q["redirect_uri"]).query(&[("code", "evil"), ("state", "wrong")]).send().await.unwrap();
                assert_eq!(r.status().as_u16(), 400);
            }
            let mut query: Vec<(&str, String)> = reply.iter().map(|(k, v)| (*k, v.to_string())).collect();
            query.push(("state", q["state"].clone()));
            let r = http.get(&q["redirect_uri"]).query(&query).send().await.unwrap();
            assert!(r.text().await.unwrap().contains("Prism"));
        });
        Ok(())
    };
    (open, opened)
}

#[tokio::test]
async fn allow_gives_a_user_token_without_any_secret() {
    let _serial = ONE_AT_A_TIME.lock().await;
    let (api, seen) = fake_slack().await;
    let (open, opened) = browser(vec![("code", "good-code")], true);
    let grant = authorize(&endpoints(&api), "11.22", begin(), open).await.unwrap();
    assert_eq!(grant, Grant { access_token: "xoxp-fake".into(), refresh_token: None, expires_in: None, team: "고객센터팀".into() });
    assert_eq!(token_info(&api, &grant.access_token).await.unwrap().user, "demo");

    let asked = params(&opened.lock().unwrap());
    assert_eq!(asked["client_id"], "11.22");
    assert_eq!(asked["user_scope"], USER_SCOPES.join(","));
    assert!(!asked.contains_key("scope"), "봇 권한은 요청하지 않는다");
    assert_eq!(asked["code_challenge_method"], "S256");
    assert!(asked["redirect_uri"].starts_with("http://localhost:"));

    // 위조한 요청의 code는 쓰지 않았고, verifier는 허락 화면에 보낸 challenge와 짝이 맞는다
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(challenge(&seen[0]["code_verifier"]), asked["code_challenge"]);
    assert_eq!(seen[0]["redirect_uri"], asked["redirect_uri"]);
    assert!(!seen[0].contains_key("client_secret"));
}

#[tokio::test]
async fn deny_and_bad_code_are_explained_in_plain_korean() {
    let _serial = ONE_AT_A_TIME.lock().await;
    let (api, seen) = fake_slack().await;
    let (open, _) = browser(vec![("error", "access_denied")], false);
    let err = authorize(&endpoints(&api), "11.22", begin(), open).await.unwrap_err();
    assert!(err.contains("허용하지 않았어요"), "{err}");
    assert!(seen.lock().unwrap().is_empty());

    let (open, _) = browser(vec![("code", "stale")], false);
    let err = authorize(&endpoints(&api), "11.22", begin(), open).await.unwrap_err();
    assert!(err.contains("다시 눌러"), "{err}");
}

#[tokio::test]
async fn waiting_ends_on_cancel_timeout_or_browser_failure() {
    let _serial = ONE_AT_A_TIME.lock().await;
    let api = "http://127.0.0.1:9/api/";
    let attempt = begin();
    let err = authorize(&endpoints(api), "11.22", attempt, |url| {
        assert_eq!(pending_url().as_deref(), Some(url));
        cancel();
        Ok(())
    })
    .await
    .unwrap_err();
    assert_eq!(err, CANCELLED);
    assert_eq!(pending_url(), None);

    let short = Endpoints { wait: Duration::from_millis(300), ..endpoints(api) };
    assert_eq!(authorize(&short, "11.22", begin(), |_| Ok(())).await.unwrap_err(), TIMED_OUT);

    let err = authorize(&endpoints(api), "11.22", begin(), |_| Err("열기 실패".into())).await.unwrap_err();
    assert_eq!(err, "열기 실패");
}

#[tokio::test]
async fn busy_port_falls_back_to_the_next_one() {
    let taken = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let busy = taken.local_addr().unwrap().port();
    let (port, _listeners) = listen(&[busy, 0]).await.unwrap();
    assert_ne!(port, busy);
    assert_eq!(listen(&[busy]).await.unwrap_err(), PORT_BUSY);
}

#[tokio::test]
async fn refresh_rotates_without_secret() {
    let (api, seen) = fake_slack().await;
    let grant = refresh(&api, "11.22", "xoxe-1-old").await.unwrap();
    assert_eq!(grant.access_token, "xoxe.xoxp-new");
    assert_eq!(grant.refresh_token.as_deref(), Some("xoxe-1-new"));
    assert_eq!(grant.expires_in, Some(43200));
    assert!(!seen.lock().unwrap()[0].contains_key("client_secret"));
    assert!(refresh(&api, "11.22", "used").await.unwrap_err().contains("만료"));
}

#[test]
fn pkce_challenge_matches_slack_docs_example() {
    assert_eq!(challenge("secretpassword"), "ldMBaaWcQYtSATMV_IG8mf3wp7A6EW80arYoSW80ntU");
    assert_ne!(random(), random());
}

#[test]
fn rotating_grant_inside_authed_user_is_read() {
    let v = json!({"ok":true,"team":null,"authed_user":{"access_token":"xoxe.xoxp-1","refresh_token":"xoxe-1-a","expires_in":43200}});
    assert_eq!(parse_grant(&v).unwrap().refresh_token.as_deref(), Some("xoxe-1-a"));
    assert_eq!(parse_grant(&json!({"ok":true,"authed_user":{"id":"U1"}})), None);
}

#[test]
fn only_client_id_shape_is_accepted() {
    assert!(valid_client_id("1234567890.9876543210"));
    for bad in ["", "abc", "123", "123.", "xoxp-1-2", "0123456789abcdef0123456789abcdef"] {
        assert!(!valid_client_id(bad), "{bad}");
    }
    assert_eq!(config(Some(" 1.2 ".into())), OAuthConfig { client_id: Some("1.2".into()), custom: true });
}

#[test]
fn manifest_matches_the_code() {
    let m: Value = serde_json::from_str(include_str!("../../../docs/slack-app-manifest.json")).unwrap();
    assert_eq!(m.pointer("/oauth_config/scopes/user").unwrap(), &json!(USER_SCOPES));
    assert!(m.pointer("/oauth_config/scopes/bot").is_none());
    assert_eq!(m.pointer("/oauth_config/pkce_enabled").unwrap(), &json!(true));
    let urls: Vec<String> = PORTS.iter().map(|p| format!("http://localhost:{p}{CALLBACK_PATH}")).collect();
    assert_eq!(m.pointer("/oauth_config/redirect_urls").unwrap(), &json!(urls));
}
