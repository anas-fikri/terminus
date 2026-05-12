use std::path::Path;

fn home_dir_from_env() -> Option<String> {
    if let Ok(home) = std::env::var("HOME") {
        if !home.trim().is_empty() {
            return Some(home);
        }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        if !profile.trim().is_empty() {
            return Some(profile);
        }
    }
    let drive = std::env::var("HOMEDRIVE").unwrap_or_default();
    let path = std::env::var("HOMEPATH").unwrap_or_default();
    if !drive.is_empty() && !path.is_empty() {
        return Some(format!("{}{}", drive, path));
    }
    None
}

fn expand_tilde(path: &str) -> String {
    if path.starts_with("~/") || path == "~" {
        if let Some(home) = home_dir_from_env() {
            return path.replacen("~", &home, 1);
        }
    }
    path.to_string()
}

/// Read a local file's text content for the viewer.
#[tauri::command]
pub fn read_file_content(path: String) -> Result<String, String> {
    let resolved = expand_tilde(&path);
    std::fs::read_to_string(&resolved).map_err(|e| format!("Cannot read {resolved}: {e}"))
}

/// Read a local file's raw bytes for binary-safe viewers (for example PDF).
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    let resolved = expand_tilde(&path);
    std::fs::read(&resolved).map_err(|e| format!("Cannot read {resolved}: {e}"))
}

/// Append text content to a file (creates parent dirs and file if needed).
#[tauri::command]
pub fn write_file_content(path: String, content: String) -> Result<(), String> {
    let resolved = expand_tilde(&path);
    if let Some(parent) = Path::new(&resolved).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create dirs: {e}"))?;
    }
    // Append so each inspect call accumulates instead of overwriting
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&resolved)
        .map_err(|e| format!("Cannot open {resolved}: {e}"))?;
    file.write_all(content.as_bytes()).map_err(|e| format!("Cannot write {resolved}: {e}"))
}

/// Write text content by replacing the file content.
#[tauri::command]
pub fn write_file_content_overwrite(path: String, content: String) -> Result<(), String> {
    let resolved = expand_tilde(&path);
    if let Some(parent) = Path::new(&resolved).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create dirs: {e}"))?;
    }
    std::fs::write(&resolved, content).map_err(|e| format!("Cannot write {resolved}: {e}"))
}

/// Get the extension of a file path for type detection.
#[tauri::command]
pub fn get_file_ext(path: String) -> String {
    Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

/// Get file modified timestamp (milliseconds since unix epoch).
#[tauri::command]
pub fn get_file_modified_ms(path: String) -> Result<Option<u128>, String> {
    let resolved = expand_tilde(&path);
    let metadata = std::fs::metadata(&resolved).map_err(|e| format!("Cannot stat {resolved}: {e}"))?;
    let modified = metadata
        .modified()
        .map_err(|e| format!("Cannot read modified time {resolved}: {e}"))?;
    match modified.duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => Ok(Some(duration.as_millis())),
        Err(_) => Ok(None),
    }
}
