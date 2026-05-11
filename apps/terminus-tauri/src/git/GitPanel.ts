import { getGitStatus, runGitOp } from "../ipc/bridge";
import "./git.css";

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

      const list = lines.length
        ? lines.map((line) => `<li class="gitpanel__item">${escHtml(line)}</li>`).join("")
        : `<li class="gitpanel__item gitpanel__item--clean">Working tree clean</li>`;

      this.el.innerHTML = `
        <div class="gitpanel">
          <div class="gitpanel__summary">
            <div><strong>${escHtml(status.branch || "-")}</strong></div>
            <div class="gitpanel__meta">+${status.ahead} / -${status.behind} · modified ${status.modified} · untracked ${status.untracked}</div>
            <div class="gitpanel__meta">Repo: ${escHtml(repoRoot)}</div>
            <div class="gitpanel__meta">Git user: ${escHtml(userName)} &lt;${escHtml(userEmail)}&gt;</div>
          </div>
          <div class="gitpanel__section-title">Changed files</div>
          <ul class="gitpanel__list">${list}</ul>
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
