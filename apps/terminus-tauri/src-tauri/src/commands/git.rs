use std::path::Path;
use terminus_core::gitops;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: String,
    pub ahead: usize,
    pub behind: usize,
    pub modified: usize,
    pub untracked: usize,
}

#[derive(Debug, Deserialize)]
pub struct GitParams {
    pub workspace: String,
    pub subcommand: String,
}

/// Run a git operation respecting the configured policy (read-only by default).
#[tauri::command]
pub fn run_git_op(params: GitParams) -> Result<String, String> {
    // Always enforce read-only for safety – write ops will be opt-in via project config
    gitops::run_git(Path::new(&params.workspace), &params.subcommand, true).map_err(|e| e.to_string())
}

/// Get git status for the workspace
#[tauri::command]
pub fn get_git_status(workspace: String) -> Result<GitStatus, String> {
    let path = Path::new(&workspace);
    
    // Check if it's a git repo
    if !path.join(".git").exists() {
        return Ok(GitStatus {
            branch: "no git".to_string(),
            ahead: 0,
            behind: 0,
            modified: 0,
            untracked: 0,
        });
    }
    
    // Try to get branch name
    let branch = gitops::run_git(path, "rev-parse --abbrev-ref HEAD", true)
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    
    // Get status porcelain (short format)
    let status_output = gitops::run_git(path, "status --porcelain", true)
        .unwrap_or_default();
    
    let mut modified = 0;
    let mut untracked = 0;
    
    for line in status_output.lines() {
        let status = line.chars().take(2).collect::<String>();
        match status.as_str() {
            "??" => untracked += 1,
            _ => modified += 1,
        }
    }
    
    // Get ahead/behind from branch tracking
    let rev_list_output = gitops::run_git(path, "rev-list --left-right --count @{u}...HEAD", true)
        .unwrap_or_default();
    
    let (behind, ahead) = if let Some(counts) = rev_list_output.trim().split_whitespace().collect::<Vec<_>>().get(0..2) {
        (
            counts[0].parse().unwrap_or(0),
            counts[1].parse().unwrap_or(0),
        )
    } else {
        (0, 0)
    };
    
    Ok(GitStatus {
        branch,
        ahead,
        behind,
        modified,
        untracked,
    })
}
