mod accounts;
mod alerts;
mod batch;
mod clis;
mod launch;
mod projects;
mod prompts;
mod pty;
mod remote;
mod server;
mod structured;
mod sys;
mod team;
mod tokens;
mod usage;

use std::sync::Arc;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Emitter, Manager};

/// Set once the app starts closing, so the shutdown (everyone clocking out) isn't recorded as "last teams".
static QUITTING: AtomicBool = AtomicBool::new(false);

/// Set once the teams were put away for a restart (`app_prepare_restart`), so the exit that follows
/// doesn't record the now-empty team list over the one saved for the restart.
static PREPARED: AtomicBool = AtomicBool::new(false);

/// Set once the user confirmed closing or quitting: the close/exit that follows goes through without asking again.
static CONFIRMED: AtomicBool = AtomicBool::new(false);

/// Ask before a close or quit that would stop working members? Not when the user already confirmed,
/// when the app is restarting itself (an update), when the setting is off, or when nobody is at work.
fn should_ask_quit(confirmed: bool, prepared: bool, confirm_on: bool, working: usize) -> bool {
    !confirmed && !prepared && confirm_on && working > 0
}

/// Hold back a window close or app quit and ask the window first (`kind`: "window" | "quit").
/// Returns true when the question was sent, so the caller must stop the close/exit.
fn ask_before_quit(app: &tauri::AppHandle, kind: &str) -> bool {
    let Some(teams) = app.try_state::<Arc<team::TeamManager>>() else { return false };
    let confirm_on = app.try_state::<projects::Projects>().map(|p| p.confirm_quit()).unwrap_or(true);
    let working = teams.working_count();
    let ask = should_ask_quit(
        CONFIRMED.load(Ordering::SeqCst),
        PREPARED.load(Ordering::SeqCst),
        confirm_on,
        working,
    );
    if ask {
        let _ = app.emit("quit-ask", serde_json::json!({ "kind": kind, "working": working }));
    }
    ask
}

/// The user pressed [끄기] in the question: let the window close (or the app quit) go through.
#[tauri::command]
fn app_quit_confirm(app: tauri::AppHandle, kind: String) {
    CONFIRMED.store(true, Ordering::SeqCst);
    if kind == "quit" {
        app.exit(0);
    } else if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
}

/// Note what every team is doing, stop them and save — the start after this brings them back the
/// same way. `why`: "update" | "quit".
fn put_teams_away(app: &tauri::AppHandle, why: &str) {
    QUITTING.store(true, Ordering::SeqCst);
    let Some(teams) = app.try_state::<Arc<team::TeamManager>>() else { return };
    if let Some(projects) = app.try_state::<projects::Projects>() {
        projects.set_closing(teams.live_ids(), why);
    }
    teams.suspend_all(why);
    teams.flush();
}

