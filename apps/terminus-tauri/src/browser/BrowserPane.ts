import { fetchRemoteHtml, openExternal, readFileContent, runAsk, writeFileContent } from "../ipc/bridge";
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
  private onInspect?: (html: string, url: string, inspectPath: string) => void;
  private projectPath?: string;
  private aiPanelOpen = false;
  private aiOutputEl!: HTMLElement;
  private aiInputEl!: HTMLTextAreaElement;

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
          <button class="browser__nav-btn browser__inspect-btn" id="brw-inspect" title="Click element to open AI tooltip">🔍</button>
          <button class="browser__nav-btn" id="brw-ai" title="Toggle AI Copilot">AI</button>
        </div>
        <div class="browser__status-bar" id="brw-status">Ready</div>
        <div class="browser__frame-wrap">
          <iframe class="browser__frame" id="brw-frame"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            src="about:blank"></iframe>
          <aside class="browser__ai-panel" id="brw-ai-panel" style="display:none">
            <div class="browser__ai-head">
              <strong>AI Copilot</strong>
              <span class="browser__ai-head-sub">Interactive page assistant</span>
            </div>
            <div class="browser__ai-hints">
              <button class="browser__ai-chip" id="brw-ai-chip-summary">Summarize</button>
              <button class="browser__ai-chip" id="brw-ai-chip-cta">Find CTA</button>
            </div>
            <div class="browser__ai-output" id="brw-ai-output"></div>
            <textarea class="browser__ai-input" id="brw-ai-input" rows="3" placeholder="Ask page context, or command: /click selector, /type selector | text, /focus selector"></textarea>
            <button class="browser__blocked-btn" id="brw-ai-send">Send</button>
          </aside>
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
  this.aiOutputEl = this.el.querySelector<HTMLElement>("#brw-ai-output")!;
  this.aiInputEl = this.el.querySelector<HTMLTextAreaElement>("#brw-ai-input")!;

    this.el.querySelector("#brw-go")!.addEventListener("click", () => this.navigate(this.addrInput.value));
    this.addrInput.addEventListener("keydown", (e) => { if (e.key === "Enter") this.navigate(this.addrInput.value); });
    this.el.querySelector("#brw-back")!.addEventListener("click", () => this.goBack());
    this.el.querySelector("#brw-fwd")!.addEventListener("click", () => this.goForward());
    this.el.querySelector("#brw-reload")!.addEventListener("click", () => this.reload());
    this.el.querySelector("#brw-ai")!.addEventListener("click", () => this.toggleAiPanel());
    this.el.querySelector("#brw-ai-send")!.addEventListener("click", () => void this.askAiFromInput());
    this.el.querySelector("#brw-ai-chip-summary")!.addEventListener("click", () => this.seedAiPrompt("Summarize this page and list key actions."));
    this.el.querySelector("#brw-ai-chip-cta")!.addEventListener("click", () => this.seedAiPrompt("Find the main CTA and explain how to complete the goal on this page."));
    this.aiInputEl.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void this.askAiFromInput();
      }
    });
    
    const inspectBtn = this.el.querySelector("#brw-inspect")!;
    // Left-click → single-select mode
    inspectBtn.addEventListener("click", () => {
      this.inspectMode = "single";
      this.toggleInspect();
    });
    // Right-click → multi-select mode
    inspectBtn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.inspectMode = "multi";
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

  private toggleAiPanel(): void {
    this.aiPanelOpen = !this.aiPanelOpen;
    const panel = this.el.querySelector<HTMLElement>("#brw-ai-panel")!;
    panel.style.display = this.aiPanelOpen ? "flex" : "none";
    this.el.querySelector("#brw-ai")!.classList.toggle("browser__nav-btn--active", this.aiPanelOpen);
    if (this.aiPanelOpen) {
      this.aiInputEl.focus();
      this.appendAiMessage("system", "AI Copilot ready. Try: /click .btn-primary or ask a normal question.");
      trackActivity({
        skill: "browser-copilot",
        tool: "panel_open",
        detail: "AI panel opened",
        workspace: this.projectPath ?? ".",
      });
    }
  }

  private seedAiPrompt(prompt: string): void {
    this.aiInputEl.value = prompt;
    this.aiInputEl.focus();
  }

  private async askAiFromInput(): Promise<void> {
    const raw = this.aiInputEl.value.trim();
    if (!raw) return;
    this.aiInputEl.value = "";
    this.appendAiMessage("user", raw);

    if (this.tryRunBrowserCommand(raw)) {
      return;
    }

    const context = this.getPageContext();
    const composedPrompt = `You are helping inside an embedded browser.\n\nPage context:\n${context}\n\nUser request:\n${raw}\n\nReply concisely with actionable steps.`;

    this.appendAiMessage("assistant", "Thinking...");
    try {
      trackActivity({
        skill: "browser-copilot",
        tool: "run_ask",
        detail: "Query with page context",
        workspace: this.projectPath ?? ".",
      });
      const result = await runAsk({
        workspace: this.projectPath ?? ".",
        prompt: composedPrompt,
        use_cache: true,
      });
      this.replaceLastAssistantMessage(result.content || "No response from AI.");
    } catch (error) {
      this.replaceLastAssistantMessage(`AI error: ${String(error)}`);
    }
  }

  private tryRunBrowserCommand(raw: string): boolean {
    if (!raw.startsWith("/")) return false;
    const [command, ...restParts] = raw.split(" ");
    const rest = restParts.join(" ").trim();

    if (command === "/click") {
      const ok = this.runDomCommand(rest, (doc, selector) => {
        const node = doc.querySelector<HTMLElement>(selector);
        if (!node) return "Element not found.";
        node.click();
        return `Clicked ${selector}`;
      });
      return ok;
    }

    if (command === "/focus") {
      const ok = this.runDomCommand(rest, (doc, selector) => {
        const node = doc.querySelector<HTMLElement>(selector);
        if (!node) return "Element not found.";
        node.focus();
        return `Focused ${selector}`;
      });
      return ok;
    }

    if (command === "/type") {
      const pipeIdx = rest.indexOf("|");
      if (pipeIdx === -1) {
        this.appendAiMessage("assistant", "Format: /type selector | your text");
        return true;
      }
      const selector = rest.slice(0, pipeIdx).trim();
      const value = rest.slice(pipeIdx + 1).trim();
      const ok = this.runDomCommand(selector, (doc, sel) => {
        const node = doc.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel);
        if (!node) return "Input element not found.";
        node.focus();
        node.value = value;
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
        return `Typed into ${sel}`;
      });
      return ok;
    }

    this.appendAiMessage("assistant", "Unknown command. Available: /click, /focus, /type");
    return true;
  }

  private runDomCommand(selector: string, fn: (doc: Document, selector: string) => string): boolean {
    if (!selector) {
      this.appendAiMessage("assistant", "Selector required.");
      return true;
    }
    try {
      const doc = this.iframe.contentDocument;
      if (!doc) {
        this.appendAiMessage("assistant", "Page DOM is unavailable.");
        return true;
      }
      const output = fn(doc, selector);
      this.appendAiMessage("assistant", output);
      trackActivity({
        skill: "browser-automation",
        tool: "dom_command",
        detail: output,
        workspace: this.projectPath ?? ".",
      });
      return true;
    } catch {
      this.appendAiMessage("assistant", "Command failed: cross-origin page restriction.");
      return true;
    }
  }

  private getPageContext(): string {
    let title = "(unknown)";
    let h1 = "";
    let links = 0;
    let forms = 0;
    try {
      const doc = this.iframe.contentDocument;
      if (doc) {
        title = doc.title || title;
        h1 = (doc.querySelector("h1")?.textContent || "").trim();
        links = doc.querySelectorAll("a").length;
        forms = doc.querySelectorAll("form").length;
      }
    } catch {
      // Ignore cross-origin read errors.
    }

    return [
      `URL: ${this.currentUrl || "(none)"}`,
      `Title: ${title}`,
      `H1: ${h1 || "(none)"}`,
      `Links: ${links}`,
      `Forms: ${forms}`,
      `Project: ${this.projectPath ?? "."}`,
    ].join("\n");
  }

  private appendAiMessage(role: "system" | "user" | "assistant", text: string): void {
    const row = document.createElement("div");
    row.className = `browser__ai-msg browser__ai-msg--${role}`;
    row.textContent = text;
    this.aiOutputEl.appendChild(row);
    this.aiOutputEl.scrollTop = this.aiOutputEl.scrollHeight;
  }

  private replaceLastAssistantMessage(text: string): void {
    const items = this.aiOutputEl.querySelectorAll<HTMLElement>(".browser__ai-msg--assistant");
    const last = items[items.length - 1];
    if (!last) {
      this.appendAiMessage("assistant", text);
      return;
    }
    last.textContent = text;
    this.aiOutputEl.scrollTop = this.aiOutputEl.scrollHeight;
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
    // Remove any existing tooltip
    this.removeInspectTooltip();
    // Highlight
    try { (target as HTMLElement).style.outline = "2px solid #38BDF8"; } catch {}
    // Get bounding rect (relative to iframe)
    let rect: DOMRect | null = null;
    try {
      rect = (target as HTMLElement).getBoundingClientRect();
    } catch {}
    // Create tooltip overlay in parent doc
    const iframe = this.iframe;
    const parentDoc = iframe.ownerDocument;
    const overlay = parentDoc.createElement("div");
    overlay.className = "browser__inspect-tooltip";
    overlay.innerHTML = `
      <div class="browser__inspect-tooltip-inner">
        <div class="browser__inspect-tooltip-title">AI Command for &lt;${target.tagName.toLowerCase()}&gt;</div>
        <textarea class="browser__inspect-tooltip-input" rows="2" placeholder="Contoh: Jelaskan fungsi tombol ini"></textarea>
        <button class="browser__inspect-tooltip-send">Send to AI</button>
        <div class="browser__inspect-tooltip-output"></div>
      </div>
    `;
    parentDoc.body.appendChild(overlay);
    // Position overlay (absolute to iframe)
    if (rect) {
      const iframeRect = iframe.getBoundingClientRect();
      overlay.style.position = "fixed";
      overlay.style.left = `${iframeRect.left + rect.left + rect.width/2 - 140}px`;
      overlay.style.top = `${iframeRect.top + rect.top - 60}px`;
      overlay.style.zIndex = "9999";
      overlay.style.width = "280px";
    }
    // Focus input
    const input = overlay.querySelector<HTMLTextAreaElement>(".browser__inspect-tooltip-input")!;
    input.focus();
    // Send handler
    const sendBtn = overlay.querySelector<HTMLButtonElement>(".browser__inspect-tooltip-send")!;
    const output = overlay.querySelector<HTMLElement>(".browser__inspect-tooltip-output")!;
    const cleanup = () => {
      try { (target as HTMLElement).style.outline = ""; } catch {}
      overlay.remove();
      parentDoc.removeEventListener("mousedown", outsideClick);
    };
    const outsideClick = (evt: MouseEvent) => {
      if (!overlay.contains(evt.target as Node)) cleanup();
    };
    parentDoc.addEventListener("mousedown", outsideClick);
    sendBtn.onclick = async () => {
      const prompt = input.value.trim();
      if (!prompt) return;
      sendBtn.disabled = true;
      output.textContent = "AI thinking...";
      // Compose context
      const context = this.buildElementInfo(target);
      this.deliverInspect(context);
      const fullPrompt = `Element context:\n${context}\n\nUser request:\n${prompt}\n\nJawab singkat, bahasa Indonesia.`;
      try {
        const result = await runAsk({
          workspace: this.projectPath ?? ".",
          prompt: fullPrompt,
          use_cache: true,
        });
        output.textContent = result.content || "No response from AI.";
      } catch (err) {
        output.textContent = `AI error: ${String(err)}`;
      }
      sendBtn.disabled = false;
    };
    // Only one tooltip at a time
    (parentDoc as any)._terminusInspectTooltip = overlay;
  };

  private removeInspectTooltip(): void {
    const parentDoc = this.iframe.ownerDocument;
    const prev = (parentDoc as any)._terminusInspectTooltip as HTMLElement | undefined;
    if (prev) prev.remove();
    (parentDoc as any)._terminusInspectTooltip = undefined;
  }

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
