import { deletePaths, getTree, renamePath, type TreeNode } from "../ipc/bridge";
import { icon } from "../utils/icons";
import "./explorer.css";

export class Explorer {
  private el: HTMLElement;
  private onFileOpen: (path: string) => void;
  private onFileAttach: (path: string) => void;
  private workspace: string | null = null;
  private selectionMode = false;
  private selectedPaths = new Set<string>();
  private expandedDirs = new Set<string>();

  constructor(
    el: HTMLElement,
    onFileOpen: (path: string) => void,
    onFileAttach: (path: string) => void
  ) {
    this.el = el;
    this.onFileOpen = onFileOpen;
    this.onFileAttach = onFileAttach;
    this.el.innerHTML = `<div class="explorer"><div class="explorer__empty">No workspace</div></div>`;
  }

  async load(workspace: string): Promise<void> {
    this.workspace = workspace;
    this.el.innerHTML = `<div class="explorer"><div class="explorer__loading">Loading…</div></div>`;
    try {
      const tree = await getTree(workspace);
      this.render(tree);
    } catch (e) {
      this.el.innerHTML = `<div class="explorer"><div class="explorer__error">Failed to load tree</div></div>`;
    }
  }

  async refresh(): Promise<void> {
    if (!this.workspace) return;
    await this.load(this.workspace);
  }

  private render(tree: TreeNode): void {
    const container = document.createElement("div");
    container.className = "explorer";

    const heading = document.createElement("div");
    heading.className = "explorer__heading";
    heading.innerHTML = `
      <span class="explorer__heading-title">${escapeHtml(tree.name.toUpperCase())}</span>
      <span class="explorer__heading-actions">
        <button class="explorer__heading-btn" id="explorer-refresh" title="Refresh file tree">Refresh</button>
        <button class="explorer__heading-btn" id="explorer-toggle-select" title="Toggle checklist mode">${this.selectionMode ? "Cancel" : "Checklist"}</button>
        <button class="explorer__heading-btn explorer__heading-btn--danger" id="explorer-delete-selected" title="Delete selected items" ${this.selectedPaths.size === 0 ? "disabled" : ""}>Delete (${this.selectedPaths.size})</button>
      </span>
    `;
    container.appendChild(heading);

    const list = this.buildList(tree.children ?? []);
    container.appendChild(list);

    this.el.innerHTML = "";
    this.el.appendChild(container);

    this.el.querySelector("#explorer-refresh")?.addEventListener("click", () => {
      void this.refresh();
    });

    this.el.querySelector("#explorer-toggle-select")?.addEventListener("click", () => {
      this.selectionMode = !this.selectionMode;
      if (!this.selectionMode) {
        this.selectedPaths.clear();
      }
      this.render(tree);
    });

    this.el.querySelector("#explorer-delete-selected")?.addEventListener("click", () => {
      void this.deleteSelectedItems();
    });
  }

