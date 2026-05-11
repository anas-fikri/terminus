use serde::Serialize;
use std::path::Path;
use terminus_core::monitoring;

#[derive(Debug, Serialize)]
pub struct MonitoringSummaryResult {
    pub total_runs: usize,
    pub cache_hits: usize,
    pub total_input_tokens: usize,
    pub total_output_tokens: usize,
    pub cache_hit_rate_pct: f64,
}

/// Get aggregated monitoring stats for a workspace.
#[tauri::command]
pub fn get_monitoring_summary(workspace: String) -> Result<MonitoringSummaryResult, String> {
    let summary = monitoring::read_summary(Path::new(&workspace)).map_err(|e| e.to_string())?;
    let rate = if summary.total_runs > 0 {
        (summary.cache_hits as f64 / summary.total_runs as f64) * 100.0
    } else {
        0.0
    };
    Ok(MonitoringSummaryResult {
        total_runs: summary.total_runs,
        cache_hits: summary.cache_hits,
        total_input_tokens: summary.total_input_tokens,
        total_output_tokens: summary.total_output_tokens,
        cache_hit_rate_pct: rate,
    })
}
