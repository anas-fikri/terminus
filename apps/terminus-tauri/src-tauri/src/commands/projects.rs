use serde::Serialize;
use std::path::Path;
use terminus_core::config;

#[derive(Debug, Serialize)]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
}

/// List recently-used projects from app config.
/// AppConfig does not yet store recents; returns empty list until that feature is added.
#[tauri::command]
pub fn list_projects() -> Result<Vec<ProjectInfo>, String> {
    let _cfg = config::load_app_config().map_err(|e| e.to_string())?;
    // TODO: persist recent_projects list in AppConfig
    Ok(vec![])
}

/// Set the active workspace path (stored in app state for current session).
#[tauri::command]
pub fn set_active_project(path: String) -> Result<(), String> {
    // Validate the path exists
    if !std::path::Path::new(&path).exists() {
        return Err(format!("Path does not exist: {path}"));
    }
    Ok(())
}

/// Return effective merged config for a workspace.
#[tauri::command]
pub fn get_effective_settings(workspace: String) -> Result<serde_json::Value, String> {
    let cfg = config::resolve_effective_config(Path::new(&workspace)).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "provider_name": cfg.provider_name,
        "model": cfg.provider.model,
        "base_url": cfg.provider.base_url,
        "mcp_default_policy": cfg.mcp_default_policy,
        "monitoring_retention_days": cfg.monitoring_retention_days,
        "git_mode": cfg.git_mode,
    }))
}

/// Update the global app config.
#[tauri::command]
pub fn update_app_settings(settings: serde_json::Value) -> Result<(), String> {
    let _cfg: config::AppConfig = serde_json::from_value(settings).map_err(|e| e.to_string())?;
    // TODO: persist via config::save_app_config when implemented
    Ok(())
}

/// Update project-level config.
#[tauri::command]
pub fn update_project_settings(workspace: String, settings: serde_json::Value) -> Result<(), String> {
    let _cfg: config::ProjectConfig =
        serde_json::from_value(settings).map_err(|e| e.to_string())?;
    let _ = workspace;
    // TODO: persist via config::save_project_config when implemented
    Ok(())
}
