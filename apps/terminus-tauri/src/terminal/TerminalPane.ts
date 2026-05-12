import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ptySpawn, ptyWrite, ptyResize, ptyKill, onPtyData, onPtyExit } from "../ipc/bridge";
import { readVersionedStorage, writeVersionedStorage } from "../utils/versionedStorage";
import { ActivityPanel } from "../activity/ActivityPanel";
import type { InspectSubmission } from "../browser/BrowserPane";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";

let sessionCounter = 0;

interface TerminalSettings {
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  bgColor?: string;
  fgColor?: string;
}

function isDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function buildTheme(customBg?: string, customFg?: string) {
  if (isDark()) {
    // Pastel dark theme - soft gray background with good contrast
    return {
      background: customBg ?? "#1a1a1e",  // Soft dark gray pastel
      foreground: customFg ?? "#e8e8e8",  // Soft white
      cursor: "#a8d8ff",
      selectionBackground: "rgba(168,216,255,0.2)",
      black: "#3a3a3e", red: "#ff9999", green: "#99ff99",
      yellow: "#ffdd99", blue: "#99ccff", magenta: "#dd99ff",
      cyan: "#99ffdd", white: "#d0d0d0",
      brightBlack: "#666666", brightRed: "#ffb3b3", brightGreen: "#b3ffb3",
      brightYellow: "#ffffb3", brightBlue: "#b3ddff", brightMagenta: "#ffb3ff",
      brightCyan: "#b3ffff", brightWhite: "#f0f0f0",
    };
  } else {
    // Pastel light theme - soft beige/cream background
    return {
      background: customBg ?? "#fef9f3",  // Warm cream pastel
      foreground: customFg ?? "#333333",  // Soft dark gray
      cursor: "#0066cc",
      selectionBackground: "rgba(51,102,204,0.12)",
      black: "#555555", red: "#cc6666", green: "#66aa66",
      yellow: "#ccaa44", blue: "#6688dd", magenta: "#aa66cc",
      cyan: "#66aaaa", white: "#cccccc",
      brightBlack: "#888888", brightRed: "#ff9999", brightGreen: "#99dd99",
      brightYellow: "#ffdd77", brightBlue: "#99bbff", brightMagenta: "#dd99ff",
      brightCyan: "#99dddd", brightWhite: "#ffffff",
    };
  }
}

export class TerminalPane {
  private el: HTMLElement;
  private term!: Terminal;
  private fitAddon!: FitAddon;
  private sessionId: string;
  private workspace: string = ".";
  private unlisten: Array<() => void> = [];
  private resizeObs?: ResizeObserver;
  private started = false;
  private initialFitted = false;
  private pendingCommands: string[] = [];
  private settingsRev = 0;

  constructor(el: HTMLElement) {
    this.el = el;
    this.sessionId = `pty-${++sessionCounter}-${Date.now()}`;
    this.mount();
  }

