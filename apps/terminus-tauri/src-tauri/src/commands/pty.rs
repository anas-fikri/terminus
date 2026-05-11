use portable_pty::{CommandBuilder, PtySize, native_pty_system, MasterPty};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

struct PtySession {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
}

type SessionMap = Arc<Mutex<HashMap<String, PtySession>>>;

fn get_sessions() -> SessionMap {
    use std::sync::OnceLock;
    static SESSIONS: OnceLock<SessionMap> = OnceLock::new();
    SESSIONS.get_or_init(|| Arc::new(Mutex::new(HashMap::new()))).clone()
}

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    session_id: String,
    cwd: Option<String>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let size = PtySize { rows: 24, cols: 200, pixel_width: 0, pixel_height: 0 };
    let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            if cfg!(target_os = "windows") {
                "powershell.exe".to_string()
            } else if cfg!(target_os = "macos") {
                "/bin/zsh".to_string()
            } else {
                "/bin/bash".to_string()
            }
        });
    let mut cmd = CommandBuilder::new(&shell);
    if cfg!(target_os = "windows") {
        let lower = shell.to_ascii_lowercase();
        if lower.contains("powershell") || lower == "pwsh" || lower.ends_with("/pwsh") {
            cmd.arg("-NoLogo");
        } else if lower.ends_with("cmd") || lower.ends_with("cmd.exe") {
            cmd.arg("/K");
        }
    } else {
        cmd.arg("-l");
    }
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }

    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let sid = session_id.clone();
    let app2 = app.clone();
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    let _ = app2.emit(&format!("pty://exit/{}", sid), ());
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app2.emit(&format!("pty://data/{}", sid), data);
                }
            }
        }
    });

    get_sessions().lock().unwrap().insert(
        session_id,
        PtySession {
            writer: Arc::new(Mutex::new(writer)),
            master: Arc::new(Mutex::new(pair.master)),
        },
    );

    Ok(())
}

#[tauri::command]
pub fn pty_write(session_id: String, data: String) -> Result<(), String> {
    let sessions = get_sessions();
    let map = sessions.lock().unwrap();
    if let Some(s) = map.get(&session_id) {
        s.writer.lock().unwrap().write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_resize(session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = get_sessions();
    let map = sessions.lock().unwrap();
    if let Some(s) = map.get(&session_id) {
        let _ = s.master.lock().unwrap().resize(PtySize {
            rows, cols, pixel_width: 0, pixel_height: 0,
        });
    }
    Ok(())
}

#[tauri::command]
pub fn pty_kill(session_id: String) {
    get_sessions().lock().unwrap().remove(&session_id);
}

