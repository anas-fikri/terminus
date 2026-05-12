import { marked } from "marked";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { getFileModifiedMs, readFileBytes, readFileContent, writeFileContentOverwrite } from "../ipc/bridge";
import "./viewer.css";

// Set up PDF.js worker — use local bundled worker (no CDN/internet required)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  securityLevel: "loose",
  fontFamily: "system-ui, -apple-system, sans-serif",
  flowchart: {
    useMaxWidth: true,
    htmlLabels: false,
    curve: "basis",
  },
  er: { useMaxWidth: true },
  wrap: true,
});

export type ViewerSource =
  | { kind: "file"; path: string }
  | { kind: "content"; content: string; name: string };

export interface ViewerAttachment {
  mode: "read" | "source" | "selection";
  name: string;
  path?: string;
  content: string;
}

function ext(name: string): string {
  const parts = name.toLowerCase().split(".").filter(Boolean);
  if (parts.length === 0) return "";
  const last = parts[parts.length - 1];
  if (last === "bak" && parts.length >= 2) {
    return parts[parts.length - 2];
  }
  return last;
}

export class ViewerPane {
  private el: HTMLElement;
  private contentEl!: HTMLElement;
  private source: ViewerSource | null = null;
  private onAttach?: (attachment: ViewerAttachment) => void;
  private contextMenuEl!: HTMLElement;
  private selectedTextSnapshot = "";
  private mdZoomLevels = [80, 90, 100, 110, 125, 150, 175, 200];
  private mdZoom = 100;
  private autoRefreshEnabled = true;
  private autoRefreshTimer?: number;
  private lastKnownModifiedMs: number | null = null;
  private rendering = false;
  private editDialogEl!: HTMLElement;
  private editMode = false;
  private editContentEl!: HTMLTextAreaElement;
  private renderedScrollTop = 0;
  private rawScrollTop = 0;
  private editScrollTop = 0;
  private editCursorPos = 0;

  constructor(el: HTMLElement, onAttach?: (attachment: ViewerAttachment) => void) {
    this.el = el;
    this.onAttach = onAttach;
    this.mount();
  }

