use anyhow::{Context, Result};
use std::path::Path;
use std::process::Command;

pub fn run_git(workspace: &Path, subcommand: &str, read_only: bool) -> Result<String> {
    let parts: Vec<&str> = subcommand.split_whitespace().collect();
    if parts.is_empty() {
        anyhow::bail!("git subcommand is empty");
    }

    let cmd = parts[0];
    let args = &parts[1..];

    let allowed = [
        "status",
        "fetch",
        "log",
        "branch",
        "remote",
        "rev-parse",
        "rev-list",
        "config",
    ];
    if read_only && !allowed.contains(&cmd) {
        anyhow::bail!("git subcommand '{}' not allowed in read-only mode", cmd);
    }

    let output = Command::new("git")
        .arg(cmd)
        .args(args)
        .current_dir(workspace)
        .output()
        .with_context(|| format!("failed running git {}", subcommand))?;

    if !output.status.success() {
        anyhow::bail!(
            "git {} failed: {}",
            subcommand,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
