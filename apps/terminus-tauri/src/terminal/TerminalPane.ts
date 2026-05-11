import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ptySpawn, ptyWrite, ptyResize, ptyKill, onPtyData, onPtyExit } from "../ipc/bridge";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";

let sessionCounter = 0;

function isDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function buildTheme(customBg?: string, customFg?: string) {
  if (isDark()) {
    return {
      background: customBg ?? "#0d1117",
      foreground: customFg ?? "#e6edf3",
      cursor: "#58a6ff",
      selectionBackground: "rgba(88,166,255,0.25)",
      black: "#0d1117", red: "#f85149", green: "#3fb950",
      yellow: "#d29922", blue: "#58a6ff", magenta: "#a371f7",
      cyan: "#39d3c3", white: "#b1bac4",
      brightBlack: "#6e7681", brightRed: "#ff7b72", brightGreen: "#56d364",
      brightYellow: "#e3b341", brightBlue: "#79c0ff", brightMagenta: "#d2a8ff",
      brightCyan: "#56d4dd", brightWhite: "#f0f6fc",
    };
  } else {
    return {
      background: customBg ?? "#f6f8fa",
      foreground: customFg ?? "#1f2328",
      cursor: "#0969da",
      selectionBackground: "rgba(9,105,218,0.15)",
      black: "#24292f", red: "#cf222e", green: "#116329",
      yellow: "#4d2d00", blue: "#0969da", magenta: "#8250df",
      cyan: "#1b7c83", white: "#6e7781",
      brightBlack: "#57606a", brightRed: "#a40e26", brightGreen: "#1a7f37",
      brightYellow: "#633c01", brightBlue: "#218bff", brightMagenta: "#a475f9",
      brightCyan: "#3192aa", brightWhite: "#32383f",
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
    
    // Better Shift+Enter handling via keydown event (for multiline input)
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.shiftKey || e.altKey || e.metaKey) && (e.key === 'Enter' || e.code === 'Enter')) {
        e.preventDefault();
        ptyWrite(this.sessionId, '\n').catch(() => {});  // Insert newline without executing
      }
    };
    this.el.addEventListener('keydown', handleKeyDown);
    this.unlisten.push(() => this.el.removeEventListener('keydown', handleKeyDown));
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

  private loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem("pty-settings") ?? "{}");
      return {
        fontSize: s.fontSize ?? 13,
        lineHeight: s.lineHeight ?? 1.3,
        fontFamily: s.fontFamily ?? '"JetBrains Mono", Menlo, "Fira Code", monospace',
        bgColor: s.bgColor ?? undefined,
        fgColor: s.fgColor ?? undefined,
      };
    } catch {
      return {
        fontSize: 13,
        lineHeight: 1.3,
        fontFamily: '"JetBrains Mono", Menlo, "Fira Code", monospace',
        bgColor: undefined,
        fgColor: undefined,
      };
    }
  }

  private saveSettings(partial: Partial<ReturnType<typeof this.loadSettings>>): void {
    const current = this.loadSettings();
    localStorage.setItem("pty-settings", JSON.stringify({ ...current, ...partial }));
  }

  destroy(): void {
    this.unlisten.forEach((fn) => fn());
    this.resizeObs?.disconnect();
    ptyKill(this.sessionId).catch(() => {});
    this.term.dispose();
  }
}