  private mount(): void {
    this.el.innerHTML = `
      <div class="viewer">
        <div class="viewer__toolbar" id="vwr-toolbar">
          <span class="viewer__label" id="vwr-label">—</span>
          <button class="viewer__btn" id="vwr-md-zoom-out" style="display:none">A-</button>
          <span class="viewer__zoom-label" id="vwr-md-zoom-label" style="display:none">100%</span>
          <button class="viewer__btn" id="vwr-md-zoom-in" style="display:none">A+</button>
          <button class="viewer__btn viewer__btn--active" id="vwr-auto-refresh">Auto Refresh: ON</button>
          <button class="viewer__btn" id="vwr-attach-read" style="display:none">Attach Read</button>
          <button class="viewer__btn" id="vwr-attach-source" style="display:none">Attach Source</button>
          <button class="viewer__btn" id="vwr-reload">↺ Refresh</button>
          <button class="viewer__btn" id="vwr-raw" style="display:none">‹/› Raw</button>
          <button class="viewer__btn" id="vwr-edit" style="display:none">✎ Edit</button>
        </div>
        <div class="viewer__body" id="vwr-body">
          <div class="viewer__empty">Open a file from the Explorer to preview it here.</div>
        </div>
        <div class="viewer__context-menu" id="vwr-context-menu" style="display:none">
          <button class="viewer__context-item" id="vwr-add-selection">Add to CLI</button>
          <button class="viewer__context-item" id="vwr-view-source">View in Source / Raw</button>
          <button class="viewer__context-item" id="vwr-edit-selection">Edit Selection (Safe)</button>
          <div class="viewer__context-hint" id="vwr-context-hint"></div>
        </div>
        <div class="viewer__edit-dialog" id="vwr-edit-dialog" style="display:none">
          <div class="viewer__edit-card" role="dialog" aria-modal="true" aria-label="Edit selection">
            <div class="viewer__edit-title">Edit selected text in source file</div>
            <div class="viewer__edit-note" id="vwr-edit-note"></div>
            <label class="viewer__edit-label">Selected Text</label>
            <textarea class="viewer__edit-area viewer__edit-area--readonly" id="vwr-edit-original" readonly></textarea>
            <label class="viewer__edit-label">Replacement</label>
            <textarea class="viewer__edit-area" id="vwr-edit-replacement"></textarea>
            <div class="viewer__edit-error" id="vwr-edit-error"></div>
            <div class="viewer__edit-actions">
              <button class="viewer__btn" id="vwr-edit-cancel">Cancel</button>
              <button class="viewer__btn viewer__btn--active" id="vwr-edit-apply">Apply to file</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.contentEl = this.el.querySelector("#vwr-body")!;
    this.contextMenuEl = this.el.querySelector("#vwr-context-menu")!;
    this.editDialogEl = this.el.querySelector("#vwr-edit-dialog")!;
    this.el.querySelector("#vwr-attach-read")!.addEventListener("click", () => this.attachRead());
    this.el.querySelector("#vwr-attach-source")!.addEventListener("click", () => this.attachSource());
    this.el.querySelector("#vwr-reload")!.addEventListener("click", () => this.reload());
    this.el.querySelector("#vwr-raw")!.addEventListener("click", () => void this.toggleRaw());
    this.el.querySelector("#vwr-edit")!.addEventListener("click", () => void this.toggleEditMode());
    this.el.querySelector("#vwr-md-zoom-out")!.addEventListener("click", () => this.adjustMdZoom(-1));
    this.el.querySelector("#vwr-md-zoom-in")!.addEventListener("click", () => this.adjustMdZoom(1));
    this.el.querySelector("#vwr-auto-refresh")!.addEventListener("click", () => this.toggleAutoRefresh());
    this.el.querySelector("#vwr-add-selection")!.addEventListener("click", () => this.attachSelection());
    this.el.querySelector("#vwr-view-source")!.addEventListener("click", () => this.viewInSource());
    this.el.querySelector("#vwr-edit-selection")!.addEventListener("click", () => this.openEditSelectionDialog());
    this.el.querySelector("#vwr-edit-cancel")!.addEventListener("click", () => this.closeEditSelectionDialog());
    this.el.querySelector("#vwr-edit-apply")!.addEventListener("click", () => void this.applySelectionEdit());

    // Prevent context-menu clicks from bubbling to document (which would hide menu before handler runs)
    this.contextMenuEl.addEventListener("mousedown", (e) => e.stopPropagation());
    this.contentEl.addEventListener("contextmenu", (e) => this.openSelectionMenu(e));
    document.addEventListener("mousedown", (e) => {
      if (!this.contextMenuEl.contains(e.target as Node)) {
        this.hideSelectionMenu();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.hideSelectionMenu();
        // Keep edit dialog open so ESC won't kick user back to raw-only view.
        const editVisible = this.editDialogEl?.style.display === "flex";
        if (!editVisible) {
          this.closeEditSelectionDialog();
        }
      }
    });
  }

  async open(source: ViewerSource): Promise<void> {
    this.source = source;
    const name = source.kind === "file" ? source.path.split("/").pop()! : source.name;
    (this.el.querySelector("#vwr-label") as HTMLElement).textContent = name;
    this.lastKnownModifiedMs = null;
    this.startAutoRefreshLoop();
    await this.render();
  }

  private async reload(): Promise<void> {
    if (this.source) await this.render();
  }

  private rawMode = false;
  private rawContent = "";

  private captureCurrentPosition(): void {
    if (this.editMode && this.editContentEl) {
      this.editScrollTop = this.editContentEl.scrollTop;
      this.editCursorPos = this.editContentEl.selectionStart ?? 0;
      return;
    }

    if (this.rawMode) {
      this.rawScrollTop = this.contentEl.scrollTop;
      return;
    }

    this.renderedScrollTop = this.contentEl.scrollTop;
  }

  private restoreCurrentPosition(): void {
    if (this.editMode && this.editContentEl) {
      const pos = Math.max(0, Math.min(this.editCursorPos, this.editContentEl.value.length));
      this.editContentEl.selectionStart = pos;
      this.editContentEl.selectionEnd = pos;
      this.editContentEl.scrollTop = this.editScrollTop;
      return;
    }

    this.contentEl.scrollTop = this.rawMode ? this.rawScrollTop : this.renderedScrollTop;
  }

  private async toggleRaw(): Promise<void> {
    this.captureCurrentPosition();
    if (this.editMode) {
      this.editMode = false;
    }
    this.rawMode = !this.rawMode;
    const btn = this.el.querySelector<HTMLButtonElement>("#vwr-raw")!;
    const editBtn = this.el.querySelector<HTMLButtonElement>("#vwr-edit")!;
    btn.textContent = this.rawMode ? "◉ Rendered" : "‹/› Raw";
    if (editBtn) editBtn.textContent = "✎ Edit";
    this.syncMarkdownZoomVisibility(this.currentName());
    if (this.rawMode) {
      this.contentEl.innerHTML = `<pre class="viewer__raw">${escHtml(this.rawContent)}</pre>`;
      this.restoreCurrentPosition();
    } else {
      await this.renderContent(this.rawContent, this.currentName());
      this.restoreCurrentPosition();
    }
  }

  private async toggleEditMode(): Promise<void> {
    if (!this.source || this.source.kind !== "file") {
      return;
    }

    const currentExt = ext(this.currentName());
    if (currentExt === "pdf") {
      return;
    }

    this.captureCurrentPosition();
    this.editMode = !this.editMode;
    const editBtn = this.el.querySelector<HTMLButtonElement>("#vwr-edit")!;
    const rawBtn = this.el.querySelector<HTMLButtonElement>("#vwr-raw")!;
    
    if (this.editMode) {
      this.rawMode = false;
      editBtn.textContent = "✏ Editing";
      if (rawBtn) rawBtn.textContent = "‹/› Raw";
      this.renderEditMode();
      this.restoreCurrentPosition();
    } else {
      editBtn.textContent = "✎ Edit";
      await this.renderContent(this.rawContent, this.currentName());
      this.restoreCurrentPosition();
    }
  }

  private renderEditMode(): void {
    this.contentEl.innerHTML = `
      <div class="viewer__edit-mode">
        <div class="viewer__edit-mode-toolbar">
          <div class="viewer__edit-mode-info">
            <span class="viewer__edit-mode-label">Editing:</span>
            <span class="viewer__edit-mode-path">${escHtml(this.source?.kind === "file" ? this.source.path : this.currentName())}</span>
          </div>
          <div class="viewer__edit-mode-actions">
            <button class="viewer__btn" id="vwr-edit-mode-save">💾 Save</button>
            <button class="viewer__btn" id="vwr-edit-mode-cancel">Cancel</button>
          </div>
        </div>
        <textarea class="viewer__edit-mode-textarea" id="vwr-edit-mode-content"></textarea>
        <div class="viewer__edit-mode-error" id="vwr-edit-mode-error"></div>
      </div>
    `;

    this.editContentEl = this.contentEl.querySelector<HTMLTextAreaElement>("#vwr-edit-mode-content")!;
    this.editContentEl.value = this.rawContent;
    this.editContentEl.focus();

    this.contentEl.querySelector("#vwr-edit-mode-save")!.addEventListener("click", () => void this.saveEditMode());
    this.contentEl.querySelector("#vwr-edit-mode-cancel")!.addEventListener("click", () => this.cancelEditMode());

    // Save on Ctrl+S
    const saveHandler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void this.saveEditMode();
      }
    };
    this.editContentEl.addEventListener("keydown", saveHandler);
  }

  private async saveEditMode(): Promise<void> {
    if (!this.source || this.source.kind !== "file") return;

    const errorEl = this.contentEl.querySelector<HTMLElement>("#vwr-edit-mode-error");
    const newContent = this.editContentEl.value;

    try {
      // Create backup
      const sourcePath = this.source.path;
      const currentContent = await readFileContent(sourcePath);
      await writeFileContentOverwrite(this.backupPathFor(sourcePath), currentContent);

      // Save new content
      await writeFileContentOverwrite(sourcePath, newContent);
      
      // Update state and exit edit mode
      this.rawContent = newContent;
      this.lastKnownModifiedMs = await getFileModifiedMs(sourcePath);
      
      this.editMode = false;
      const editBtn = this.el.querySelector<HTMLButtonElement>("#vwr-edit")!;
      if (editBtn) editBtn.textContent = "✎ Edit";
      
      await this.render();
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = `Error: ${String(err)}`;
      }
    }
  }

  private cancelEditMode(): void {
    this.editMode = false;
    const editBtn = this.el.querySelector<HTMLButtonElement>("#vwr-edit")!;
    if (editBtn) editBtn.textContent = "✎ Edit";
    this.renderContent(this.rawContent, this.currentName());
  }

  private currentName(): string {
    if (!this.source) return "";
    return this.source.kind === "file" ? this.source.path.split("/").pop()! : this.source.name;
  }

  private async render(): Promise<void> {
    if (!this.source) return;
    if (this.rendering) return;
    this.rendering = true;
    this.contentEl.innerHTML = `<div class="viewer__loading">Loading…</div>`;

    try {
      let content = "";
      let pdfBytes: Uint8Array | undefined;
      const name = this.currentName();
      const currentExt = ext(name);
      if (this.source.kind === "file") {
        if (currentExt === "pdf") {
          const bytes = await readFileBytes(this.source.path);
          pdfBytes = Uint8Array.from(bytes);
        } else {
          content = await readFileContent(this.source.path);
        }
      } else {
        content = this.source.content;
        this.lastKnownModifiedMs = null;
      }

      this.rawContent = pdfBytes ? `[binary PDF: ${pdfBytes.length} bytes]` : content;

      // Show raw button for text-based formats
      const rawBtn = this.el.querySelector<HTMLElement>("#vwr-raw")!;
      const editBtn = this.el.querySelector<HTMLElement>("#vwr-edit")!;
      const attachReadBtn = this.el.querySelector<HTMLElement>("#vwr-attach-read")!;
      const attachSourceBtn = this.el.querySelector<HTMLElement>("#vwr-attach-source")!;
      attachReadBtn.style.display = "";
      attachSourceBtn.style.display = "";
      if (["md", "mmd", "drawio", "svg", "html", "txt", "xml"].includes(ext(name))) {
        rawBtn.style.display = "";
        editBtn.style.display = "";
      } else {
        rawBtn.style.display = "none";
        editBtn.style.display = "none";
      }

      this.rawMode = false;
      this.editMode = false;
      const btn = this.el.querySelector<HTMLButtonElement>("#vwr-raw")!;
      if (btn) btn.textContent = "‹/› Raw";
      if (editBtn) editBtn.textContent = "✎ Edit";
      this.syncMarkdownZoomVisibility(name);

      await this.renderContent(content, name, pdfBytes);

      if (this.source.kind === "file") {
        this.lastKnownModifiedMs = await getFileModifiedMs(this.source.path);
      }
    } catch (e) {
      this.contentEl.innerHTML = `<div class="viewer__error">Error: ${escHtml(String(e))}</div>`;
    } finally {
      this.rendering = false;
    }
  }

  private toggleAutoRefresh(): void {
    this.autoRefreshEnabled = !this.autoRefreshEnabled;
    this.updateAutoRefreshButton();
  }

  private updateAutoRefreshButton(): void {
    const btn = this.el.querySelector<HTMLButtonElement>("#vwr-auto-refresh");
    if (!btn) return;
    btn.textContent = this.autoRefreshEnabled ? "Auto Refresh: ON" : "Auto Refresh: OFF";
    btn.classList.toggle("viewer__btn--active", this.autoRefreshEnabled);
  }

  private startAutoRefreshLoop(): void {
    if (this.autoRefreshTimer) {
      window.clearInterval(this.autoRefreshTimer);
    }
    this.updateAutoRefreshButton();
    this.autoRefreshTimer = window.setInterval(() => {
      void this.checkForSourceUpdate();
    }, 1500);
  }

  private async checkForSourceUpdate(): Promise<void> {
    if (!this.autoRefreshEnabled || !this.source || this.source.kind !== "file") return;
    if (this.rendering || document.hidden) return;

    const modified = await getFileModifiedMs(this.source.path);
    if (modified === null) return;

    if (this.lastKnownModifiedMs === null) {
      this.lastKnownModifiedMs = modified;
      return;
    }

    if (modified > this.lastKnownModifiedMs) {
      this.lastKnownModifiedMs = modified;
      await this.render();
    }
  }

  private async renderContent(content: string, name: string, pdfBytes?: Uint8Array): Promise<void> {
    const e = ext(name);

    if (e === "pdf") {
      await this.renderPdf(content, name, pdfBytes);
    } else if (e === "md" || e === "markdown") {
      await this.renderMarkdown(content);
    } else if (e === "mmd" || e === "mermaid") {
      await this.renderMermaid(content);
    } else if (e === "drawio") {
      this.renderDrawio(content);
    } else if (e === "xml") {
      this.renderXml(content);
    } else if (e === "svg") {
      this.renderSvg(content);
    } else if (e === "html" || e === "htm") {
      this.renderHtml(content);
    } else {
      // Plain text / code fallback
      this.contentEl.innerHTML = `<pre class="viewer__raw">${escHtml(content)}</pre>`;
    }
  }

  private async renderMarkdown(md: string): Promise<void> {
    // Custom renderer: intercept mermaid code blocks
    const renderer = new marked.Renderer();
    let mermaidBlocks: { id: string; code: string }[] = [];

    renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
      if (lang === "mermaid") {
        const id = `mmd-${Math.random().toString(36).slice(2)}`;
        mermaidBlocks.push({ id, code: text });
        return `<div class="viewer__mermaid" id="${id}"></div>`;
      }
      return `<pre class="viewer__codeblock"><code class="lang-${escHtml(lang ?? "")}">${escHtml(text)}</code></pre>`;
    };

    const html = await marked(md, { renderer });
    const clean = DOMPurify.sanitize(html as string, { ADD_TAGS: ["div"], ADD_ATTR: ["id", "class"] });

    this.contentEl.innerHTML = `<div class="viewer__md" style="--viewer-md-zoom:${this.mdZoom / 100}">${clean}</div>`;

    // Render mermaid blocks
    for (const { id, code } of mermaidBlocks) {
      const target = this.contentEl.querySelector(`#${id}`);
      if (target) {
        try {
          const normalizedCode = this.normalizeMermaidCode(code);
          const { svg } = await mermaid.render(`mmd-svg-${id}`, normalizedCode);
          target.innerHTML = this.prepareMermaidSvg(svg);
        } catch (err) {
          target.innerHTML = `<pre class="viewer__mermaid-error">Mermaid error:\n${escHtml(String(err))}</pre>`;
        }
      }
    }
  }

  private adjustMdZoom(direction: -1 | 1): void {
    const currentIdx = this.mdZoomLevels.indexOf(this.mdZoom);
    const idx = currentIdx === -1 ? this.mdZoomLevels.indexOf(100) : currentIdx;
    const nextIdx = Math.max(0, Math.min(this.mdZoomLevels.length - 1, idx + direction));
    this.mdZoom = this.mdZoomLevels[nextIdx];
    this.updateMdZoomLabel();
    const mdEl = this.contentEl.querySelector<HTMLElement>(".viewer__md");
    if (mdEl) {
      mdEl.style.setProperty("--viewer-md-zoom", String(this.mdZoom / 100));
    }
  }

  private updateMdZoomLabel(): void {
    const label = this.el.querySelector<HTMLElement>("#vwr-md-zoom-label");
    if (label) label.textContent = `${this.mdZoom}%`;
  }

  private syncMarkdownZoomVisibility(name: string): void {
    const isMarkdown = ["md", "markdown"].includes(ext(name)) && !this.rawMode && !this.editMode;
    const outBtn = this.el.querySelector<HTMLElement>("#vwr-md-zoom-out");
    const inBtn = this.el.querySelector<HTMLElement>("#vwr-md-zoom-in");
    const label = this.el.querySelector<HTMLElement>("#vwr-md-zoom-label");
    const display = isMarkdown ? "" : "none";
    if (outBtn) outBtn.style.display = display;
    if (inBtn) inBtn.style.display = display;
    if (label) label.style.display = display;
    this.updateMdZoomLabel();
  }

  private async renderMermaid(code: string): Promise<void> {
    const id = `mmd-standalone-${Date.now()}`;
    try {
      const normalizedCode = this.normalizeMermaidCode(code.trim());
      const { svg } = await mermaid.render(id, normalizedCode);
      this.contentEl.innerHTML = `<div class="viewer__mermaid-full">${this.prepareMermaidSvg(svg)}</div>`;
    } catch (err) {
      this.contentEl.innerHTML = `<pre class="viewer__error">Mermaid error:\n${escHtml(String(err))}</pre>`;
    }
  }

  private prepareMermaidSvg(svg: string): string {
    // Mermaid output is trusted library output. Keep it intact to avoid
    // stripping label-related attributes needed by WKWebView rendering.
    return svg.replace(/<svg([^>]*?)>/, (match, attrs) => {
      if (!attrs.includes("width=") && !attrs.includes("height=")) {
        return `<svg${attrs} style="width: 100%; height: auto;">`;
      }
      return match;
    });
  }

  private normalizeMermaidCode(code: string): string {
    // Strip any per-diagram init directive and prepend a stable config.
    // This avoids WKWebView issues when htmlLabels=true (foreignObject labels disappear).
    const withoutInit = code.replace(/^\s*%%\{init:[\s\S]*?\}\s*%%\s*/m, "");
    const forcedInit =
      "%%{init: {'theme': 'dark', 'flowchart': {'htmlLabels': false, 'useMaxWidth': true, 'curve': 'basis'}, 'er': {'useMaxWidth': true}}}%%\n";
    return `${forcedInit}${withoutInit}`;
  }

  private async renderPdf(content: string, _name: string, bytes?: Uint8Array): Promise<void> {
    try {
      let pdfData = bytes;
      if (!pdfData) {
        // Fallback for content-based source where PDF is provided as base64 string.
        const bstr = atob(content);
        pdfData = new Uint8Array(bstr.length);
        for (let i = 0; i < bstr.length; i++) {
          pdfData[i] = bstr.charCodeAt(i);
        }
      }

      const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
      const totalPages = pdf.numPages;

      // Create PDF viewer container with controls
      this.contentEl.innerHTML = `
        <div class="viewer__pdf-wrap">
          <div class="viewer__pdf-toolbar">
            <button class="viewer__pdf-btn" id="pdf-prev" title="Previous page">◀</button>
            <span class="viewer__pdf-info">
              Page <input class="viewer__pdf-input" id="pdf-page-num" type="number" min="1" max="${totalPages}" value="1" /> of ${totalPages}
            </span>
            <button class="viewer__pdf-btn" id="pdf-next" title="Next page">▶</button>
            <span class="viewer__pdf-zoom">
              <button class="viewer__pdf-btn" id="pdf-zoom-out" title="Zoom out">−</button>
              <select class="viewer__pdf-select" id="pdf-zoom-level">
                <option value="50">50%</option>
                <option value="75">75%</option>
                <option value="100" selected>100%</option>
                <option value="125">125%</option>
                <option value="150">150%</option>
                <option value="200">200%</option>
              </select>
              <button class="viewer__pdf-btn" id="pdf-zoom-in" title="Zoom in">+</button>
            </span>
          </div>
          <div class="viewer__pdf-canvas-wrap">
            <canvas id="pdf-canvas" class="viewer__pdf-canvas"></canvas>
          </div>
        </div>
      `;

      const canvas = this.contentEl.querySelector<HTMLCanvasElement>("#pdf-canvas")!;
      const pageNumInput = this.contentEl.querySelector<HTMLInputElement>("#pdf-page-num")!;
      const zoomLevel = this.contentEl.querySelector<HTMLSelectElement>("#pdf-zoom-level")!;
      let currentPage = 1;
      let scale = 1;

      const renderPage = async (pageNum: number): Promise<void> => {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: scale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        
        const renderContext = {
          canvasContext: ctx,
          viewport: viewport,
          canvas: canvas,
        };
        await (page.render(renderContext) as any).promise;

        currentPage = pageNum;
        pageNumInput.value = String(pageNum);
      };

      // Initial render
      await renderPage(1);

      // Event listeners
      this.contentEl.querySelector("#pdf-prev")!.addEventListener("click", async () => {
        if (currentPage > 1) {
          await renderPage(currentPage - 1);
        }
      });

      this.contentEl.querySelector("#pdf-next")!.addEventListener("click", async () => {
        if (currentPage < totalPages) {
          await renderPage(currentPage + 1);
        }
      });

      pageNumInput.addEventListener("change", async () => {
        const pageNum = Math.max(1, Math.min(totalPages, parseInt(pageNumInput.value) || 1));
        await renderPage(pageNum);
      });

      zoomLevel.addEventListener("change", async () => {
        scale = parseInt(zoomLevel.value) / 100;
        await renderPage(currentPage);
      });

      this.contentEl.querySelector("#pdf-zoom-out")!.addEventListener("click", async () => {
        const levels = [50, 75, 100, 125, 150, 200];
        const currentIdx = levels.indexOf(parseInt(zoomLevel.value));
        if (currentIdx > 0) {
          zoomLevel.value = String(levels[currentIdx - 1]);
          scale = levels[currentIdx - 1] / 100;
          await renderPage(currentPage);
        }
      });

      this.contentEl.querySelector("#pdf-zoom-in")!.addEventListener("click", async () => {
        const levels = [50, 75, 100, 125, 150, 200];
        const currentIdx = levels.indexOf(parseInt(zoomLevel.value));
        if (currentIdx < levels.length - 1) {
          zoomLevel.value = String(levels[currentIdx + 1]);
          scale = levels[currentIdx + 1] / 100;
          await renderPage(currentPage);
        }
      });

      // Keyboard navigation
      const keyHandler = async (e: KeyboardEvent) => {
        if (e.key === "ArrowLeft" && currentPage > 1) {
          await renderPage(currentPage - 1);
        } else if (e.key === "ArrowRight" && currentPage < totalPages) {
          await renderPage(currentPage + 1);
        }
      };
      document.addEventListener("keydown", keyHandler);

    } catch (err) {
      this.contentEl.innerHTML = `<div class="viewer__error">PDF error: ${escHtml(String(err))}</div>`;
    }
  }

  private renderDrawio(xml: string): void {
    // Use diagrams.net embed viewer via postMessage API
    const encoded = encodeURIComponent(xml);
    // diagrams.net viewer accepts XML via URL param
    const src = `https://viewer.diagrams.net/?highlight=0000ff&nav=1&title=Diagram&xml=${encoded}`;

    this.contentEl.innerHTML = `
      <div class="viewer__drawio-wrap">
        <div class="viewer__drawio-note">
          ⚠ Requires internet · <a class="viewer__link" href="#" id="drawio-fallback">View raw XML instead</a>
        </div>
        <iframe class="viewer__iframe" src="${escHtml(src)}" allowfullscreen></iframe>
      </div>
    `;

    this.contentEl.querySelector("#drawio-fallback")?.addEventListener("click", (e) => {
      e.preventDefault();
      this.contentEl.innerHTML = `<pre class="viewer__raw">${escHtml(xml)}</pre>`;
    });
  }

  private renderXml(xml: string): void {
    const looksLikeDrawio = /<(mxfile|mxGraphModel)\b/i.test(xml);
    if (looksLikeDrawio) {
      this.renderDrawio(xml);
      return;
    }
    this.contentEl.innerHTML = `<pre class="viewer__raw">${escHtml(xml)}</pre>`;
  }

  private renderSvg(svg: string): void {
    const clean = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } });
    this.contentEl.innerHTML = `<div class="viewer__svg-wrap">${clean}</div>`;
  }

  private renderHtml(html: string): void {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    this.contentEl.innerHTML = `<iframe class="viewer__iframe" src="${url}" sandbox="allow-scripts allow-same-origin"></iframe>`;
    // Revoke after load
    const iframe = this.contentEl.querySelector("iframe")!;
    iframe.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
  }

  destroy(): void {
    if (this.autoRefreshTimer) {
      window.clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = undefined;
    }
    this.contentEl.innerHTML = "";
  }

  private attachSource(): void {
    if (!this.source || !this.onAttach) return;
    this.onAttach({
      mode: "source",
      name: this.currentName(),
      path: this.source.kind === "file" ? this.source.path : undefined,
      content: this.rawContent,
    });
  }

  private attachRead(): void {
    if (!this.source || !this.onAttach) return;
    this.onAttach({
      mode: "read",
      name: this.currentName(),
      path: this.source.kind === "file" ? this.source.path : undefined,
      content: this.getReadableContent(),
    });
  }

  private getReadableContent(): string {
    if (this.rawMode) return this.rawContent;
    const text = this.contentEl.innerText.trim();
    return text || this.rawContent;
  }

  private openSelectionMenu(e: MouseEvent): void {
    const selected = this.getSelectedText();
    if (!selected) {
      this.hideSelectionMenu();
      return;
    }

    e.preventDefault();
    this.selectedTextSnapshot = selected;
    this.contextMenuEl.style.display = "block";
    this.contextMenuEl.style.left = `${e.clientX}px`;
    this.contextMenuEl.style.top = `${e.clientY}px`;
  }

  private hideSelectionMenu(): void {
    if (this.contextMenuEl) {
      this.contextMenuEl.style.display = "none";
    }
  }

  private getSelectedText(): string {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return "";
    const range = selection.getRangeAt(0);
    const common = range.commonAncestorContainer;
    const inViewer = this.contentEl.contains(common.nodeType === Node.TEXT_NODE ? common.parentNode : common);
    if (!inViewer) return "";
    const text = selection.toString().trim();
    return text;
  }

  private attachSelection(): void {
    const selected = this.selectedTextSnapshot || this.getSelectedText();
    if (!selected || !this.onAttach) {
      this.hideSelectionMenu();
      return;
    }

    this.onAttach({
      mode: "selection",
      name: `${this.currentName() || "viewer"} [selection]`,
      path: this.source?.kind === "file" ? this.source.path : undefined,
      content: selected,
    });

    this.selectedTextSnapshot = "";
    this.hideSelectionMenu();
  }

  private showContextHint(msg: string): void {
    const hint = this.el.querySelector<HTMLElement>("#vwr-context-hint");
    if (hint) {
      hint.textContent = msg;
      hint.style.display = "block";
    }
  }

  private viewInSource(): void {
    const selected = this.selectedTextSnapshot || this.getSelectedText();
    if (!selected) { this.hideSelectionMenu(); return; }
    this.hideSelectionMenu();

    const resolvedSelection = this.resolveSelectionForEdit(selected) ?? selected;
    this.selectedTextSnapshot = resolvedSelection;

    // Switch to raw mode
    if (!this.rawMode) {
      this.rawMode = true;
      const btn = this.el.querySelector<HTMLButtonElement>("#vwr-raw")!;
      if (btn) btn.textContent = "◉ Rendered";
      this.syncMarkdownZoomVisibility(this.currentName());
      this.contentEl.innerHTML = `<pre class="viewer__raw">${escHtml(this.rawContent)}</pre>`;
    }

    // Highlight first occurrence in raw pre
    const pre = this.contentEl.querySelector<HTMLElement>(".viewer__raw");
    if (!pre) return;

    // Remove any existing marks first
    pre.querySelectorAll(".viewer__source-mark").forEach((m) => {
      m.replaceWith(m.textContent ?? "");
    });

    const escapedSearch = escHtml(resolvedSelection);
    const idx = pre.innerHTML.indexOf(escapedSearch);
    if (idx !== -1) {
      pre.innerHTML =
        pre.innerHTML.slice(0, idx) +
        `<mark class="viewer__source-mark">${escapedSearch}</mark>` +
        pre.innerHTML.slice(idx + escapedSearch.length);
      const mark = pre.querySelector(".viewer__source-mark");
      if (mark) mark.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    // Continue directly to safe edit flow for the same selection.
    this.openEditSelectionDialog();
  }

  private openEditSelectionDialog(): void {
    const selected = this.selectedTextSnapshot || this.getSelectedText();
    if (!selected) {
      this.hideSelectionMenu();
      return;
    }

    if (!this.source || this.source.kind !== "file") {
      this.showContextHint("Edit hanya untuk file lokal.");
      return;
    }

    const currentExt = ext(this.currentName());
    if (currentExt === "pdf") {
      this.showContextHint("PDF tidak bisa diedit dari viewer.");
      return;
    }

    const resolvedSelection = this.resolveSelectionForEdit(selected);
    if (!resolvedSelection) {
      this.showContextHint("Teks dari mode read/view tidak bisa dipetakan unik ke source. Klik View in Source lalu pilih teks yang lebih spesifik.");
      return;
    }

    this.selectedTextSnapshot = resolvedSelection;
    const note = this.el.querySelector<HTMLElement>("#vwr-edit-note");
    const original = this.el.querySelector<HTMLTextAreaElement>("#vwr-edit-original");
    const replacement = this.el.querySelector<HTMLTextAreaElement>("#vwr-edit-replacement");
    const error = this.el.querySelector<HTMLElement>("#vwr-edit-error");
    if (note) note.textContent = this.source.path;
    if (original) original.value = resolvedSelection;
    if (replacement) replacement.value = resolvedSelection;
    if (error) error.textContent = "";

    this.editDialogEl.style.display = "flex";
    replacement?.focus();
    this.hideSelectionMenu();
  }

  private closeEditSelectionDialog(): void {
    this.editDialogEl.style.display = "none";
    const error = this.el.querySelector<HTMLElement>("#vwr-edit-error");
    if (error) error.textContent = "";
  }

  private countOccurrences(haystack: string, needle: string): number {
    if (!needle) return 0;
    let count = 0;
    let idx = 0;
    while (true) {
      const found = haystack.indexOf(needle, idx);
      if (found === -1) break;
      count += 1;
      idx = found + needle.length;
    }
    return count;
  }

  private escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }

  private findUniqueWhitespaceMatch(sourceText: string, selectedText: string): string | null {
    const normalizedNeedle = this.normalizeWhitespace(selectedText);
    if (!normalizedNeedle) return null;

    const tokens = normalizedNeedle.split(" ").filter(Boolean).map((t) => this.escapeRegExp(t));
    if (tokens.length === 0) return null;

    const pattern = tokens.join("\\s+");
    const re = new RegExp(pattern, "g");

    let matches = 0;
    let matchedText = "";
    let m: RegExpExecArray | null;
    while ((m = re.exec(sourceText)) !== null) {
      matches += 1;
      matchedText = m[0];
      if (matches > 1) return null;
    }

    return matches === 1 ? matchedText : null;
  }

  private resolveSelectionForEdit(selectedText: string): string | null {
    const selection = selectedText.trim();
    if (!selection) return null;

    const sourceText = this.rawContent;
    if (!sourceText) return selection;

    const exactOccurrences = this.countOccurrences(sourceText, selection);
    if (exactOccurrences === 1) return selection;
    if (exactOccurrences > 1) return null;

    return this.findUniqueWhitespaceMatch(sourceText, selection);
  }

  private backupPathFor(sourcePath: string): string {
    const idx = sourcePath.lastIndexOf("/");
    if (idx === -1) return `.${sourcePath}.bak`;
    const dir = sourcePath.slice(0, idx);
    const file = sourcePath.slice(idx + 1);
    return `${dir}/.${file}.bak`;
  }

  private async applySelectionEdit(): Promise<void> {
    if (!this.source || this.source.kind !== "file") return;
    // Re-read raw content from file if not in raw mode (reading mode edit)
    if (!this.rawMode) {
      this.rawContent = await readFileContent(this.source.path);
    }

    const sourcePath = this.source.path;
    const selected = this.selectedTextSnapshot;
    const replacement = this.el.querySelector<HTMLTextAreaElement>("#vwr-edit-replacement")?.value ?? "";
    const errorEl = this.el.querySelector<HTMLElement>("#vwr-edit-error");
    if (!selected) {
      if (errorEl) errorEl.textContent = "Selection kosong.";
      return;
    }

    const currentModified = await getFileModifiedMs(sourcePath);
    if (
      this.lastKnownModifiedMs !== null &&
      currentModified !== null &&
      currentModified > this.lastKnownModifiedMs
    ) {
      if (errorEl) errorEl.textContent = "File berubah di luar viewer. Klik Refresh dulu lalu ulangi edit.";
      return;
    }

    const sourceText = await readFileContent(sourcePath);
    const occurrences = this.countOccurrences(sourceText, selected);
    if (occurrences === 0) {
      if (errorEl) errorEl.textContent = "Selection tidak ditemukan persis di source. Coba mode Raw untuk edit yang presisi.";
      return;
    }
    if (occurrences > 1) {
      if (errorEl) errorEl.textContent = "Selection muncul lebih dari satu kali. Pilih teks yang lebih spesifik.";
      return;
    }

    const idx = sourceText.indexOf(selected);
    const next = `${sourceText.slice(0, idx)}${replacement}${sourceText.slice(idx + selected.length)}`;
    await writeFileContentOverwrite(this.backupPathFor(sourcePath), sourceText);
    await writeFileContentOverwrite(sourcePath, next);
    this.closeEditSelectionDialog();
    await this.render();
  }
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
