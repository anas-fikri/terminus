import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as shellOpen } from "@tauri-apps/plugin-shell";

// ────────── Types ──────────

export interface AskParams {
  workspace?: string;
  prompt: string;
  model?: string;
  api_key?: string;
  use_cache?: boolean;
  api_key_override?: string;
  base_url_override?: string;
  model_override?: string;
}

export interface AskResult {
  content: string;
  from_cache: boolean;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
}

export interface ProjectInfo {
  path: string;
  name: string;
}

export interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: TreeNode[];
}

export interface MonitoringSummary {
  total_runs: number;
  cache_hits: number;
  total_input_tokens: number;
  total_output_tokens: number;
  cache_hit_rate_pct: number;
}

export interface SystemStats {
  cpu_percent: number;
  memory_used_gb: number;
  memory_total_gb: number;
  memory_percent: number;
  gpu_percent: number | null;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  modified: number;
  untracked: number;
}

export type AiStateValue =
  | "loading"
  | "working"
  | "thinking"
  | "streaming"
  | "done"
  | "error";

// ────────── AI Commands ──────────

export function runAsk(params: AskParams): Promise<AskResult> {
  return invoke("run_ask", { params });
}

export function cancelRun(): Promise<void> {
  return invoke("cancel_run");
}

// ────────── Project Commands ──────────

export function listProjects(): Promise<ProjectInfo[]> {
  return invoke("list_projects");
}

export function setActiveProject(path: string): Promise<void> {
  return invoke("set_active_project", { path });
}

export function getEffectiveSettings(workspace: string): Promise<unknown> {
  return invoke("get_effective_settings", { workspace });
}

export function updateAppSettings(settings: unknown): Promise<void> {
  return invoke("update_app_settings", { settings });
}

export function updateProjectSettings(workspace: string, settings: unknown): Promise<void> {
  return invoke("update_project_settings", { workspace, settings });
}

// ────────── Explorer ──────────

export function getTree(workspace: string): Promise<TreeNode> {
  return invoke("get_tree", { workspace });
}

// ────────── Git ──────────

export function runGitOp(workspace: string, subcommand: string): Promise<string> {
  return invoke("run_git_op", { params: { workspace, subcommand } });
}

export function getGitStatus(workspace: string): Promise<GitStatus> {
  return invoke("get_git_status", { workspace });
}

// ────────── Monitoring ──────────

export function getMonitoringSummary(workspace: string): Promise<MonitoringSummary> {
  return invoke("get_monitoring_summary", { workspace });
}

export function getSystemStats(): Promise<SystemStats> {
  return invoke("get_system_stats");
}

// ────────── Event Listeners ──────────

export function onAiStateChanged(
  cb: (state: AiStateValue) => void
): Promise<UnlistenFn> {
  return listen<AiStateValue>("ai_state_changed", (event) => cb(event.payload));
}

// ────────── Files ──────────

export function readFileContent(path: string): Promise<string> {
  return invoke("read_file_content", { path });
}

export function writeFileContent(path: string, content: string): Promise<void> {
  return invoke("write_file_content", { path, content });
}

export function getFileExt(path: string): Promise<string> {
  return invoke("get_file_ext", { path });
}

export function fetchRemoteHtml(url: string): Promise<string> {
  return invoke("fetch_remote_html", { url });
}

// ────────── Shell / System ──────────

/** Open a URL in the system's default browser */
export function openExternal(url: string): Promise<void> {
  return shellOpen(url);
}

// ────────── PTY Terminal ──────────

export function ptySpawn(sessionId: string, cwd?: string): Promise<void> {
  return invoke("pty_spawn", { sessionId, cwd });
}

export function ptyWrite(sessionId: string, data: string): Promise<void> {
  return invoke("pty_write", { sessionId, data });
}

export function ptyResize(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke("pty_resize", { sessionId, cols, rows });
}

export function ptyKill(sessionId: string): Promise<void> {
  return invoke("pty_kill", { sessionId });
}

export function onPtyData(
  sessionId: string,
  cb: (data: string) => void
): Promise<UnlistenFn> {
  return listen<string>(`pty://data/${sessionId}`, (e) => cb(e.payload));
}

export function onPtyExit(
  sessionId: string,
  cb: () => void
): Promise<UnlistenFn> {
  return listen(`pty://exit/${sessionId}`, () => cb());
}
