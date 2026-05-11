use anyhow::{Context, Result};
use std::path::Path;
use std::process::Command;

pub fn run_git(workspace: &Path, subcommand: &str, read_only: bool) -> Result<String> {
    let allowed = ["status", "fetch", "log", "branch", "remote"];
    if read_only && !allowed.contains(&subcommand) {
        anyhow::bail!("git subcommand '{}' not allowed in read-only mode", subcommand);
    }

    let output = Command::new("git")
        .arg(subcommand)
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
