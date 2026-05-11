import { marked } from "marked";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { readFileContent } from "../ipc/bridge";
import "./viewer.css";

mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose" });

export type ViewerSource =
  | { kind: "file"; path: string }
  | { kind: "content"; content: string; name: string };

export interface ViewerAttachment {
  mode: "read" | "source";
  name: string;
  path?: string;
  content: string;
}

function ext(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export class ViewerPane {
  private el: HTMLElement;
  private contentEl!: HTMLElement;
  private source: ViewerSource | null = null;
  private onAttach?: (attachment: ViewerAttachment) => void;
  private contextMenuEl!: HTMLElement;
  private selectedTextSnapshot = "";

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
          <button class="viewer__btn" id="vwr-attach-read" style="display:none">Attach Read</button>
          <button class="viewer__btn" id="vwr-attach-source" style="display:none">Attach Source</button>
          <button class="viewer__btn" id="vwr-reload">↺ Reload</button>
          <button class="viewer__btn" id="vwr-raw" style="display:none">‹/› Raw</button>
        </div>
        <div class="viewer__body" id="vwr-body">
          <div class="viewer__empty">Open a file from the Explorer to preview it here.</div>
        </div>
        <div class="viewer__context-menu" id="vwr-context-menu" style="display:none">
          <button class="viewer__context-item" id="vwr-add-selection">Add to CLI</button>
        </div>
      </div>
    `;

    this.contentEl = this.el.querySelector("#vwr-body")!;
    this.contextMenuEl = this.el.querySelector("#vwr-context-menu")!;
    this.el.querySelector("#vwr-attach-read")!.addEventListener("click", () => this.attachRead());
    this.el.querySelector("#vwr-attach-source")!.addEventListener("click", () => this.attachSource());
    this.el.querySelector("#vwr-reload")!.addEventListener("click", () => this.reload());
    this.el.querySelector("#vwr-raw")!.addEventListener("click", () => this.toggleRaw());
    this.el.querySelector("#vwr-add-selection")!.addEventListener("click", () => this.attachSelection());

    this.contentEl.addEventListener("contextmenu", (e) => this.openSelectionMenu(e));
    document.addEventListener("click", () => this.hideSelectionMenu());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.hideSelectionMenu();
    });
  }

  async open(source: ViewerSource): Promise<void> {
    this.source = source;
    const name = source.kind === "file" ? source.path.split("/").pop()! : source.name;
    (this.el.querySelector("#vwr-label") as HTMLElement).textContent = name;
    await this.render();
  }

  private async reload(): Promise<void> {
    if (this.source) await this.render();
  }

  private rawMode = false;
  private rawContent = "";

  private toggleRaw(): void {
    this.rawMode = !this.rawMode;
    const btn = this.el.querySelector<HTMLButtonElement>("#vwr-raw")!;
    btn.textContent = this.rawMode ? "◉ Rendered" : "‹/› Raw";
    if (this.rawMode) {
      this.contentEl.innerHTML = `<pre class="viewer__raw">${escHtml(this.rawContent)}</pre>`;
    } else {
      this.renderContent(this.rawContent, this.currentName());
    }
  }

  private currentName(): string {
    if (!this.source) return "";
    return this.source.kind === "file" ? this.source.path.split("/").pop()! : this.source.name;
  }

  private async render(): Promise<void> {
    if (!this.source) return;
    this.contentEl.innerHTML = `<div class="viewer__loading">Loading…</div>`;

    try {
      let content: string;
      if (this.source.kind === "file") {
        content = await readFileContent(this.source.path);
      } else {
        content = this.source.content;
      }

      this.rawContent = content;
      const name = this.currentName();

      // Show raw button for text-based formats
      const rawBtn = this.el.querySelector<HTMLElement>("#vwr-raw")!;
      const attachReadBtn = this.el.querySelector<HTMLElement>("#vwr-attach-read")!;
      const attachSourceBtn = this.el.querySelector<HTMLElement>("#vwr-attach-source")!;
      attachReadBtn.style.display = "";
      attachSourceBtn.style.display = "";
      if (["md", "mmd", "drawio", "svg", "html", "txt"].includes(ext(name))) {
        rawBtn.style.display = "";
      } else {
        rawBtn.style.display = "none";
      }

      this.rawMode = false;
      const btn = this.el.querySelector<HTMLButtonElement>("#vwr-raw")!;
      if (btn) btn.textContent = "‹/› Raw";

      await this.renderContent(content, name);
    } catch (e) {
      this.contentEl.innerHTML = `<div class="viewer__error">Error: ${escHtml(String(e))}</div>`;
    }
  }

  private async renderContent(content: string, name: string): Promise<void> {
    const e = ext(name);

    if (e === "md" || e === "markdown") {
      await this.renderMarkdown(content);
    } else if (e === "mmd" || e === "mermaid") {
      await this.renderMermaid(content);
    } else if (e === "drawio" || e === "xml") {
      this.renderDrawio(content);
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

    this.contentEl.innerHTML = `<div class="viewer__md">${clean}</div>`;

    // Render mermaid blocks
    for (const { id, code } of mermaidBlocks) {
      const target = this.contentEl.querySelector(`#${id}`);
      if (target) {
        try {
          const { svg } = await mermaid.render(`mmd-svg-${id}`, code);
          target.innerHTML = DOMPurify.sanitize(svg);
        } catch (err) {
          target.innerHTML = `<pre class="viewer__mermaid-error">Mermaid error:\n${escHtml(String(err))}</pre>`;
        }
      }
    }
  }

  private async renderMermaid(code: string): Promise<void> {
    const id = `mmd-standalone-${Date.now()}`;
    try {
      const { svg } = await mermaid.render(id, code.trim());
      this.contentEl.innerHTML = `<div class="viewer__mermaid-full">${DOMPurify.sanitize(svg)}</div>`;
    } catch (err) {
      this.contentEl.innerHTML = `<pre class="viewer__error">Mermaid error:\n${escHtml(String(err))}</pre>`;
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
      mode: "read",
      name: `${this.currentName() || "viewer"} [selection]`,
      path: this.source?.kind === "file" ? this.source.path : undefined,
      content: selected,
    });

    this.selectedTextSnapshot = "";
    this.hideSelectionMenu();
  }
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