  private buildList(nodes: TreeNode[]): HTMLElement {
    const ul = document.createElement("ul");
    ul.className = "explorer__list";

    for (const node of nodes) {
      const li = document.createElement("li");
      li.className = `explorer__item${node.is_dir ? " explorer__item--dir" : ""}`;

      const row = document.createElement("div");
      row.className = `explorer__row${node.is_dir ? " explorer__row--dir" : ""}`;

      const fileIcon = node.is_dir ? icon("folder", 11) : icon("file", 11);
      const chevron = node.is_dir ? `<span class="explorer__chevron">${icon("chevron-right", 9)}</span>` : `<span class="explorer__chevron"></span>`;
      row.innerHTML = `${chevron}<span class="explorer__icon">${fileIcon}</span><span class="explorer__name">${escapeHtml(node.name)}</span>`;

      if (this.selectionMode) {
        const select = document.createElement("input");
        select.type = "checkbox";
        select.className = "explorer__select";
        select.checked = this.selectedPaths.has(node.path);
        select.addEventListener("click", (e) => {
          e.stopPropagation();
          this.toggleSelection(node.path, select.checked);
        });
        row.insertBefore(select, row.firstChild);
      }

      li.appendChild(row);

      if (node.is_dir && node.children) {
        const sub = this.buildList(node.children);
        const isExpanded = this.expandedDirs.has(node.path);
        sub.style.display = isExpanded ? "block" : "none";
        const chev = row.querySelector(".explorer__chevron");
        const ficon = row.querySelector(".explorer__icon");
        if (chev) {
          chev.innerHTML = isExpanded ? icon("chevron-down", 9) : icon("chevron-right", 9);
        }
        if (ficon) {
          ficon.innerHTML = isExpanded ? icon("folder-open", 11) : icon("folder", 11);
        }

        row.addEventListener("click", (e) => {
          e.stopPropagation();
          const currentlyOpen = this.expandedDirs.has(node.path);
          if (currentlyOpen) {
            this.expandedDirs.delete(node.path);
            sub.style.display = "none";
            const nextChevron = row.querySelector(".explorer__chevron");
            const nextFolderIcon = row.querySelector(".explorer__icon");
            if (nextChevron) nextChevron.innerHTML = icon("chevron-right", 9);
            if (nextFolderIcon) nextFolderIcon.innerHTML = icon("folder", 11);
          } else {
            this.expandedDirs.add(node.path);
            sub.style.display = "block";
            const nextChevron = row.querySelector(".explorer__chevron");
            const nextFolderIcon = row.querySelector(".explorer__icon");
            if (nextChevron) nextChevron.innerHTML = icon("chevron-down", 9);
            if (nextFolderIcon) nextFolderIcon.innerHTML = icon("folder-open", 11);
          }
        });

        const actions = document.createElement("span");
        actions.className = "explorer__item-actions";

        const renameBtn = document.createElement("button");
        renameBtn.className = "explorer__item-btn";
        renameBtn.title = "Rename";
        renameBtn.textContent = "Ren";
        renameBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void this.renameItem(node.path, node.name);
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "explorer__item-btn explorer__item-btn--danger";
        deleteBtn.title = "Delete";
        deleteBtn.textContent = "Del";
        deleteBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void this.deleteSingle(node.path, node.name);
        });
        actions.appendChild(renameBtn);
        actions.appendChild(deleteBtn);
        row.appendChild(actions);

        li.appendChild(sub);
      } else if (!node.is_dir) {
        // Action buttons: preview + attach
        const actions = document.createElement("span");
        actions.className = "explorer__item-actions";

        const previewBtn = document.createElement("button");
        previewBtn.className = "explorer__item-btn";
        previewBtn.title = "Preview";
        previewBtn.innerHTML = icon("eye", 11);
        previewBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.onFileOpen(node.path);
        });

        const attachBtn = document.createElement("button");
        attachBtn.className = "explorer__item-btn";
        attachBtn.title = "Attach path to terminal";
        attachBtn.innerHTML = icon("paperclip", 11);
        attachBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.onFileAttach(node.path);
          attachBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><polyline points="3,8 6,12 13,4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
          setTimeout(() => { attachBtn.innerHTML = icon("paperclip", 11); }, 1500);
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "explorer__item-btn explorer__item-btn--danger";
        deleteBtn.title = "Delete";
        deleteBtn.textContent = "Del";
        deleteBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void this.deleteSingle(node.path, node.name);
        });

        const renameBtn = document.createElement("button");
        renameBtn.className = "explorer__item-btn";
        renameBtn.title = "Rename";
        renameBtn.textContent = "Ren";
        renameBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void this.renameItem(node.path, node.name);
        });

        actions.appendChild(previewBtn);
        actions.appendChild(attachBtn);
        actions.appendChild(renameBtn);
        actions.appendChild(deleteBtn);
        row.appendChild(actions);

        // Single click = open preview
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.selectionMode) {
            this.toggleSelection(node.path);
            return;
          }
          this.onFileOpen(node.path);
        });
      }

      ul.appendChild(li);
    }

    return ul;
  }

  private toggleSelection(path: string, nextValue?: boolean): void {
    const shouldSelect = nextValue ?? !this.selectedPaths.has(path);
    if (shouldSelect) {
      this.selectedPaths.add(path);
    } else {
      this.selectedPaths.delete(path);
    }
    if (this.workspace) {
      void this.load(this.workspace);
    }
  }

  private async deleteSingle(path: string, label: string): Promise<void> {
    const ok = window.confirm(`Delete ${label}? This cannot be undone.`);
    if (!ok) return;
    try {
      await deletePaths([path]);
      this.selectedPaths.delete(path);
      await this.refresh();
    } catch {
      window.alert("Failed to delete item.");
    }
  }

  private async deleteSelectedItems(): Promise<void> {
    const targets = [...this.selectedPaths];
    if (targets.length === 0) return;
    const ok = window.confirm(`Delete ${targets.length} selected item(s)? This cannot be undone.`);
    if (!ok) return;
    try {
      await deletePaths(targets);
      this.selectedPaths.clear();
      this.selectionMode = false;
      await this.refresh();
    } catch {
      window.alert("Failed to delete selected items.");
    }
  }

  private async renameItem(path: string, currentName: string): Promise<void> {
    const nextName = window.prompt("Rename to:", currentName)?.trim();
    if (!nextName || nextName === currentName) return;

    if (nextName.includes("/") || nextName.includes("\\")) {
      window.alert("Use name only, without path separators.");
      return;
    }

    const slashIdx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const parent = slashIdx >= 0 ? path.slice(0, slashIdx + 1) : "";
    const newPath = `${parent}${nextName}`;

    try {
      await renamePath(path, newPath);
      if (this.selectedPaths.has(path)) {
        this.selectedPaths.delete(path);
        this.selectedPaths.add(newPath);
      }
      await this.refresh();
    } catch {
      window.alert("Failed to rename item.");
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
