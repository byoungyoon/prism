//! 데스크톱 알림: 팀이 사용자 허락을 기다릴 때("ask"), 일이 끝나거나 막혔을 때("work").
//! 언제·무슨 내용으로 알릴지는 화면(`src/store.ts`)이 정하고,
//! 여기서는 설정 확인, 알림 띄우기, 알림을 눌렀을 때 앱을 앞으로 가져오기를 맡는다.
//! 데스크톱의 `requestPermission`은 아무것도 하지 않는다: macOS는 첫 알림이 갈 때 허용할지 묻는다.
//! 그래서 처음 한 번 안내 알림을 보내 그 질문이 진짜 알림보다 먼저 뜨게 한다.

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::{ActionPerformed, NotificationExt};

use crate::projects::{Projects, Settings};

/// 알림에 실어 두는 팀 id. 이 값이 없는 알림(다른 소식)은 눌러도 화면을 옮기지 않는다.
const TEAM_KEY: &str = "projectId";

/// 알림 종류: 허락 요청 | 일 소식(끝남·적용·실패·막힘). 설정에서 따로 끈다.
#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Ask,
    Work,
}

impl Kind {
    fn enabled(self, s: &Settings) -> bool {
        match self {
            Kind::Ask => s.ask_alert,
            Kind::Work => s.work_alert,
        }
    }
}

/// 설정이 켜져 있고, 앱이 맨 앞에서 그 팀을 보여주는 중이 아닐 때만 알린다.
fn should_alert(enabled: bool, watching: bool, focused: bool) -> bool {
    enabled && !(watching && focused)
}

fn clicked_team(action: &ActionPerformed) -> Option<String> {
    if action.action_id() != "tap" {
        return None;
    }
    action.notification()?.extra().get(TEAM_KEY)?.as_str().map(str::to_string)
}

fn bring_forward(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 알림 클릭을 받기 시작한다. 이 등록 전에 띄운 알림은 클릭이 전해지지 않으므로 시작할 때 부른다.
pub fn listen(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.notification().on_action(move |action| {
        let Some(team) = clicked_team(action) else { return };
        // 알림 응답은 뒤쪽 스레드에서 오므로 창은 메인 스레드에서 다룬다
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            bring_forward(&inner);
            let _ = inner.emit("alert-open", team);
        });
    });
}

/// 처음 한 번: 안내 알림을 보내 macOS가 알림을 허용할지 묻게 한다.
pub fn prime(app: &AppHandle) {
    if app.state::<Projects>().take_alert_priming() {
        let _ = app.notification().builder().title("Prism 알림").body("팀원이 허락을 기다리거나 일이 끝나면 이렇게 알려드릴게요").show();
    }
}

/// `watching`: 화면이 지금 그 팀을 보여주고 있는가 (창이 맨 앞인지는 여기서 확인한다).
#[tauri::command]
pub fn team_alert(app: AppHandle, project_id: String, kind: Kind, title: String, body: String, watching: bool) -> Result<(), String> {
    let enabled = kind.enabled(&app.state::<Projects>().settings());
    let focused = app.get_webview_window("main").and_then(|w| w.is_focused().ok()).unwrap_or(false);
    if !should_alert(enabled, watching, focused) {
        return Ok(());
    }
    app.notification().builder().title(title).body(body).extra(TEAM_KEY, project_id).show().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn prefs_set_alert(app: AppHandle, kind: Kind, on: bool) -> Settings {
    let projects = app.state::<Projects>();
    let s = projects.set_alert(matches!(kind, Kind::Ask), on);
    if on {
        prime(&app);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alerts_unless_off_or_already_looking_at_that_team() {
        assert!(should_alert(true, false, false));
        assert!(should_alert(true, true, false), "the window is behind another app");
        assert!(should_alert(true, false, true), "in front, but looking at something else");
        assert!(!should_alert(true, true, true));
        assert!(!should_alert(false, false, false));
    }

    #[test]
    fn a_click_names_the_team_the_notification_carried() {
        let read = |v: serde_json::Value| clicked_team(&serde_json::from_value::<ActionPerformed>(v).unwrap());
        let ours = serde_json::json!({ "id": 7, "title": "데모팀", "schedule": null, "extra": { "projectId": "p1" } });
        assert_eq!(read(serde_json::json!({ "actionId": "tap", "inputValue": null, "notification": ours })), Some("p1".into()));
        assert_eq!(read(serde_json::json!({ "actionId": "tap", "inputValue": null, "notification": { "id": 8, "extra": {} } })), None);
        assert_eq!(read(serde_json::json!({ "actionId": "dismiss", "inputValue": null, "notification": { "id": 9, "extra": { "projectId": "p1" } } })), None);
    }

    #[test]
    fn both_alerts_are_on_by_default_also_for_saved_settings_without_them() {
        let old: Settings = serde_json::from_str("{}").unwrap();
        for s in [Settings::default(), old] {
            assert!(Kind::Ask.enabled(&s) && Kind::Work.enabled(&s) && !s.alert_primed);
        }
    }

    #[test]
    fn each_kind_has_its_own_switch() {
        let mut s = Settings::default();
        s.work_alert = false;
        assert!(Kind::Ask.enabled(&s) && !Kind::Work.enabled(&s));
    }
}
