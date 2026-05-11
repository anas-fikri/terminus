use crate::types::{MonitorSummary, MonitoringEvent};
use anyhow::{Context, Result};
use chrono::Utc;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

fn events_path(workspace: &Path) -> PathBuf {
    workspace.join(".terminus").join("monitoring.events.jsonl")
}

pub fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

pub fn append_event(workspace: &Path, event: &MonitoringEvent) -> Result<()> {
    let path = events_path(workspace);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed creating monitoring dir {}", parent.display()))?;
    }

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .with_context(|| format!("failed opening monitoring file {}", path.display()))?;

    let line = serde_json::to_string(event)?;
    writeln!(file, "{}", line)?;
    Ok(())
}

pub fn read_summary(workspace: &Path) -> Result<MonitorSummary> {
    let path = events_path(workspace);
    if !path.exists() {
        return Ok(MonitorSummary {
            total_runs: 0,
            cache_hits: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
        });
    }

    let file = fs::File::open(&path)
        .with_context(|| format!("failed opening monitoring file {}", path.display()))?;
    let reader = BufReader::new(file);

    let mut summary = MonitorSummary {
        total_runs: 0,
        cache_hits: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
    };

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(event) = serde_json::from_str::<MonitoringEvent>(&line) {
            summary.total_runs += 1;
            if event.from_cache {
                summary.cache_hits += 1;
            }
            summary.total_input_tokens += event.est_input_tokens;
            summary.total_output_tokens += event.est_output_tokens;
        }
    }

    Ok(summary)
}

pub fn estimate_tokens(content: &str) -> usize {
    content.chars().count().div_ceil(4)
}
