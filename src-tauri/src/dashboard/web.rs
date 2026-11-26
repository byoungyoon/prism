//! 웹사이트 칸: 메인 창 안에 올리는 자식 웹뷰(iframe 아님).
//!
//! 로그인 유지를 위해 시크릿(incognito) 모드를 끄고 기본 데이터 저장소를 쓴다(쿠키가 앱 재시작 뒤에도 남는다).
//! 좌표는 메인 창 기준 논리 px. 라벨은 `dash-web-{id}`.

use std::sync::mpsc;
use std::time::Duration;

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewBuilder, WebviewUrl, Window, Wry};

const PREFIX: &str = "dash-web-";
const MAIN: &str = "main";
const TEXT_WAIT: Duration = Duration::from_secs(10);
const UI_ERR: &str = "웹사이트 칸을 바꾸지 못했어요";

pub fn label_for(widget_id: &str) -> Result<String, String> {
    super::check_widget_id(widget_id)?;
    Ok(format!("{PREFIX}{widget_id}"))
}

/// http/https 주소만 연다.
pub fn parse_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "주소 형식이 맞지 않아요".to_string())?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        _ => Err("http 또는 https 주소만 열 수 있어요".into()),
    }
}

/// 위치·크기 값을 검사한다. 음수 위치는 0으로, 크기는 최소 1px로 맞춘다.
fn bounds(x: f64, y: f64, w: f64, h: f64) -> Result<(f64, f64, f64, f64), String> {
    if ![x, y, w, h].iter().all(|v| v.is_finite()) {
        return Err("칸 위치 값이 맞지 않아요".into());
    }
    Ok((x.max(0.0), y.max(0.0), w.max(1.0), h.max(1.0)))
}

fn place(wv: &Webview<Wry>, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let (x, y, w, h) = bounds(x, y, w, h)?;
    wv.set_position(LogicalPosition::new(x, y)).map_err(|_| UI_ERR.to_string())?;
    wv.set_size(LogicalSize::new(w, h)).map_err(|_| UI_ERR.to_string())
}

fn find(app: &AppHandle, widget_id: &str) -> Result<Webview<Wry>, String> {
    let label = label_for(widget_id)?;
    app.get_webview(&label).ok_or_else(|| "웹사이트 칸이 아직 열려 있지 않아요".to_string())
}

fn main_window(app: &AppHandle) -> Result<Window<Wry>, String> {
    app.get_window(MAIN).ok_or_else(|| "메인 창을 찾을 수 없어요".to_string())
}

/// 칸을 열거나, 이미 있으면 주소만 바꾸고 위치를 맞춘 뒤 보여 준다.
#[tauri::command]
pub fn web_open(app: AppHandle, widget_id: String, url: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let label = label_for(&widget_id)?;
    let target = parse_url(&url)?;
    let (x, y, w, h) = bounds(x, y, w, h)?;
    if let Some(wv) = app.get_webview(&label) {
        let same = wv.url().map(|u| u.as_str() == target.as_str()).unwrap_or(false);
        if !same {
            wv.navigate(target).map_err(|_| UI_ERR.to_string())?;
        }
        place(&wv, x, y, w, h)?;
        return wv.show().map_err(|_| UI_ERR.to_string());
    }
    let window = main_window(&app)?;
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(target))
        .incognito(false)
        .on_navigation(|u| matches!(u.scheme(), "http" | "https" | "about"));
    window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w, h))
        .map_err(|_| "웹사이트를 열지 못했어요".to_string())?;
    Ok(())
}

#[tauri::command]
pub fn web_bounds(app: AppHandle, widget_id: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let wv = find(&app, &widget_id)?;
    place(&wv, x, y, w, h)
}

#[tauri::command]
pub fn web_show(app: AppHandle, widget_id: String) -> Result<(), String> {
    find(&app, &widget_id)?.show().map_err(|_| UI_ERR.to_string())
}

#[tauri::command]
pub fn web_hide(app: AppHandle, widget_id: String) -> Result<(), String> {
    find(&app, &widget_id)?.hide().map_err(|_| UI_ERR.to_string())
}

#[tauri::command]
pub fn web_reload(app: AppHandle, widget_id: String) -> Result<(), String> {
    find(&app, &widget_id)?.reload().map_err(|_| UI_ERR.to_string())
}

#[tauri::command]
pub fn web_close(app: AppHandle, widget_id: String) -> Result<(), String> {
    find(&app, &widget_id)?.close().map_err(|_| UI_ERR.to_string())
}

/// 대시보드 칸 웹뷰를 모두 숨긴다(다른 탭으로 갈 때).
#[tauri::command]
pub fn web_hide_all(app: AppHandle) -> Result<(), String> {
    for (label, wv) in app.webviews() {
        if label.starts_with(PREFIX) {
            let _ = wv.hide();
        }
    }
    Ok(())
}

/// 칸 페이지의 보이는 글(document.body.innerText)을 가져온다.
/// 자식 웹뷰는 외부 사이트라 IPC를 쓸 수 없으므로, 스크립트 실행 결과를 콜백으로 받는다.
#[tauri::command]
pub async fn web_text(app: AppHandle, widget_id: String) -> Result<String, String> {
    let wv = find(&app, &widget_id)?;
    let (tx, rx) = mpsc::channel::<String>();
    wv.eval_with_callback("document.body ? document.body.innerText : ''", move |raw| {
        let _ = tx.send(raw);
    })
    .map_err(|_| "웹사이트 글을 읽지 못했어요".to_string())?;
    let raw = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(TEXT_WAIT).ok())
        .await
        .map_err(|_| "웹사이트 글을 읽는 중에 멈췄어요".to_string())?;
    raw.map(|r| decode_result(&r))
        .ok_or_else(|| "웹사이트 글을 읽지 못했어요. 페이지가 다 열렸는지 확인해 주세요".to_string())
}

/// 콜백 값은 JSON 문자열 형태로 온다. 따옴표와 이스케이프를 풀어 본문만 남긴다.
pub fn decode_result(raw: &str) -> String {
    serde_json::from_str::<String>(raw).unwrap_or_else(|_| raw.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_and_https_are_allowed() {
        assert!(parse_url("https://example.com/a?b=1").is_ok());
        assert!(parse_url("http://example.com").is_ok());
        assert!(parse_url("file:///etc/passwd").is_err());
        assert!(parse_url("javascript:alert(1)").is_err());
        assert!(parse_url("not a url").is_err());
    }

    #[test]
    fn widget_ids_map_to_labels_only_when_valid() {
        assert_eq!(label_for("news-1").unwrap(), "dash-web-news-1");
        assert!(label_for("../x").is_err());
        assert!(label_for("a b").is_err());
        assert!(label_for("").is_err());
    }

    #[test]
    fn bounds_clamp_and_reject_non_finite() {
        assert_eq!(bounds(-5.0, 2.0, 0.0, 0.5).unwrap(), (0.0, 2.0, 1.0, 1.0));
        assert!(bounds(f64::NAN, 0.0, 1.0, 1.0).is_err());
        assert!(bounds(0.0, f64::INFINITY, 1.0, 1.0).is_err());
    }

    #[test]
    fn decodes_quoted_js_result_and_passes_plain_text() {
        assert_eq!(decode_result("\"안녕\\n세계\""), "안녕\n세계");
        assert_eq!(decode_result("plain"), "plain");
    }
}
