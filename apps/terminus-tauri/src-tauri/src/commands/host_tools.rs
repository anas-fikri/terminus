use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
pub struct KubectlHostInfo {
    pub available: bool,
    pub current_context: Option<String>,
    pub namespace: Option<String>,
}

#[derive(Serialize)]
pub struct HostToolStatus {
    pub ssh_available: bool,
    pub kubectl_available: bool,
}

fn run_kubectl(args: &[&str]) -> Option<String> {
    let output = Command::new("kubectl").args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn command_available(program: &str, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[tauri::command]
pub fn get_kubectl_host_info() -> KubectlHostInfo {
    let available = command_available("kubectl", &["version", "--client", "--output=json"]);

    if !available {
        return KubectlHostInfo {
            available: false,
            current_context: None,
            namespace: None,
        };
    }

    let current_context = run_kubectl(&["config", "current-context"]);
    let namespace = run_kubectl(&[
        "config",
        "view",
        "--minify",
        "--output",
        "jsonpath={..namespace}",
    ]);

    KubectlHostInfo {
        available: true,
        current_context,
        namespace,
    }
}

#[tauri::command]
pub fn get_kubectl_contexts() -> Vec<String> {
    let output = Command::new("kubectl")
        .args(["config", "get-contexts", "-o", "name"])
        .output();

    let Ok(output) = output else {
        return Vec::new();
    };

    if !output.status.success() {
        return Vec::new();
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect()
}

#[tauri::command]
pub fn get_host_tool_status() -> HostToolStatus {
    let ssh_available = command_available("ssh", &["-V"]);
    let kubectl_available = command_available("kubectl", &["version", "--client", "--output=json"]);

    HostToolStatus {
        ssh_available,
        kubectl_available,
    }
}