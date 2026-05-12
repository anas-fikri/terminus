import { onAiStateChanged, type AiStateValue } from "../ipc/bridge";
import {
  getLastActivity,
  onActivityChanged,
  trackActivity,
  type ActivitySnapshot,
} from "../status/ActivityMonitor";
import "./activity.css";

const MAX_LOG = 80;

/** Human-readable label for AI states */
const AI_STATE_LABELS: Record<AiStateValue, string> = {
  loading:   "Menyiapkan…",
  working:   "Mengecek cache…",
  thinking:  "AI sedang berpikir…",
  streaming: "AI menerima jawaban…",
  done:      "Selesai",
  error:     "Error",
};

/** Status badge class per AI state */
const AI_STATE_CLASS: Record<AiStateValue, string> = {
  loading:   "activity-panel__ai--loading",
  working:   "activity-panel__ai--loading",
  thinking:  "activity-panel__ai--thinking",
  streaming: "activity-panel__ai--streaming",
  done:      "activity-panel__ai--done",
  error:     "activity-panel__ai--error",
};

export class ActivityPanel {
  private el: HTMLElement;
  private log: ActivitySnapshot[] = [];
  private currentAiState: AiStateValue = "done";
  private unlisten: Array<() => void> = [];

  constructor(el: HTMLElement) {
    this.el = el;
    this.render();

    // Seed with last known activity
    const last = getLastActivity();
    if (last.tool !== "startup") {
      this.log.push(last);
    }

    // Subscribe to activity changes
    this.unlisten.push(
      onActivityChanged((snapshot) => {
        this.log.push(snapshot);
        if (this.log.length > MAX_LOG) this.log.shift();
        this.renderLog();
      })
    );

    // Subscribe to AI state changes
    void onAiStateChanged((state) => {
      this.currentAiState = state;
      this.renderAiState();
    }).then((unsub) => {
      this.unlisten.push(unsub);
    });
  }

  destroy(): void {
    for (const fn of this.unlisten) fn();
  }

  /** Manually record a PTY-level command (called from TerminalPane) */
  static trackCommand(command: string, workspace: string): void {
    const shortCmd = command.trim().slice(0, 80);
    const tool = detectToolFromCommand(shortCmd);
    trackActivity({
      skill: "terminal",
      tool,
      detail: shortCmd,
      workspace,
    });
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="activity-panel">
        <div class="activity-panel__header">
          <span class="activity-panel__title">ACTIVITY</span>
          <button class="activity-panel__clear" id="activity-clear" title="Clear log">Clear</button>
        </div>
        <div class="activity-panel__ai-bar" id="activity-ai-bar"></div>
        <div class="activity-panel__log" id="activity-log"></div>
      </div>
    `;

    this.el.querySelector("#activity-clear")?.addEventListener("click", () => {
      this.log = [];
      this.renderLog();
    });

    this.renderAiState();
    this.renderLog();
  }

  private renderAiState(): void {
    const bar = this.el.querySelector<HTMLElement>("#activity-ai-bar");
    if (!bar) return;
    const state = this.currentAiState;
    const label = AI_STATE_LABELS[state] ?? state;
    const cls = AI_STATE_CLASS[state] ?? "";
    const isActive = state !== "done" && state !== "error";

    bar.innerHTML = `
      <span class="activity-panel__ai-dot ${cls} ${isActive ? "activity-panel__ai-dot--pulse" : ""}"></span>
      <span class="activity-panel__ai-label">AI: ${label}</span>
    `;
  }

  private renderLog(): void {
    const container = this.el.querySelector<HTMLElement>("#activity-log");
    if (!container) return;

    if (this.log.length === 0) {
      container.innerHTML = `<div class="activity-panel__empty">Belum ada aktivitas tercatat.</div>`;
      return;
    }

    // Render newest first
    const items = [...this.log].reverse().map((snap) => {
      const time = new Date(snap.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const ws = snap.workspace.split("/").filter(Boolean).pop() ?? snap.workspace;
      return `
        <div class="activity-panel__item">
          <div class="activity-panel__item-meta">
            <span class="activity-panel__badge activity-panel__badge--skill">${escHtml(snap.skill)}</span>
            <span class="activity-panel__badge activity-panel__badge--tool">${escHtml(snap.tool)}</span>
            <span class="activity-panel__item-ws" title="${escHtml(snap.workspace)}">${escHtml(ws)}</span>
            <span class="activity-panel__item-time">${time}</span>
          </div>
          <div class="activity-panel__item-detail" title="${escHtml(snap.detail)}">${escHtml(snap.detail)}</div>
        </div>
      `;
    });

    container.innerHTML = items.join("");
  }
}

// ── Heuristics to map terminal commands to tool names ──

const TOOL_PATTERNS: Array<[RegExp, string]> = [
  [/^git\s/,                        "git"],
  [/^docker\s/,                     "docker"],
  [/^kubectl\s|^k\s/,               "kubectl"],
  [/^npm\s|^npx\s|^pnpm\s|^yarn\s/, "node-pkg-manager"],
  [/^cargo\s/,                      "cargo"],
  [/^python[23]?\s|^pip[23]?\s/,    "python"],
  [/^ssh\s/,                        "ssh"],
  [/^curl\s|^wget\s/,               "http-client"],
  [/^cat\s|^less\s|^more\s/,        "file-read"],
  [/^ls\s|^ll\s|^dir\s/,            "file-list"],
  [/^mv\s|^cp\s|^rm\s|^mkdir\s/,    "file-ops"],
  [/^grep\s|^rg\s|^ag\s/,           "search"],
  [/^vim\s|^nano\s|^code\s/,        "editor"],
  [/^make\s|^cmake\s/,              "build"],
];

function detectToolFromCommand(cmd: string): string {
  const lower = cmd.toLowerCase();
  for (const [pattern, tool] of TOOL_PATTERNS) {
    if (pattern.test(lower)) return tool;
  }
  const first = cmd.split(/\s+/)[0] ?? cmd;
  return first.slice(0, 20) || "shell";
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
