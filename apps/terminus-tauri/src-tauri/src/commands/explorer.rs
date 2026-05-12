use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<TreeNode>>,
}

/// Return a file tree for the given workspace root (depth 6).
#[tauri::command]
pub fn get_tree(workspace: String) -> Result<TreeNode, String> {
    build_tree(Path::new(&workspace), 0, 6).map_err(|e| e.to_string())
}

fn build_tree(path: &Path, depth: usize, max_depth: usize) -> anyhow::Result<TreeNode> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(".")
        .to_string();
    let path_str = path.to_string_lossy().to_string();

    if path.is_file() {
        return Ok(TreeNode {
            name,
            path: path_str,
            is_dir: false,
            children: None,
        });
    }

    let children = if depth < max_depth {
        let mut entries: Vec<TreeNode> = fs::read_dir(path)?
            .filter_map(|e| e.ok())
            .filter(|e| {
                // Skip common noise dirs but include hidden files/folders
                let fname = e.file_name();
                let s = fname.to_string_lossy();
                s != "target" && s != "node_modules"
            })
            .filter_map(|e| build_tree(&e.path(), depth + 1, max_depth).ok())
            .collect();
        entries.sort_by(|a, b| {
            // dirs first, then alphabetical
            b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name))
        });
        Some(entries)
    } else {
        None
    };

    Ok(TreeNode {
        name,
        path: path_str,
        is_dir: true,
        children,
    })
}
