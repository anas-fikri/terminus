use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{Emitter, Window};
use terminus_core::{config, runtime, state::AiState};

#[derive(Debug, Deserialize)]
pub struct AskParams {
    pub workspace: Option<String>,
    pub prompt: String,
    pub model: Option<String>,
    pub api_key: Option<String>,
    pub use_cache: Option<bool>,
    pub api_key_override: Option<String>,
    pub base_url_override: Option<String>,
    pub model_override: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AskResult {
    pub content: String,
    pub from_cache: bool,
    pub estimated_input_tokens: usize,
    pub estimated_output_tokens: usize,
}

/// Run an AI ask request. Emits `ai_state_changed` events to the window during processing.
#[tauri::command]
pub async fn run_ask(window: Window, params: AskParams) -> Result<AskResult, String> {
    let workspace = params.workspace.as_deref().unwrap_or(".");
    let cfg = config::resolve_effective_config(Path::new(workspace)).map_err(|e| e.to_string())?;

    let win = window.clone();
    let on_state = move |s: AiState| {
        let _ = win.emit("ai_state_changed", s.as_str());
    };

    // Merge api_key: prefer api_key_override, fallback to api_key
    let effective_key = params.api_key_override.as_deref().or(params.api_key.as_deref());
    let effective_model = params.model_override.as_deref().or(params.model.as_deref());

    let resp = runtime::ask(
        Path::new(workspace),
        &cfg,
        &params.prompt,
        effective_model,
        effective_key,
        params.base_url_override.as_deref(),
        params.use_cache.unwrap_or(true),
        on_state,
    )
    .await
    .map_err(|e| e.to_string())?;

    // Signal done
    let _ = window.emit("ai_state_changed", AiState::Done.as_str());

    Ok(AskResult {
        content: resp.content,
        from_cache: resp.from_cache,
        estimated_input_tokens: resp.estimated_input_tokens,
        estimated_output_tokens: resp.estimated_output_tokens,
    })
}

/// Placeholder – future: cancel an in-flight inference via AbortHandle
#[tauri::command]
pub async fn cancel_run() -> Result<(), String> {
    // TODO: wire up tokio CancellationToken when streaming is added
    Ok(())
}
