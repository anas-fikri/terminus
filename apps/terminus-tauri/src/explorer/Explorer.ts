import { getTree, type TreeNode } from "../ipc/bridge";
import { icon } from "../utils/icons";
import "./explorer.css";

export class Explorer {
  private el: HTMLElement;
  private onFileOpen: (path: string) => void;
  private onFileAttach: (path: string) => void;

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
    this.el.innerHTML = `<div class="explorer"><div class="explorer__loading">Loading…</div></div>`;
    try {
      const tree = await getTree(workspace);
      this.render(tree);
    } catch (e) {
      this.el.innerHTML = `<div class="explorer"><div class="explorer__error">Failed to load tree</div></div>`;
    }
  }

  private render(tree: TreeNode): void {
    const container = document.createElement("div");
    container.className = "explorer";

    const heading = document.createElement("div");
    heading.className = "explorer__heading";
    heading.textContent = tree.name.toUpperCase();
    container.appendChild(heading);

    const list = this.buildList(tree.children ?? []);
    container.appendChild(list);

    this.el.innerHTML = "";
    this.el.appendChild(container);
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
      row.innerHTML = `${chevron}<span class="explorer__icon">${fileIcon}</span><span class="explorer__name">${node.name}</span>`;
      li.appendChild(row);

      if (node.is_dir && node.children) {
        const sub = this.buildList(node.children);
        sub.style.display = "none";
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          const shown = sub.style.display !== "none";
          sub.style.display = shown ? "none" : "block";
          const chev = row.querySelector(".explorer__chevron")!;
          chev.innerHTML = shown ? icon("chevron-right", 9) : icon("chevron-down", 9);
          const ficon = row.querySelector(".explorer__icon")!;
          ficon.innerHTML = shown ? icon("folder", 11) : icon("folder-open", 11);
        });
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

        actions.appendChild(previewBtn);
        actions.appendChild(attachBtn);
        row.appendChild(actions);

        // Single click = open preview
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          this.onFileOpen(node.path);
        });
      }

      ul.appendChild(li);
    }

    return ul;
  }
}
