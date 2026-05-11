use crate::cache;
use crate::config::EffectiveConfig;
use crate::monitoring::{append_event, estimate_tokens, now_rfc3339};
use crate::provider;
use crate::state::AiState;
use crate::types::{AskResponse, MonitoringEvent};
use anyhow::Result;
use std::path::Path;

fn normalize_prompt(prompt: &str) -> String {
    prompt
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

pub async fn ask(
    workspace: &Path,
    cfg: &EffectiveConfig,
    prompt: &str,
    model_override: Option<&str>,
    api_key_override: Option<&str>,
    base_url_override: Option<&str>,
    use_cache: bool,
    mut on_state: impl FnMut(AiState),
) -> Result<AskResponse> {
    on_state(AiState::Loading);
    let optimized_prompt = normalize_prompt(prompt);
    let model_for_cache = model_override.unwrap_or(&cfg.provider.model).to_string();

    if use_cache {
        on_state(AiState::Working);
        if let Some(hit) = cache::get(workspace, &model_for_cache, &optimized_prompt)? {
            on_state(AiState::Done);
            let input_tokens = estimate_tokens(&optimized_prompt);
            let output_tokens = estimate_tokens(&hit);
            append_event(
                workspace,
                &MonitoringEvent {
                    timestamp: now_rfc3339(),
                    workspace: workspace.display().to_string(),
                    provider: cfg.provider_name.clone(),
                    model: model_for_cache,
                    prompt_chars: optimized_prompt.chars().count(),
                    response_chars: hit.chars().count(),
                    est_input_tokens: input_tokens,
                    est_output_tokens: output_tokens,
                    from_cache: true,
                },
            )?;
            return Ok(AskResponse {
                content: hit,
                from_cache: true,
                estimated_input_tokens: input_tokens,
                estimated_output_tokens: output_tokens,
            });
        }
    }

    on_state(AiState::Thinking);
    let resp = provider::chat_completion(&cfg.provider, &optimized_prompt, model_override, api_key_override, base_url_override)
        .await?;
    on_state(AiState::Streaming);

    if use_cache {
        cache::put(workspace, &model_for_cache, &optimized_prompt, &resp.content)?;
    }

    let input_tokens = resp
        .prompt_tokens
        .unwrap_or_else(|| estimate_tokens(&optimized_prompt));
    let output_tokens = resp
        .completion_tokens
        .unwrap_or_else(|| estimate_tokens(&resp.content));

    append_event(
        workspace,
        &MonitoringEvent {
            timestamp: now_rfc3339(),
            workspace: workspace.display().to_string(),
            provider: cfg.provider_name.clone(),
            model: model_for_cache,
            prompt_chars: optimized_prompt.chars().count(),
            response_chars: resp.content.chars().count(),
            est_input_tokens: input_tokens,
            est_output_tokens: output_tokens,
            from_cache: false,
        },
    )?;

    on_state(AiState::Done);
    Ok(AskResponse {
        content: resp.content,
        from_cache: false,
        estimated_input_tokens: input_tokens,
        estimated_output_tokens: output_tokens,
    })
}
