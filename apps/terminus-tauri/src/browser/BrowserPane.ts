import { fetchRemoteHtml, openExternal, readFileContent, writeFileContent } from "../ipc/bridge";
import { trackActivity } from "../status/ActivityMonitor";
import "./browser.css";

export class BrowserPane {
  private el: HTMLElement;
  private iframe!: HTMLIFrameElement;
  private addrInput!: HTMLInputElement;
  private currentUrl = "";
  private history: string[] = [];
  private historyIdx = -1;
  private inspecting = false;
  private inspectMode: "single" | "multi" = "single";
  private selectedElements: Element[] = [];
  private onInspect?: (html: string, url: string, inspectPath: string) => void;
  private projectPath?: string;

  setOnInspect(cb: (html: string, url: string, inspectPath: string) => void): void {
    this.onInspect = cb;
  }

  setProjectContext(projectPath?: string): void {
    this.projectPath = projectPath;
  }

  constructor(el: HTMLElement) {
    this.el = el;
    this.mount();
  }

  private mount(): void {
    this.el.innerHTML = `
      <div class="browser">
        <div class="browser__toolbar">
          <button class="browser__nav-btn" id="brw-back" title="Back">◂</button>
          <button class="browser__nav-btn" id="brw-fwd"  title="Forward">▸</button>
          <button class="browser__nav-btn" id="brw-reload" title="Reload">↺</button>
          <div class="browser__addr-wrap">
            <span class="browser__scheme-icon">🌐</span>
            <input class="browser__addr" id="brw-addr" type="url"
              placeholder="http://localhost:3000 or file path…" />
          </div>
          <button class="browser__nav-btn" id="brw-go">Go</button>
          <button class="browser__nav-btn" id="brw-external" title="Open in system browser">↗</button>
          <button class="browser__nav-btn browser__inspect-btn" id="brw-inspect" title="Left-click: single-select inspect | Right-click: multi-select inspect">🔍</button>
        </div>
        <div class="browser__status-bar" id="brw-status">Ready</div>
        <div class="browser__frame-wrap">
          <iframe class="browser__frame" id="brw-frame"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            src="about:blank"></iframe>
          <div class="browser__blocked" id="brw-blocked" style="display:none">
            <div class="browser__blocked-icon">🚫</div>
            <div class="browser__blocked-title">Preview unavailable</div>
            <div class="browser__blocked-desc">
              The page could not be rendered in the embedded preview.
            </div>
            <button class="browser__blocked-btn" id="brw-open-sys">Open in system browser ↗</button>
          </div>
        </div>
      </div>
    `;

    this.iframe = this.el.querySelector<HTMLIFrameElement>("#brw-frame")!;
    this.addrInput = this.el.querySelector<HTMLInputElement>("#brw-addr")!;

    this.el.querySelector("#brw-go")!.addEventListener("click", () => this.navigate(this.addrInput.value));
    this.addrInput.addEventListener("keydown", (e) => { if (e.key === "Enter") this.navigate(this.addrInput.value); });
    this.el.querySelector("#brw-back")!.addEventListener("click", () => this.goBack());
    this.el.querySelector("#brw-fwd")!.addEventListener("click", () => this.goForward());
    this.el.querySelector("#brw-reload")!.addEventListener("click", () => this.reload());
    
    const inspectBtn = this.el.querySelector("#brw-inspect")!;
    // Left-click → single-select mode
    inspectBtn.addEventListener("click", () => {
      this.inspectMode = "single";
      this.selectedElements = [];
      this.toggleInspect();
    });
    // Right-click → multi-select mode
    inspectBtn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.inspectMode = "multi";
      this.selectedElements = [];
      this.toggleInspect();
    });

    // Detect frame load/error
    this.iframe.addEventListener("load", () => this.onFrameLoad());
    this.iframe.addEventListener("error", () => this.setStatus("Error loading page", true));
  }

  navigate(raw: string): void {
    const url = this.normalizeUrl(raw.trim());
    if (!url) return;

    this.currentUrl = url;
    this.addrInput.value = url;
    this.historyIdx++;
    this.history = this.history.slice(0, this.historyIdx);
    this.history.push(url);
    this.updateNavButtons();

    this.setStatus("Loading…");
    this.showBlocked(false);

    const scheme = url.split(":")[0].toLowerCase();

    // file:// — read via IPC and render as blob
    if (scheme === "file") {
      const filePath = url.replace(/^file:\/\//, "");
      readFileContent(filePath)
        .then((html) => {
          const blob = new Blob([html], { type: "text/html" });
          const blobUrl = URL.createObjectURL(blob);
          this.iframe.onload = () => { URL.revokeObjectURL(blobUrl); this.setStatus(url); };
          this.iframe.src = blobUrl;
        })
        .catch((e) => this.setStatus(`Cannot read file: ${e}`, true));
      return;
    }

    // blob — direct
    if (scheme === "blob") {
      this.iframe.src = url;
      return;
    }

    // HTTP/HTTPS — local hosts load directly for live preview; external sites use fetched HTML fallback.
    if (scheme === "http" || scheme === "https") {
      const hostname = (() => {
        try { return new URL(url).hostname; } catch { return ""; }
      })();

      if (this.isLocalHost(hostname)) {
        this.iframe.src = url;
      } else {
        fetchRemoteHtml(url)
          .then((html) => {
            this.iframe.srcdoc = this.wrapHtmlForSrcdoc(html, url);
          })
          .catch((e) => {
            this.setStatus(`Cannot fetch page: ${e}`, true);
            this.showBlockedMsg();
          });
      }
      return;
    }

    this.setStatus("Unsupported URL scheme.", true);
  }

  private normalizeUrl(raw: string): string {
    if (!raw) return "";
    if (
      raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      raw.startsWith("blob:") ||
      raw.startsWith("file://")
    ) return raw;
    // Absolute path → file://
    if (raw.startsWith("/")) return `file://${raw}`;
    // Assume http for localhost
    if (raw.startsWith("localhost") || raw.match(/^127\.|^0\.0\.0\.0/)) return `http://${raw}`;
    return `https://${raw}`;
  }

  private isLocalHost(hostname: string): boolean {
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      hostname.endsWith(".local")
    );
  }

  private reload(): void {
    if (!this.currentUrl) return;
    this.showBlocked(false);
    this.iframe.src = this.currentUrl;
    this.setStatus("Loading…");
  }

  private goBack(): void {
    if (this.historyIdx > 0) {
      this.historyIdx--;
      const url = this.history[this.historyIdx];
      this.currentUrl = url;
      this.addrInput.value = url;
      this.iframe.src = url;
      this.updateNavButtons();
    }
  }

  private goForward(): void {
    if (this.historyIdx < this.history.length - 1) {
      this.historyIdx++;
      const url = this.history[this.historyIdx];
      this.currentUrl = url;
      this.addrInput.value = url;
      this.iframe.src = url;
      this.updateNavButtons();
    }
  }

  private async openInSystem(): Promise<void> {
    if (this.currentUrl) await openExternal(this.currentUrl);
  }

  private onFrameLoad(): void {
    this.setStatus(this.currentUrl || "Ready");
    this.showBlocked(false);
  }

  private showBlockedMsg(): void {
    this.showBlocked(true);
    const blocked = this.el.querySelector<HTMLElement>("#brw-blocked")!;
    blocked.innerHTML = `
      <div class="browser__blocked-icon">🚫</div>
      <div class="browser__blocked-title">Preview unavailable</div>
      <div class="browser__blocked-desc">
        The page could not be rendered inside the embedded browser.<br/>
        You can still open it in the system browser.
      </div>
      <button class="browser__blocked-btn" id="brw-open-ext">Open in system browser ↗</button>
    `;
    blocked.querySelector("#brw-open-ext")!.addEventListener("click", () => this.openInSystem());
    this.setStatus("Preview unavailable", true);
  }

  private showBlocked(show: boolean): void {
    const blocked = this.el.querySelector<HTMLElement>("#brw-blocked")!;
    blocked.style.display = show ? "flex" : "none";
    this.iframe.style.display = show ? "none" : "block";
  }

  private setStatus(msg: string, error = false): void {
    const s = this.el.querySelector<HTMLElement>("#brw-status")!;
    s.textContent = msg;
    s.style.color = error ? "var(--color-error)" : "var(--color-text-muted)";
  }

  private updateNavButtons(): void {
    (this.el.querySelector<HTMLButtonElement>("#brw-back")!).disabled = this.historyIdx <= 0;
    (this.el.querySelector<HTMLButtonElement>("#brw-fwd")!).disabled = this.historyIdx >= this.history.length - 1;
  }

  setUrl(url: string): void {
    this.navigate(url);
  }

  private toggleInspect(): void {
    this.inspecting = !this.inspecting;
    const btn = this.el.querySelector<HTMLButtonElement>("#brw-inspect")!;
    btn.classList.toggle("browser__inspect-btn--active", this.inspecting);
    if (this.inspecting) {
      this.setStatus("🔍 Click an element to inspect and send to terminal…");
      this.iframe.style.cursor = "crosshair";
      this.iframe.addEventListener("load", this.onFrameReadyForInspect);
      this.attachInspectListenerToFrame();
    } else {
      this.iframe.style.cursor = "";
      this.setStatus(this.currentUrl || "Ready");
      this.detachInspectListenerFromFrame();
    }
  }

  private readonly onFrameReadyForInspect = (): void => {
    this.attachInspectListenerToFrame();
  };

  private attachInspectListenerToFrame(): void {
    try {
      const doc = this.iframe.contentDocument;
      if (!doc) return;
      doc.addEventListener("click", this.handleInspectClick, { capture: true });
      doc.body.style.cursor = "crosshair";
    } catch {
      this.inspecting = false;
      this.el.querySelector("#brw-inspect")!.classList.remove("browser__inspect-btn--active");
      this.iframe.style.cursor = "";
      this.setStatus("Inspect unavailable for cross-origin pages", true);
    }
  }

  private detachInspectListenerFromFrame(): void {
    try {
      const doc = this.iframe.contentDocument;
      if (!doc) return;
      doc.removeEventListener("click", this.handleInspectClick, { capture: true });
      doc.body.style.cursor = "";
    } catch { /* cross-origin */ }
  }

  private readonly handleInspectClick = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as Element;
    
    if (this.inspectMode === "single") {
      const info = this.buildElementInfo(target);
      const inspectPath = this.getInspectPath();
      this.stopInspecting();
      this.setStatus(`✓ Inspected <${target.tagName.toLowerCase()}> -> saved to ${inspectPath}`);
      this.deliverInspect(info);
    } else {
      const isMultiClick = e.ctrlKey || e.metaKey || e.shiftKey;
      if (!this.selectedElements.includes(target)) {
        this.selectedElements.push(target);
        try { (target as HTMLElement).style.outline = "2px solid #ff6b6b"; } catch {}
      }
      const count = this.selectedElements.length;

      if (!isMultiClick && count > 0) {
        // Final click without modifier → send all collected
        const combinedInfo = this.buildMultiElementInfo(this.selectedElements);
        const inspectPath = this.getInspectPath();
        try {
          this.selectedElements.forEach((el) => {
            try { (el as HTMLElement).style.outline = ""; } catch {}
          });
        } catch {}
        this.stopInspecting();
        this.setStatus(`✓ Inspected ${count} element(s) -> saved to ${inspectPath}`);
        this.deliverInspect(combinedInfo);
        this.selectedElements = [];
      } else {
        this.setStatus(`Selected ${count} element(s) — Cmd/Shift+click to add more, plain click to send`);
      }
    }
  };

  /** Save inspect data to file and notify via onInspect callback */
  private deliverInspect(info: string): void {
    const inspectPath = this.getInspectPath();
    const ts = new Date().toISOString();
    const fileContent = `\n---\n# Inspect - ${ts}\nProject: ${this.projectPath ?? "(none)"}\nURL: ${this.currentUrl}\n\n${info}\n`;
    writeFileContent(inspectPath, fileContent)
      .then(() => this.setStatus(`✓ Inspect saved to ${inspectPath}`))
      .catch(() => {/* best-effort */});
    trackActivity({
      skill: "browser-inspector",
      tool: "write_file_content",
      detail: `Inspect appended (${this.inspectMode})`,
      workspace: this.projectPath ?? ".",
    });
    if (this.onInspect) {
      this.onInspect(info, this.currentUrl, inspectPath);
    }
  }

  private getInspectPath(): string {
    const project = this.projectPath?.trim();
    const projectName = project ? project.split("/").filter(Boolean).pop() ?? "project" : "global";
    const host = this.getCurrentHost();
    const key = project ?? host ?? this.currentUrl ?? "global";
    const hash = this.hashString(key).toString(16).padStart(8, "0").slice(-8);
    const slug = this.slugify(project ? projectName : host ?? "global");
    return `~/.terminus/inspect/${slug}-${hash}.md`;
  }

  private getCurrentHost(): string | null {
    try {
      return new URL(this.currentUrl).hostname || null;
    } catch {
      return null;
    }
  }

  private slugify(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
  }

  private hashString(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  private stopInspecting(): void {
    this.inspecting = false;
    this.el.querySelector("#brw-inspect")!.classList.remove("browser__inspect-btn--active");
    this.iframe.style.cursor = "";
    try {
      const doc = this.iframe.contentDocument!;
      doc.removeEventListener("click", this.handleInspectClick, { capture: true });
      doc.body.style.cursor = "";
    } catch { /* cross-origin */ }
  }

  private buildMultiElementInfo(elements: Element[]): string {
    const infos = elements.map((el, idx) => {
      const tag = el.tagName.toLowerCase();
      const attrs = Array.from(el.attributes).slice(0, 3).map((a) => `${a.name}="${a.value}"`).join(" ");
      return `  [${idx + 1}] <${tag}> ${attrs ? `(${attrs})` : ""}`;
    }).join("\n");
    return `╔═══ MULTI-ELEMENT SELECTION ═══╗\n${infos}\n╚══════════════════════════════╝`;
  }

  private buildElementInfo(el: Element): string {
    const tag = el.tagName.toLowerCase();
    const attrs = Array.from(el.attributes)
      .map((a) => `${a.name}="${a.value}"`)
      .join(" ");
    const outerHtml = el.outerHTML.slice(0, 3000);

    const path: string[] = [];
    let node: Element | null = el;
    while (node && node.tagName) {
      let sel = node.tagName.toLowerCase();
      if (node.id) sel += `#${node.id}`;
      else if (node.className) sel += `.${String(node.className).split(" ")[0]}`;
      path.unshift(sel);
      node = node.parentElement;
    }

    let styles = "";
    try {
      const cs = this.iframe.contentWindow!.getComputedStyle(el);
      const keys = ["display","position","width","height","margin","padding","color","background-color","font-size","flex","grid"];
      styles = keys.map((k) => `  ${k}: ${cs.getPropertyValue(k)}`).join("\n");
    } catch { styles = "  (unavailable)"; }

    return `╔═══ ELEMENT INSPECTOR ═══╗
  Tag: <${tag}>
  Selector: ${path.join(" > ")}
  Attributes: ${attrs || "(none)"}

  Computed Styles:
  ${styles}

  HTML:
  ${outerHtml}
  ╚════════════════════════════╝`;
  }

  private wrapHtmlForSrcdoc(html: string, baseUrl: string): string {
    let processed = html;
    // 1. Strip any existing CSP meta tags from the fetched HTML — their restrictions
    //    would override our permissive one even if ours comes later.
    processed = processed.replace(/<meta[^>]+http-equiv=["']content-security-policy["'][^>]*>/gi, "");
    processed = processed.replace(/<meta[^>]+content-security-policy[^>]*http-equiv[^>]*>/gi, "");
    
    // 2. Rewrite ALL relative URLs to absolute before setting srcdoc
    processed = this.rewriteRelativeUrls(processed, baseUrl);

    const baseTag = `<base href="${this.escapeAttr(baseUrl)}">`;
    // 3. Inject our permissive CSP
    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; style-src * 'unsafe-inline'; script-src * 'unsafe-inline' 'unsafe-eval'; img-src * data: blob: https: http:; font-src * data: https: http:; connect-src *;">`;
    // 4. Inject a MutationObserver script to rewrite URLs that JavaScript adds dynamically
    const patchScript = `<script>
(function(){
  var base="${this.escapeAttr(baseUrl)}";
  var origin=(function(){try{var u=new URL(base);return u.origin;}catch(e){return"";}})();
  function fix(el){
    var src=el.getAttribute&&el.getAttribute("src")||"";
    if(src&&!src.startsWith("http")&&!src.startsWith("data:")&&!src.startsWith("blob:")){
      el.setAttribute("src",src.startsWith("//")?("https:"+src):src.startsWith("/")?origin+src:base.replace(/\\/[^\\/]*$/,"/")+src);
    }
  }
  var obs=new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){if(n.querySelectorAll){n.querySelectorAll("img,source,video,script,link").forEach(fix);}fix(n);});});});
  document.addEventListener("DOMContentLoaded",function(){obs.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["src","href"]});});
})();
</script>`;

    if (/<head[^>]*>/i.test(processed)) {
      return processed.replace(/<head([^>]*)>/i, `<head$1>${baseTag}${cspMeta}${patchScript}`);
    }
    if (/<html[^>]*>/i.test(processed)) {
      return processed.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}${cspMeta}${patchScript}</head>`);
    }
    return `<!doctype html><html><head>${baseTag}${cspMeta}${patchScript}</head><body>${processed}</body></html>`;
  }

  /** Rewrite src/href/action attributes with relative URLs to absolute based on origin. */
  private rewriteRelativeUrls(html: string, baseUrl: string): string {
    let origin: string;
    try {
      const u = new URL(baseUrl);
      origin = u.origin;
    } catch {
      return html;
    }

    return html
      .replace(/(src|href|action|data-src|data-href|poster)=(["'])([^"'\s>]+)\2/gi, (match, attr, q, url) => {
        const abs = this.toAbsoluteUrl(url, origin, baseUrl);
        return abs ? `${attr}=${q}${abs}${q}` : match;
      })
      .replace(/url\((['"]?)([^'"\)]+)\1\)/gi, (match, q, url) => {
        const abs = this.toAbsoluteUrl(url, origin, baseUrl);
        return abs ? `url(${q}${abs}${q})` : match;
      });
  }

  private toAbsoluteUrl(url: string, origin: string, baseUrl: string): string | null {
    if (!url) return null;
    const trimmed = url.trim();
    if (
      trimmed.startsWith("data:") ||
      trimmed.startsWith("blob:") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("javascript:") ||
      trimmed.startsWith("about:")
    ) return null;
    if (/^https?:\/\//i.test(trimmed)) return null; // already absolute
    if (trimmed.startsWith("//")) return "https:" + trimmed; // protocol-relative
    if (trimmed.startsWith("/")) return origin + trimmed;    // root-relative
    try {
      return new URL(trimmed, baseUrl).href;                 // path-relative
    } catch {
      return null;
    }
  }

  private escapeAttr(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  destroy(): void {
    this.iframe.src = "about:blank";
  }
}
