import { open } from "@tauri-apps/plugin-dialog";
import { icon } from "../utils/icons";
import "./projectspanel.css";

export type ProjectSelectedCallback = (path: string) => void;

const STORAGE_KEY = "terminus-recent-projects";
const MAX_RECENTS = 10;

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

export class ProjectsPanel {
  private el: HTMLElement;
  private onSelect: ProjectSelectedCallback;
  private recents: string[] = [];
  private activeProject = "";

  constructor(el: HTMLElement, onSelect: ProjectSelectedCallback) {
    this.el = el;
    this.onSelect = onSelect;
    this.recents = this.loadRecents();
    this.mount();
  }

  private mount(): void {
    this.el.innerHTML = `
      <div class="pp">
        <div class="pp__header">
          <span class="pp__title">PROJECTS</span>
          <button class="pp__open-btn" id="pp-open" title="Open folder">${icon("plus", 14)}</button>
        </div>
        <div class="pp__list" id="pp-list"></div>
        <div class="pp__footer">
          <button class="pp__browse-btn" id="pp-browse">${icon("browse", 12)} Browse folder…</button>
        </div>
      </div>
    `;

    this.el.querySelector("#pp-open")!.addEventListener("click", () => this.browse());
    this.el.querySelector("#pp-browse")!.addEventListener("click", () => this.browse());

    this.renderList();
  }

  private async browse(): Promise<void> {
    const result = await open({ directory: true, multiple: false, title: "Select project folder" });
    if (result) this.select(result as string);
  }

  async browsePicker(): Promise<void> {
    return this.browse();
  }

  private select(path: string): void {
    this.addRecent(path);
    this.activeProject = path;
    this.renderList();
    this.onSelect(path);
  }

  setActive(path: string): void {
    this.activeProject = path;
    if (path && !this.recents.includes(path)) {
      this.addRecent(path);
    }
    this.renderList();
  }

  private renderList(): void {
    const list = this.el.querySelector<HTMLElement>("#pp-list")!;
    if (this.recents.length === 0) {
      list.innerHTML = `<div class="pp__empty">No recent projects</div>`;
      return;
    }

    list.innerHTML = "";
    for (const p of this.recents) {
      const item = document.createElement("button");
      item.className = "pp__item" + (p === this.activeProject ? " pp__item--active" : "");
      item.title = p;
      item.innerHTML = `
        <span class="pp__item-icon">${p === this.activeProject ? icon("chevron-right", 10) : icon("folder", 10)}</span>
        <div class="pp__item-info">
          <div class="pp__item-name">${escHtml(basename(p))}</div>
          <div class="pp__item-path">${escHtml(p)}</div>
        </div>
      `;
      item.addEventListener("click", () => this.select(p));
      list.appendChild(item);
    }
  }

  private addRecent(path: string): void {
    this.recents = [path, ...this.recents.filter((p) => p !== path)].slice(0, MAX_RECENTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.recents));
  }

  private loadRecents(): string[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    } catch {
      return [];
    }
  }
}

function escHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
