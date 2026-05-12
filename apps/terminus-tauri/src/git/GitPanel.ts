import { getGitStatus, runGitOp } from "../ipc/bridge";
import "./git.css";

interface ParsedStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export class GitPanel {
  private el: HTMLElement;
  private workspace = ".";

  constructor(el: HTMLElement) {
    this.el = el;
    this.renderEmpty();
  }

  setWorkspace(workspace: string): void {
    this.workspace = workspace;
  }

  async load(): Promise<void> {
    if (!this.workspace || this.workspace === ".") {
      this.renderEmpty();
      return;
    }

    this.el.innerHTML = `<div class="gitpanel"><div class="gitpanel__loading">Loading git status...</div></div>`;

    try {
      const repoRoot = (await runGitOp(this.workspace, "rev-parse --show-toplevel")).trim();
      const [status, short] = await Promise.all([
        getGitStatus(repoRoot),
        runGitOp(repoRoot, "status --short"),
      ]);
      const [remoteRaw, userNameRaw, userEmailRaw] = await Promise.all([
        runGitOp(repoRoot, "remote -v"),
        runGitOp(repoRoot, "config --get user.name").catch(() => ""),
        runGitOp(repoRoot, "config --get user.email").catch(() => ""),
      ]);

      const userName = userNameRaw.trim() || "(not set)";
      const userEmail = userEmailRaw.trim() || "(not set)";
      const remotes = remoteRaw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 6)
        .map((line) => `<li class="gitpanel__item">${escHtml(line)}</li>`)
        .join("");

      const lines = short
        .split("\n")
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .slice(0, 200);

      const parsed = parseStatusLines(lines);
      const stagedList = renderStatusGroup(parsed.staged, "No staged changes", "gitpanel__item--staged");
      const unstagedList = renderStatusGroup(parsed.unstaged, "No unstaged changes", "gitpanel__item--unstaged");
      const untrackedList = renderStatusGroup(parsed.untracked, "No untracked files", "gitpanel__item--untracked");

      this.el.innerHTML = `
        <div class="gitpanel">
          <div class="gitpanel__summary">
            <div class="gitpanel__branch"><strong>${escHtml(status.branch || "-")}</strong></div>
            <div class="gitpanel__chips">
              <span class="gitpanel__chip">Ahead ${status.ahead}</span>
              <span class="gitpanel__chip">Behind ${status.behind}</span>
              <span class="gitpanel__chip">Modified ${status.modified}</span>
              <span class="gitpanel__chip">Untracked ${status.untracked}</span>
            </div>
            <div class="gitpanel__meta">Repo: ${escHtml(repoRoot)}</div>
            <div class="gitpanel__meta">Git user: ${escHtml(userName)} &lt;${escHtml(userEmail)}&gt;</div>
          </div>
          <div class="gitpanel__legend">
            <span class="gitpanel__legend-badge gitpanel__legend-badge--staged">&#9646;</span> Staged &nbsp;
            <span class="gitpanel__legend-badge gitpanel__legend-badge--unstaged">&#9646;</span> Unstaged &nbsp;
            <span class="gitpanel__legend-badge gitpanel__legend-badge--untracked">&#9646;</span> Untracked
          </div>

          <div class="gitpanel__section-title">Staged</div>
          <ul class="gitpanel__list gitpanel__list--section">${stagedList}</ul>

          <div class="gitpanel__section-title">Unstaged</div>
          <ul class="gitpanel__list gitpanel__list--section">${unstagedList}</ul>

          <div class="gitpanel__section-title">Untracked</div>
          <ul class="gitpanel__list gitpanel__list--section">${untrackedList}</ul>

          <div class="gitpanel__section-title">Remotes</div>
          <ul class="gitpanel__list gitpanel__list--compact">${remotes || `<li class="gitpanel__item gitpanel__item--clean">No remotes configured</li>`}</ul>
          <div class="gitpanel__footer">
            <button class="gitpanel__refresh" id="git-refresh">Refresh</button>
          </div>
        </div>
      `;

      this.el.querySelector("#git-refresh")?.addEventListener("click", () => {
        void this.load();
      });
    } catch (e) {
      this.el.innerHTML = `<div class="gitpanel"><div class="gitpanel__error">Folder active bukan repository git, atau git belum terpasang/configured.</div></div>`;
    }
  }

  private renderEmpty(): void {
    this.el.innerHTML = `<div class="gitpanel"><div class="gitpanel__empty">Open a project to see git tracker.</div></div>`;
  }
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function parseStatusLines(lines: string[]): ParsedStatus {
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of lines) {
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    const file = line.slice(3).trim() || line;

    if (x === "?" && y === "?") {
      untracked.push(`?? ${file}`);
      continue;
    }
    if (x !== " ") {
      staged.push(`${x} ${file}`);
    }
    if (y !== " ") {
      unstaged.push(`${y} ${file}`);
    }
  }

  return { staged, unstaged, untracked };
}

function renderStatusGroup(items: string[], emptyText: string, cls: string): string {
  if (items.length === 0) {
    return `<li class="gitpanel__item gitpanel__item--clean">${escHtml(emptyText)}</li>`;
  }
  return items.map((line) => `<li class="gitpanel__item ${cls}">${escHtml(line)}</li>`).join("");
}
