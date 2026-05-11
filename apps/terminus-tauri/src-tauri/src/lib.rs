mod commands;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            // AI runtime
            commands::ask::run_ask,
            commands::ask::cancel_run,
            // Projects
            commands::projects::list_projects,
            commands::projects::set_active_project,
            commands::projects::get_effective_settings,
            commands::projects::update_app_settings,
            commands::projects::update_project_settings,
            // Explorer
            commands::explorer::get_tree,
            // Files
            commands::files::read_file_content,
            commands::files::write_file_content,
            commands::files::write_file_content_overwrite,
            commands::files::get_file_ext,
            // Browser
            commands::browser::fetch_remote_html,
            // Git
            commands::git::run_git_op,
            commands::git::get_git_status,
            // Host tools
            commands::host_tools::get_kubectl_host_info,
            commands::host_tools::get_kubectl_contexts,
            commands::host_tools::get_host_tool_status,
            // Monitoring
            commands::monitoring::get_monitoring_summary,
            // PTY terminal
            commands::pty::pty_spawn,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
            // System info
            commands::system_info::get_system_stats,
        ])
        .setup(|_app| {
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Terminus");
}
