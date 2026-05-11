import { open } from "@tauri-apps/plugin-dialog";
import "./projectpicker.css";

export type ProjectSelectedCallback = (path: string) => void;

export class ProjectPicker {
  private el: HTMLElement;
  private onSelect: ProjectSelectedCallback;
  private recentPaths: string[] = [];
  private visible = false;

  constructor(el: HTMLElement, onSelect: ProjectSelectedCallback) {
    this.el = el;
    this.onSelect = onSelect;
    this.recentPaths = this.loadRecents();
    this.mount();
  }

  private mount(): void {
    this.el.innerHTML = `
      <div class="picker-backdrop" id="picker-backdrop" style="display:none">
        <div class="picker-modal" role="dialog" aria-modal="true" aria-label="Open Project">
          <div class="picker-header">
            <span class="picker-title">Open Project</span>
            <button class="picker-close" id="picker-close">✕</button>
          </div>

          <div class="picker-body">
            <button class="picker-folder-btn" id="picker-browse">
              <span class="picker-folder-icon">📁</span>
              <div>
                <div class="picker-folder-label">Browse folder…</div>
                <div class="picker-folder-sub">Open native folder picker</div>
              </div>
            </button>

            <div class="picker-divider"><span>or type a path</span></div>

            <div class="picker-input-row">
              <input class="picker-input" id="picker-input" type="text"
                placeholder="/Users/you/my-project" />
              <button class="picker-open-btn" id="picker-open">Open</button>
            </div>

            <div class="picker-recents" id="picker-recents">
              <div class="picker-recents-title">Recent</div>
              <div id="picker-recents-list"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    const backdrop = this.el.querySelector<HTMLElement>("#picker-backdrop")!;
    const inputEl = this.el.querySelector<HTMLInputElement>("#picker-input")!;

    this.el.querySelector("#picker-close")!.addEventListener("click", () => this.hide());
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) this.hide(); });

    this.el.querySelector("#picker-browse")!.addEventListener("click", async () => {
      const result = await open({ directory: true, multiple: false, title: "Select project folder" });
      if (result) this.select(result as string);
    });

    this.el.querySelector("#picker-open")!.addEventListener("click", () => {
      if (inputEl.value.trim()) this.select(inputEl.value.trim());
    });

    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && inputEl.value.trim()) this.select(inputEl.value.trim());
      if (e.key === "Escape") this.hide();
    });

    this.renderRecents();
  }

  show(): void {
    this.visible = true;
    const backdrop = this.el.querySelector<HTMLElement>("#picker-backdrop")!;
    backdrop.style.display = "flex";
    this.el.querySelector<HTMLInputElement>("#picker-input")?.focus();
  }

  hide(): void {
    this.visible = false;
    (this.el.querySelector<HTMLElement>("#picker-backdrop")!).style.display = "none";
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  private select(path: string): void {
    this.addRecent(path);
    this.renderRecents();
    this.hide();
    this.onSelect(path);
  }

  private renderRecents(): void {
    const list = this.el.querySelector<HTMLElement>("#picker-recents-list")!;
    const wrap = this.el.querySelector<HTMLElement>("#picker-recents")!;

    if (this.recentPaths.length === 0) {
      wrap.style.display = "none";
      return;
    }
    wrap.style.display = "";
    list.innerHTML = this.recentPaths
      .map(
        (p) => `
        <button class="picker-recent-item" data-path="${escHtml(p)}">
          <span class="picker-recent-icon">📂</span>
          <div class="picker-recent-info">
            <div class="picker-recent-name">${escHtml(basename(p))}</div>
            <div class="picker-recent-path">${escHtml(p)}</div>
          </div>
        </button>`
      )
      .join("");

    list.querySelectorAll<HTMLButtonElement>(".picker-recent-item").forEach((btn) => {
      btn.addEventListener("click", () => this.select(btn.dataset.path!));
    });
  }

  private addRecent(path: string): void {
    this.recentPaths = [path, ...this.recentPaths.filter((p) => p !== path)].slice(0, 8);
    try { localStorage.setItem("terminus-recent-projects", JSON.stringify(this.recentPaths)); } catch { /* ignore */ }
  }

  private loadRecents(): string[] {
    try {
      const raw = localStorage.getItem("terminus-recent-projects");
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch { return []; }
  }
}

function basename(p: string): string {
  return p.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? p;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
