use crate::config::ProviderConfig;
use crate::types::ChatMessage;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct Usage {
    prompt_tokens: Option<usize>,
    completion_tokens: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
    usage: Option<Usage>,
}

#[derive(Debug, Clone)]
pub struct ProviderResponse {
    pub content: String,
    pub prompt_tokens: Option<usize>,
    pub completion_tokens: Option<usize>,
}

pub async fn chat_completion(
    provider: &ProviderConfig,
    prompt: &str,
    model_override: Option<&str>,
    api_key_override: Option<&str>,
    base_url_override: Option<&str>,
) -> Result<ProviderResponse> {
    let api_key = api_key_override
        .map(ToOwned::to_owned)
        .or_else(|| std::env::var(&provider.api_key_env).ok())
        .with_context(|| {
            format!(
                "missing API key: set env {} or pass --api-key",
                provider.api_key_env
            )
        })?;

    let payload = ChatRequest {
        model: model_override.unwrap_or(&provider.model).to_string(),
        messages: vec![ChatMessage {
            role: "user".to_string(),
            content: prompt.to_string(),
        }],
        stream: false,
    };

    let base_url = base_url_override.unwrap_or(&provider.base_url);
    let client = reqwest::Client::new();
    let resp = client
        .post(base_url)
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
        .with_context(|| format!("request failed to {}", base_url))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp
            .text()
            .await
            .unwrap_or_else(|_| "<unable to read error body>".to_string());
        anyhow::bail!("provider returned {}: {}", status, body);
    }

    let data = resp
        .json::<ChatResponse>()
        .await
        .context("failed to parse provider response")?;

    let content = data
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .context("provider response has no choices[0].message.content")?;

    Ok(ProviderResponse {
        content,
        prompt_tokens: data.usage.as_ref().and_then(|u| u.prompt_tokens),
        completion_tokens: data.usage.as_ref().and_then(|u| u.completion_tokens),
    })
}