  private mount(): void {
    this.el.innerHTML = `
      <div class="pty-container">
        <div class="pty-wrap" id="pty-${this.sessionId}"></div>
        <div class="pty-settings-panel" id="pty-settings">
          <div class="pty-settings-grid">
            <label>Font Size</label>
            <input class="pty-settings-input" type="range" id="pty-fs" min="10" max="18" value="13" />
            <label>Line Height</label>
            <input class="pty-settings-input" type="range" id="pty-lh" min="1" max="2" step="0.05" value="1.3" />
            <label>BG Color</label>
            <input class="pty-settings-input" type="color" id="pty-bg" />
            <label>FG Color</label>
            <input class="pty-settings-input" type="color" id="pty-fg" />
          </div>
        </div>
        <button class="pty-settings-toggle" id="pty-settings-btn" title="Terminal Settings">⚙</button>
      </div>
    `;
    const wrap = this.el.querySelector<HTMLElement>(`#pty-${this.sessionId}`)!;
    const settingsPanel = this.el.querySelector<HTMLElement>("#pty-settings")!;
    const settingsBtn = this.el.querySelector<HTMLButtonElement>("#pty-settings-btn")!;

    // Load settings from localStorage
    const settings = this.loadSettings();
    
    this.term = new Terminal({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: "block",
      allowTransparency: false,
      scrollback: 5000,
      theme: buildTheme(settings.bgColor, settings.fgColor),
      cols: 80,  // Force default cols to avoid 1
      rows: 24,  // Force default rows
    });

    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(new WebLinksAddon());
    this.term.open(wrap);

    // Re-fit on container resize
    this.resizeObs = new ResizeObserver(() => {
      try { this.fitAddon.fit(); } catch {}
      if (this.started) {
        ptyResize(this.sessionId, this.term.cols, this.term.rows).catch(() => {});
      }
    });
    this.resizeObs.observe(this.el);

    // Key input → PTY (with Shift+Enter support for multiline)
    this.term.onData((data) => {
      if (!this.started) return;
      ptyWrite(this.sessionId, data).catch(() => {});
    });
    
    // Shift+Enter for multiline input (intercept at xterm level)
    this.term.attachCustomKeyEventHandler((e) => {
      const isShiftEnter = e.shiftKey && (e.key === 'Enter' || e.code === 'Enter') && e.type === 'keydown';
      const isAltEnter = e.altKey && (e.key === 'Enter' || e.code === 'Enter') && e.type === 'keydown';
      const isMetaEnter = e.metaKey && (e.key === 'Enter' || e.code === 'Enter') && e.type === 'keydown';
      
      if (isShiftEnter || isAltEnter || isMetaEnter) {
        ptyWrite(this.sessionId, '\n').catch(() => {});
        return false; // Return false to prevent xterm default handling
      }
      return true; // Return true to let xterm handle the key normally
    });
    // Settings panel controls
    settingsBtn.addEventListener("click", () => {
      settingsPanel.classList.toggle("pty-settings-panel--open");
    });

    const fsInput = this.el.querySelector<HTMLInputElement>("#pty-fs")!;
    const lhInput = this.el.querySelector<HTMLInputElement>("#pty-lh")!;
    const bgInput = this.el.querySelector<HTMLInputElement>("#pty-bg")!;
    const fgInput = this.el.querySelector<HTMLInputElement>("#pty-fg")!;

    fsInput.addEventListener("change", () => {
      const sz = parseInt(fsInput.value);
      this.term.options.fontSize = sz;
      this.fitAddon.fit();
      this.saveSettings({ fontSize: sz });
    });

    lhInput.addEventListener("change", () => {
      const lh = parseFloat(lhInput.value);
      this.term.options.lineHeight = lh;
      this.fitAddon.fit();
      this.saveSettings({ lineHeight: lh });
    });

    bgInput.addEventListener("change", () => {
      const bg = bgInput.value;
      this.term.options.theme = buildTheme(bg, settings.fgColor);
      this.saveSettings({ bgColor: bg });
    });

    fgInput.addEventListener("change", () => {
      const fg = fgInput.value;
      this.term.options.theme = buildTheme(settings.bgColor, fg);
      this.saveSettings({ fgColor: fg });
    });

    // Follow system theme changes live
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      this.term.options.theme = buildTheme(settings.bgColor, settings.fgColor);
    });
  }

  /** Called by Shell after making this pane visible */
  show(): void {
    // Aggressive fit: multiple RAF frames to ensure layout settled
    let frameCount = 0;
    const maxFrames = 5;
    
    const doFit = () => {
      frameCount++;
      try {
        this.fitAddon.fit();
        if (this.started) {
          ptyResize(this.sessionId, this.term.cols, this.term.rows).catch(() => {});
        }
      } catch (e) {
        // Ignore fit errors
      }
      
      // Retry a few times to ensure fit sticks
      if (frameCount < maxFrames) {
        requestAnimationFrame(doFit);
      } else {
        this.initialFitted = true;
      }
    };
    
    // Also start PTY if not already started
    if (!this.started) {
      this.startPty();
    }
    
    this.term.focus();
    doFit();
  }

  private async startPty(): Promise<void> {
    try {
      let dataReceived = false;
      
      const unlData = await onPtyData(this.sessionId, (data) => {
        // First data: aggressive fit
        if (!dataReceived && !this.initialFitted) {
          dataReceived = true;
          try { this.fitAddon.fit(); } catch {}
        }
        this.term.write(data);
      });
      
      const unlExit = await onPtyExit(this.sessionId, () => {
        this.term.writeln("\r\n\x1b[90m[process exited]\x1b[0m");
        this.started = false;
      });
      this.unlisten.push(unlData, unlExit);

      await ptySpawn(this.sessionId, this.workspace === "." ? undefined : this.workspace);
      this.started = true;

      for (const command of this.pendingCommands.splice(0)) {
        ptyWrite(this.sessionId, `${command}\r`).catch(() => {});
      }
      
      // Fit after spawn
      try { this.fitAddon.fit(); } catch {}
      this.term.focus();
    } catch (e) {
      this.term.writeln(`\x1b[31mFailed to start terminal: ${e}\x1b[0m`);
    }
  }

  setWorkspace(workspace: string): void {
    this.workspace = workspace;
    if (this.started) {
      ptyWrite(this.sessionId, `cd ${JSON.stringify(workspace)}\r`).catch(() => {});
    }
  }

  runCommand(command: string): void {
    if (!command.trim()) return;
    if (!this.started) {
      this.pendingCommands.push(command);
      return;
    }
    ActivityPanel.trackCommand(command, this.workspace);
    ptyWrite(this.sessionId, `${command}\r`).catch(() => {});
    this.term.focus();
  }

  private formatAttachToken(path: string): string {
    // Keep attachment text shell-safe but simple for AI CLIs to parse.
    return `${JSON.stringify(path)} `;
  }

  private formatAttachContentBlock(
    name: string,
    content: string,
    sourcePath?: string,
    mode: "read" | "source" = "source"
  ): string {
    const maxChars = 12000;
    const clipped = content.length > maxChars;
    const safe = clipped ? `${content.slice(0, maxChars)}\n\n[truncated ${content.length - maxChars} chars]` : content;
    const header = sourcePath
      ? `[ATTACH:${mode.toUpperCase()}] ${name} (${sourcePath})`
      : `[ATTACH:${mode.toUpperCase()}] ${name}`;
    return `${header}\n\n${safe}\n`;
  }

  private formatInlineAttachText(content: string, sourcePath?: string): string {
    const maxChars = 4000;
    const clipped = content.length > maxChars;
    const safe = clipped ? `${content.slice(0, maxChars)}\n\n[truncated ${content.length - maxChars} chars]` : content;
    const compact = safe.replace(/\r?\n/g, "\\n");
    const prefix = sourcePath ? `[ATTACH:SELECTION ${sourcePath}]` : "[ATTACH:SELECTION]";
    return `${prefix} ${JSON.stringify(compact)} `;
  }

  attachFile(path: string): void {
    if (this.started) {
      ptyWrite(this.sessionId, this.formatAttachToken(path)).catch(() => {});
      this.term.focus();
    }
  }

  attachFileContent(name: string, content: string, sourcePath?: string, mode: "read" | "source" = "source"): void {
    if (this.started) {
      const payload = this.formatAttachContentBlock(name, content, sourcePath, mode);
      ptyWrite(this.sessionId, payload).catch(() => {});
      this.term.focus();
    }
  }

  attachInlineSelection(content: string, sourcePath?: string): void {
    if (this.started) {
      const payload = this.formatInlineAttachText(content, sourcePath);
      ptyWrite(this.sessionId, payload).catch(() => {});
      this.term.focus();
    }
  }

  executeInspectSubmission(submission: InspectSubmission): void {
    if (!this.started) return;
    const cliPayload = JSON.stringify({
      prompt: submission.prompt,
      url: submission.url,
      inspectPath: submission.inspectPath,
      element: submission.element,
    });
    // Send one-line payload and press Enter so active CLI can execute immediately.
    const command = `INSPECT_TASK ${cliPayload}\r`;
    ptyWrite(this.sessionId, command).catch(() => {});
    this.term.focus();
  }

  injectInspectContext(_html: string, _url: string, inspectPath = "~/.terminus/inspect.md"): void {
    // Display compact summary in terminal + file path for AI agent to reference
    if (_html) {
      // Show compact summary directly (not as shell input)
      const preview = _html.split('\n').slice(0, 6).join('\r\n');
      this.term.write(`\r\n\x1b[36m━━━ Element Inspector ━━━\x1b[0m\r\n`);
      this.term.write(`\x1b[90m${preview}\x1b[0m\r\n`);
      this.term.write(`\x1b[33m► Full data: ${inspectPath}\x1b[0m\r\n`);
      this.term.write(`\x1b[90m━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\r\n`);
    }
    this.term.focus();
  }

  focus(): void {
    this.term.focus();
  }

  private loadSettings(): TerminalSettings {
    const stored = readVersionedStorage<Partial<TerminalSettings>>("pty-settings", {});
    this.settingsRev = stored.meta.rev;
    const s = stored.value;
    return {
      fontSize: s.fontSize ?? 13,
      lineHeight: s.lineHeight ?? 1.3,
      fontFamily: s.fontFamily ?? '"JetBrains Mono", Menlo, "Fira Code", monospace',
      bgColor: s.bgColor ?? undefined,
      fgColor: s.fgColor ?? undefined,
    };
  }

  private saveSettings(partial: Partial<TerminalSettings>): void {
    const current = this.loadSettings();
    const next = writeVersionedStorage("pty-settings", { ...current, ...partial }, this.settingsRev);
    this.settingsRev = next.meta.rev;
  }

  destroy(): void {
    this.unlisten.forEach((fn) => fn());
    this.resizeObs?.disconnect();
    ptyKill(this.sessionId).catch(() => {});
    this.term.dispose();
  }
}

