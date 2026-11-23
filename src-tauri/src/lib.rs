mod accounts;
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
mod usage;

use std::sync::Arc;

use tauri::Manager;

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

            let (listener, port) = tauri::async_runtime::block_on(server::bind());
            let token = uuid::Uuid::new_v4().simple().to_string();
            #[cfg(debug_assertions)]
            eprintln!("[prism] broker http://127.0.0.1:{port} token={token}");
            let teams = Arc::new(team::TeamManager::new(handle, pty, port, token));
            teams.load_saved(&app.state::<projects::Projects>());
            // save team state every couple of seconds
            let saver = teams.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(2));
                saver.flush();
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
            team::task_follow_up,
            team::team_branches,
            team::team_set_branch,
            team::escalation_answer,
            team::permission_answer,
            team::task_files,
            team::task_diff,
            team::task_file,
            team::agent_message,
            team::agent_set_model,
            team::agent_kill,
            batch::batch_create,
            batch::batch_list,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // don't leave agents running after the window closes
            if let tauri::RunEvent::Exit = event {
                if let Some(teams) = app.try_state::<Arc<team::TeamManager>>() {
                    teams.stop_all();
                    teams.flush();
                }
            }
        });
}
