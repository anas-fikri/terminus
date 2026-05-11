use std::path::Path;

fn expand_tilde(path: &str) -> String {
    if path.starts_with("~/") || path == "~" {
        if let Ok(home) = std::env::var("HOME") {
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

/// Get the extension of a file path for type detection.
#[tauri::command]
pub fn get_file_ext(path: String) -> String {
    Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}