/// Called right before the app restarts itself (to install an update): every team and member's
/// session is saved with a "restarted for an update" mark, and they all come back on the next start.
#[tauri::command]
fn app_prepare_restart(app: tauri::AppHandle, reason: Option<String>) {
    if PREPARED.swap(true, Ordering::SeqCst) {
        return;
    }
    let why = if reason.as_deref() == Some("quit") { "quit" } else { "update" };
    put_teams_away(&app, why);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // helper mode: stdio MCP bridge for agents that only speak stdio MCP (Antigravity)
    let argv: Vec<String> = std::env::args().collect();
    if argv.get(1).map(String::as_str) == Some("--mcp-bridge") {
        if let Some(url) = argv.get(2) {
            structured::run_mcp_bridge(url);
        }
        return;
    }
    sys::adopt_login_path();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let pty: pty::Pty = Arc::new(pty::PtyManager::default());
            app.manage(pty.clone());
            app.manage(projects::Projects::load(&handle));
            app.manage(accounts::Accounts::load(&handle));
            app.manage(clis::CliState::load(&handle));
            app.manage(remote::Remote::load(&handle));
            remote::restore(handle.clone());
            alerts::listen(&handle);
            alerts::prime(&handle);

            let (listener, port) = tauri::async_runtime::block_on(server::bind());
            let token = uuid::Uuid::new_v4().simple().to_string();
            #[cfg(debug_assertions)]
            eprintln!("[prism] broker http://127.0.0.1:{port} token={token}");
            let teams = Arc::new(team::TeamManager::new(handle, pty, port, token));
            teams.load_saved(&app.state::<projects::Projects>());
            // save team state every couple of seconds
            let saver = teams.clone();
            let remember = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(2));
                saver.flush();
                // remember who is clocked in (never an empty list from here: at startup nobody is in yet)
                if !QUITTING.load(Ordering::SeqCst) {
                    let live = saver.live_ids();
                    if !live.is_empty() {
                        remember.state::<projects::Projects>().set_last_teams(live);
                    }
                }
            });
            app.manage(teams.clone());
            // batches are watched after the teams are back, so restored teams are judged as they are
            app.manage(Arc::new(batch::Batches::load(app.handle())));
            batch::start_watch(app.handle().clone());
            tauri::async_runtime::spawn(server::serve(listener, teams));

            clis::start_auto_update(app.handle().clone());
            launch::warm_models();

            // subscription usage: now, then every 5 minutes (Orca's cadence)
            let h = app.handle().clone();
            std::thread::spawn(move || loop {
                team::refresh_usage(&h);
                std::thread::sleep(std::time::Duration::from_secs(300));
            });
            Ok(())
        })
        // closing the window (Cmd+W, the red button) asks first when members are at work
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if ask_before_quit(window.app_handle(), "window") {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn_shell,
            pty::pty_attach,
            pty::pty_detach,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            remote::remote_status,
            remote::remote_set,
            remote::remote_new_key,
            clis::cli_status,
            clis::cli_auto_update,
            clis::cli_set_auto_update,
            clis::cli_install,
            clis::cli_update_now,
            accounts::accounts_list,
            accounts::account_add,
            accounts::account_remove,
            accounts::account_set_active,
            accounts::account_login,
            accounts::account_logout,
            projects::projects_list,
            projects::workspace_root,
            projects::workspace_set_root,
            projects::project_create,
            projects::project_touch,
            projects::prefs_get,
            projects::prefs_set,
            projects::prefs_set_auto_resume,
            projects::prefs_set_confirm_quit,
            projects::prefs_set_auto_allow_safe,
            projects::prefs_clear_restart,
            alerts::team_alert,
            alerts::prefs_set_alert,
            projects::shop_buy,
            projects::gacha_pull,
            projects::gacha_info,
            app_prepare_restart,
            app_quit_confirm,
            projects::project_set_team,
            projects::project_set_preset,
            projects::project_set_knowledge,
            projects::project_import,
            projects::project_forget,
            projects::knowledge_get,
            projects::knowledge_set,
            projects::worktrees_list,
            projects::git_changes,
            projects::git_diff,
            team::team_start,
            team::team_stop,
            team::usage_get,
            team::agent_pause,
            team::agent_resume,
            team::agent_transcript,
            team::usage_refresh,
            launch::models_list,
            team::attach_files,
            team::attach_bytes,
            team::team_get,
            team::lead_send,
            team::lead_renew,
            team::task_follow_up,
            team::team_branches,
            team::team_set_branch,
            team::team_storage,
            team::team_cleanup,
            team::escalation_answer,
            team::permission_answer,
            team::task_files,
            team::task_diff,
            team::task_merge_check,
            team::task_merge,
            team::task_complete,
            team::task_file,
            team::task_file_bytes,
            team::task_file_stamp,
            team::task_file_save,
            team::task_engine_files,
            team::agent_message,
            team::agent_set_model,
            team::agent_kill,
            batch::batch_create,
            batch::batch_list,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // Cmd+Q (or the last window going away) by the user asks first; an exit the app asks for itself does not
            tauri::RunEvent::ExitRequested { code: None, api, .. } => {
                if ask_before_quit(app, "quit") {
                    api.prevent_exit();
                }
            }
            // don't leave agents running after the window closes
            tauri::RunEvent::Exit => {
                // who was in when the app closed (an empty list too: the user had clocked everyone out),
                // and what each member was doing — unless that was already done for a restart
                if !PREPARED.swap(true, Ordering::SeqCst) {
                    put_teams_away(app, "quit");
                }
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::should_ask_quit;

    #[test]
    fn asks_only_when_members_are_working_and_the_setting_is_on() {
        assert!(should_ask_quit(false, false, true, 2));
        assert!(!should_ask_quit(false, false, true, 0), "nobody at work: close at once");
        assert!(!should_ask_quit(false, false, false, 3), "setting off: never ask");
    }

    #[test]
    fn does_not_ask_again_after_confirm_or_for_an_update_restart() {
        assert!(!should_ask_quit(true, false, true, 2), "already confirmed");
        assert!(!should_ask_quit(false, true, true, 2), "restarting for an update");
    }
}
