import type { Tab } from "./Shell";
import { icon } from "../utils/icons";
import "./tabbar.css";

export interface TabBarCallbacks {
  onActivate: (id: string) => void;
  onNew: () => void;
  onNewViewer: () => void;
  onNewBrowser: (url?: string) => void;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
  onOpenProject: () => void;
  onClose: (id: string) => void;
}

const TYPE_ICONS: Record<string, () => string> = {
  session: () => icon("terminal", 12),
  viewer: () => icon("file", 12),
  browser: () => icon("globe", 12),
};

export class TabBar {
  private el: HTMLElement;
  private callbacks: TabBarCallbacks;

  constructor(el: HTMLElement, callbacks: TabBarCallbacks) {
    this.el = el;
    this.callbacks = callbacks;
  }

  setTabs(tabs: Tab[], activeId: string, uiState?: { leftVisible: boolean; rightVisible: boolean }): void {
    this.el.innerHTML = `
      <div class="tabbar">
        <div class="tabbar__tabs" id="tabbar-tabs"></div>
        <div class="tabbar__actions">
          <button class="tabbar__action" id="tb-new-session" title="New Terminal">${icon("terminal")}</button>
          <button class="tabbar__action" id="tb-new-viewer"  title="New Viewer">${icon("file")}</button>
          <button class="tabbar__action" id="tb-new-browser" title="New Browser">${icon("globe")}</button>
          <div class="tabbar__sep"></div>
          <button class="tabbar__action ${uiState?.leftVisible === false ? "tabbar__action--off" : ""}" id="tb-left" title="Toggle left sidebar">${icon("folder")}</button>
          <button class="tabbar__action ${uiState?.rightVisible === false ? "tabbar__action--off" : ""}" id="tb-right" title="Toggle right sidebar">${icon("tree")}</button>
        </div>
      </div>
    `;

    const tabsEl = this.el.querySelector<HTMLElement>("#tabbar-tabs")!;
    tabsEl.innerHTML = tabs
      .map(
        (t) => `
        <div class="tabbar__tab ${t.id === activeId ? "tabbar__tab--active" : ""}" data-id="${t.id}">
          <span class="tabbar__tab-icon">${TYPE_ICONS[t.type]?.() ?? ""}</span>
          <span class="tabbar__tab-label">${escapeHtml(t.label)}</span>
          <button class="tabbar__close" data-close="${t.id}" title="Close">${icon("close", 10)}</button>
        </div>`
      )
      .join("");

    // Tab clicks (excluding close button)
    tabsEl.querySelectorAll<HTMLElement>(".tabbar__tab").forEach((el) => {
      el.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".tabbar__close")) return;
        this.callbacks.onActivate(el.dataset.id!);
      });
    });

    // Close buttons
    tabsEl.querySelectorAll<HTMLButtonElement>(".tabbar__close").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.callbacks.onClose(btn.dataset.close!);
      });
    });

    // Action buttons
    this.el.querySelector("#tb-new-session")!.addEventListener("click", () => this.callbacks.onNew());
    this.el.querySelector("#tb-new-viewer")!.addEventListener("click", () => this.callbacks.onNewViewer());
    this.el.querySelector("#tb-new-browser")!.addEventListener("click", () => {
      const url = prompt("Enter URL (e.g. http://localhost:3000):")?.trim();
      this.callbacks.onNewBrowser(url || "");
    });
    this.el.querySelector("#tb-left")!.addEventListener("click", () => this.callbacks.onToggleLeftSidebar());
    this.el.querySelector("#tb-right")!.addEventListener("click", () => this.callbacks.onToggleRightSidebar());
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
