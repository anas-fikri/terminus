use serde::{Deserialize, Serialize};
use sysinfo::System;

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemStats {
    pub cpu_percent: f32,
    pub memory_used_gb: f32,
    pub memory_total_gb: f32,
    pub memory_percent: f32,
    pub gpu_percent: Option<f32>,
}

#[tauri::command]
pub fn get_system_stats() -> Result<SystemStats, String> {
    let mut sys = System::new_all();
    sys.refresh_all();

    let total_memory = sys.total_memory() as f32 / (1024.0 * 1024.0 * 1024.0); // Convert to GB
    let used_memory = sys.used_memory() as f32 / (1024.0 * 1024.0 * 1024.0);
    let memory_percent = (used_memory / total_memory * 100.0).min(100.0);

    // Get CPU usage (average across all cores)
    let cpu_percent = sys
        .cpus()
        .iter()
        .map(|cpu| cpu.cpu_usage())
        .sum::<f32>()
        / sys.cpus().len() as f32;

    // GPU detection would require platform-specific code
    // For now, return None
    let gpu_percent = None;

    Ok(SystemStats {
        cpu_percent,
        memory_used_gb: used_memory,
        memory_total_gb: total_memory,
        memory_percent,
        gpu_percent,
    })
}
