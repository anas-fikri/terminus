use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheStore {
    entries: HashMap<String, String>,
}

impl Default for CacheStore {
    fn default() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }
}

fn cache_path(workspace: &Path) -> PathBuf {
    workspace.join(".terminus").join("cache.json")
}

fn key(model: &str, prompt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(model.as_bytes());
    hasher.update(b"::");
    hasher.update(prompt.trim().as_bytes());
    format!("{:x}", hasher.finalize())
}

fn load_store(workspace: &Path) -> Result<CacheStore> {
    let path = cache_path(workspace);
    if !path.exists() {
        return Ok(CacheStore::default());
    }
    let raw = fs::read_to_string(&path)
        .with_context(|| format!("failed reading cache at {}", path.display()))?;
    let store = serde_json::from_str::<CacheStore>(&raw)
        .with_context(|| format!("failed parsing cache at {}", path.display()))?;
    Ok(store)
}

fn save_store(workspace: &Path, store: &CacheStore) -> Result<()> {
    let path = cache_path(workspace);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed creating cache dir {}", parent.display()))?;
    }
    let raw = serde_json::to_string_pretty(store)?;
    fs::write(&path, raw).with_context(|| format!("failed writing cache at {}", path.display()))?;
    Ok(())
}

pub fn get(workspace: &Path, model: &str, prompt: &str) -> Result<Option<String>> {
    let store = load_store(workspace)?;
    Ok(store.entries.get(&key(model, prompt)).cloned())
}

pub fn put(workspace: &Path, model: &str, prompt: &str, response: &str) -> Result<()> {
    let mut store = load_store(workspace)?;
    store
        .entries
        .insert(key(model, prompt), response.to_string());
    save_store(workspace, &store)
}
