use anyhow::{Context, Result};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderConfig {
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub api_key_env: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitPolicy {
    pub mode: String,
}

impl Default for GitPolicy {
    fn default() -> Self {
        Self {
            mode: "read-only".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub default_provider: String,
    pub providers: HashMap<String, ProviderConfig>,
    pub mcp_default_policy: String,
    pub monitoring_retention_days: u32,
    pub git: GitPolicy,
}

impl Default for AppConfig {
    fn default() -> Self {
        let mut providers = HashMap::new();
        providers.insert(
            "openai".to_string(),
            ProviderConfig {
                name: "openai".to_string(),
                base_url: "https://api.openai.com/v1/chat/completions".to_string(),
                model: "gpt-4o-mini".to_string(),
                api_key_env: "OPENAI_API_KEY".to_string(),
            },
        );

        Self {
            default_provider: "openai".to_string(),
            providers,
            mcp_default_policy: "confirm".to_string(),
            monitoring_retention_days: 30,
            git: GitPolicy::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectConfig {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub api_key_env: Option<String>,
    pub git_mode: Option<String>,
}

#[derive(Debug, Clone)]
pub struct EffectiveConfig {
    pub provider_name: String,
    pub provider: ProviderConfig,
    pub mcp_default_policy: String,
    pub monitoring_retention_days: u32,
    pub git_mode: String,
}

pub fn app_config_path() -> Result<PathBuf> {
    let dirs = ProjectDirs::from("com", "terminus", "terminus")
        .context("failed to resolve OS config directory")?;
    Ok(dirs.config_dir().join("config.yaml"))
}

pub fn default_project_config_path(workspace: &Path) -> PathBuf {
    workspace.join(".terminus.yaml")
}

pub fn load_app_config() -> Result<AppConfig> {
    let path = app_config_path()?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let raw = fs::read_to_string(&path)
        .with_context(|| format!("failed reading app config at {}", path.display()))?;
    let cfg: AppConfig = serde_yaml::from_str(&raw)
        .with_context(|| format!("failed parsing app config at {}", path.display()))?;
    Ok(cfg)
}

pub fn load_project_config(workspace: &Path) -> Result<ProjectConfig> {
    let path = default_project_config_path(workspace);
    if !path.exists() {
        return Ok(ProjectConfig::default());
    }
    let raw = fs::read_to_string(&path)
        .with_context(|| format!("failed reading project config at {}", path.display()))?;
    let cfg: ProjectConfig = serde_yaml::from_str(&raw)
        .with_context(|| format!("failed parsing project config at {}", path.display()))?;
    Ok(cfg)
}

pub fn resolve_effective_config(workspace: &Path) -> Result<EffectiveConfig> {
    let app = load_app_config()?;
    let project = load_project_config(workspace)?;

    let provider_name = project
        .provider
        .or_else(|| env::var("TERMINUS_PROVIDER").ok())
        .unwrap_or_else(|| app.default_provider.clone());

    let mut provider = app
        .providers
        .get(&provider_name)
        .cloned()
        .with_context(|| format!("provider {} not found in app config", provider_name))?;

    if let Some(model) = project.model.or_else(|| env::var("TERMINUS_MODEL").ok()) {
        provider.model = model;
    }
    if let Some(base_url) = project
        .base_url
        .or_else(|| env::var("TERMINUS_BASE_URL").ok())
    {
        provider.base_url = base_url;
    }
    if let Some(api_key_env) = project
        .api_key_env
        .or_else(|| env::var("TERMINUS_API_KEY_ENV").ok())
    {
        provider.api_key_env = api_key_env;
    }

    let git_mode = project.git_mode.unwrap_or_else(|| app.git.mode.clone());

    Ok(EffectiveConfig {
        provider_name,
        provider,
        mcp_default_policy: app.mcp_default_policy,
        monitoring_retention_days: app.monitoring_retention_days,
        git_mode,
    })
}

pub fn ensure_app_config_exists() -> Result<PathBuf> {
    let path = app_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed creating app config dir {}", parent.display()))?;
    }
    if !path.exists() {
        let default_cfg = AppConfig::default();
        let raw = serde_yaml::to_string(&default_cfg)?;
        fs::write(&path, raw)
            .with_context(|| format!("failed writing app config at {}", path.display()))?;
    }
    Ok(path)
}
