import { getMonitoringSummary, getSystemStats, getGitStatus } from "../ipc/bridge";
import { getLastActivity, onActivityChanged, type ActivitySnapshot } from "./ActivityMonitor";
import "./status.css";

export class StatusBar {
  private el: HTMLElement;
  private updateInterval?: number;
  private currentWorkspace: string = ".";
  private gitInterval?: number;
  private monitorInterval?: number;
  private unsubscribeActivity?: () => void;

  constructor(el: HTMLElement) {
    this.el = el;
    this.el.innerHTML = `
      <div class="statusbar">
        <span class="statusbar__brand">⚡ Terminus</span>
        <span class="statusbar__monitor" id="status-monitor"></span>
        <span class="statusbar__right" id="status-right"></span>
      </div>
    `;

    this.renderActivity(getLastActivity());
    this.unsubscribeActivity = onActivityChanged((snapshot) => this.renderActivity(snapshot));
    
    // Start updating system stats every 2 seconds
    this.updateSystemStats();
    this.updateInterval = window.setInterval(() => this.updateSystemStats(), 2000);
    
    // Update git status every 3 seconds
    this.updateGitStatus();
    this.gitInterval = window.setInterval(() => this.updateGitStatus(), 3000);

    // Update usage summary every 5 seconds
    this.updateMonitoringSummary();
    this.monitorInterval = window.setInterval(() => this.updateMonitoringSummary(), 5000);
  }

  private async updateSystemStats(): Promise<void> {
    try {
      const stats = await getSystemStats();
      const right = this.el.querySelector("#status-right");
      if (right) {
        const cpuBar = this.getBar(stats.cpu_percent);
        const memBar = this.getBar(stats.memory_percent);
        
        let html = `
          <span class="statusbar__item statusbar__item--cpu" title="CPU Usage">
            CPU ${cpuBar} ${stats.cpu_percent.toFixed(0)}%
          </span>
          <span class="statusbar__item statusbar__item--mem" title="Memory Usage">
            RAM ${memBar} ${stats.memory_used_gb.toFixed(1)}G/${stats.memory_total_gb.toFixed(1)}G
          </span>
        `;
        
        if (stats.gpu_percent !== null && stats.gpu_percent > 0) {
          const gpuBar = this.getBar(stats.gpu_percent);
          html += `
            <span class="statusbar__item statusbar__item--gpu" title="GPU Usage">
              GPU ${gpuBar} ${stats.gpu_percent.toFixed(0)}%
            </span>
          `;
        }
        
        // Preserve git status if it exists
        const gitItem = right.querySelector(".statusbar__item--git");
        if (gitItem) {
          html += gitItem.outerHTML;
        }
        
        right.innerHTML = html;
      }
    } catch {
      // Silently skip on error
    }
  }

  private async updateGitStatus(): Promise<void> {
    try {
      const status = await getGitStatus(this.currentWorkspace);
      const right = this.el.querySelector("#status-right");
      if (right) {
        let gitHtml = `<span class="statusbar__item statusbar__item--git" title="Git Status">`;
        
        if (status.branch === "no git") {
          gitHtml += `📁 no git`;
        } else {
          gitHtml += `🌿 ${status.branch}`;
          
          if (status.ahead > 0) {
            gitHtml += ` ↑${status.ahead}`;
          }
          if (status.behind > 0) {
            gitHtml += ` ↓${status.behind}`;
          }
          if (status.modified > 0 || status.untracked > 0) {
            gitHtml += ` ●${status.modified + status.untracked}`;
          }
        }
        
        gitHtml += `</span>`;
        
        // Remove old git item if exists
        const oldGitItem = right.querySelector(".statusbar__item--git");
        if (oldGitItem) {
          oldGitItem.remove();
        }
        
        // Append git status to right
        right.innerHTML += gitHtml;
      }
    } catch {
      // Silently skip on error
    }
  }

  private async updateMonitoringSummary(): Promise<void> {
    try {
      const summary = await getMonitoringSummary(this.currentWorkspace);
      const monitor = this.el.querySelector<HTMLElement>("#status-monitor");
      if (!monitor) return;

      const existing = monitor.innerHTML;
      const usageText = `Runs ${summary.total_runs} | Cache ${summary.cache_hit_rate_pct.toFixed(0)}%`;
      if (existing.includes("statusbar__monitor-usage")) {
        monitor.innerHTML = existing.replace(/<span class="statusbar__monitor-usage">[^<]*<\/span>/, `<span class="statusbar__monitor-usage">${usageText}</span>`);
      } else {
        monitor.innerHTML += ` <span class="statusbar__monitor-usage">${usageText}</span>`;
      }
    } catch {
      // Ignore monitoring summary failures.
    }
  }

  private renderActivity(activity: ActivitySnapshot): void {
    const monitor = this.el.querySelector<HTMLElement>("#status-monitor");
    if (!monitor) return;
    const time = new Date(activity.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    monitor.innerHTML = `
      <span class="statusbar__monitor-item" title="Current skill pipeline">Skill ${activity.skill}</span>
      <span class="statusbar__monitor-item" title="Latest tool usage">Tool ${activity.tool}</span>
      <span class="statusbar__monitor-item" title="Latest activity detail">${activity.detail}</span>
      <span class="statusbar__monitor-item" title="Workspace context">WS ${activity.workspace.split("/").filter(Boolean).pop() ?? activity.workspace}</span>
      <span class="statusbar__monitor-item" title="Last update time">${time}</span>
    `;
  }

  private getBar(percent: number): string {
    const filled = Math.round(percent / 10);
    const empty = 10 - filled;
    return "█".repeat(filled) + "░".repeat(empty);
  }

  async refreshStats(workspace: string): Promise<void> {
    this.currentWorkspace = workspace;
    try {
      const s = await getMonitoringSummary(workspace);
      const right = this.el.querySelector("#status-right");
      if (right) {
        const current = right.innerHTML;
        // Append monitoring stats to system stats
        right.innerHTML =
          current +
          ` · Runs: ${s.total_runs} · Cache: ${s.cache_hit_rate_pct.toFixed(0)}%`;
      }
    } catch {
      // Silently skip
    }
    
    // Immediately update git status when workspace changes
    this.updateGitStatus();
  }

  setWorkspace(workspace: string): void {
    this.currentWorkspace = workspace;
    void this.updateGitStatus();
    void this.updateMonitoringSummary();
  }

  destroy(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    if (this.gitInterval) {
      clearInterval(this.gitInterval);
    }
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
    this.unsubscribeActivity?.();
  }
}
