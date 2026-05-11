use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AskResponse {
    pub content: String,
    pub from_cache: bool,
    pub estimated_input_tokens: usize,
    pub estimated_output_tokens: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoringEvent {
    pub timestamp: String,
    pub workspace: String,
    pub provider: String,
    pub model: String,
    pub prompt_chars: usize,
    pub response_chars: usize,
    pub est_input_tokens: usize,
    pub est_output_tokens: usize,
    pub from_cache: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorSummary {
    pub total_runs: usize,
    pub cache_hits: usize,
    pub total_input_tokens: usize,
    pub total_output_tokens: usize,
}
