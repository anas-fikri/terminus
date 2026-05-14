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
  themePreset?: ThemePreset;
  keepCustomColorsOnPreset?: boolean;
}

type ThemePreset = "soft" | "warm" | "mint";

const DEFAULT_THEME_PRESET: ThemePreset = "soft";

function isDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function presetTheme(preset: ThemePreset, dark: boolean) {
  if (dark) {
    if (preset === "warm") {
      return {
        background: "#2a2421",
        foreground: "#e8ddd3",
        cursor: "#e0b387",
        selectionBackground: "rgba(224,179,135,0.22)",
        black: "#4f433d", red: "#d7aaa0", green: "#b8c9a4",
        yellow: "#ddc19c", blue: "#b0bfd8", magenta: "#cdb2d8",
        cyan: "#aacac5", white: "#d8cec5",
        brightBlack: "#73655d", brightRed: "#e5bdb4", brightGreen: "#c8d9b6",
        brightYellow: "#e7d2b4", brightBlue: "#c1cee3", brightMagenta: "#dbc7e4",
        brightCyan: "#bddcd7", brightWhite: "#f0e8e1",
      };
    }
    if (preset === "mint") {
      return {
        background: "#1f2a2a",
        foreground: "#d6e6e2",
        cursor: "#9acfc4",
        selectionBackground: "rgba(154,207,196,0.24)",
        black: "#425454", red: "#d4a7ac", green: "#9fc9b0",
        yellow: "#d7cf9f", blue: "#a4c0d8", magenta: "#c1b3d7",
        cyan: "#8fcac1", white: "#c9d7d4",
        brightBlack: "#657978", brightRed: "#e2bac0", brightGreen: "#b6dbc6",
        brightYellow: "#e2dcb8", brightBlue: "#bad0e5", brightMagenta: "#d2c4e4",
        brightCyan: "#addcd5", brightWhite: "#e6f0ee",
      };
    }
    return {
      background: "#20252b",
      foreground: "#d8dee6",
      cursor: "#9fc2e8",
      selectionBackground: "rgba(159,194,232,0.22)",
      black: "#424a52", red: "#d8a6a6", green: "#a7c5a6",
      yellow: "#d8c5a1", blue: "#a8bdd8", magenta: "#c7b0d8",
      cyan: "#9fc7c3", white: "#c8ced6",
      brightBlack: "#66707a", brightRed: "#e5b9b9", brightGreen: "#bdd9bc",
      brightYellow: "#e4d3b6", brightBlue: "#bfd0e5", brightMagenta: "#d6c3e4",
      brightCyan: "#b8d9d6", brightWhite: "#e7ebf0",
    };
  }

  if (preset === "warm") {
    return {
      background: "#f8f1e6",
      foreground: "#4b4038",
      cursor: "#b48656",
      selectionBackground: "rgba(180,134,86,0.16)",
      black: "#6a5e55", red: "#c9978f", green: "#92b088",
      yellow: "#c7a972", blue: "#8fa7c4", magenta: "#ae94bf",
      cyan: "#88b2ab", white: "#d7ccbf",
      brightBlack: "#8f8177", brightRed: "#ddafa7", brightGreen: "#a8c39f",
      brightYellow: "#dbc396", brightBlue: "#a8bdd5", brightMagenta: "#c0afd3",
      brightCyan: "#a3c8c2", brightWhite: "#fefaf3",
    };
  }
  if (preset === "mint") {
    return {
      background: "#eef6f3",
      foreground: "#36504a",
      cursor: "#5f9f93",
      selectionBackground: "rgba(95,159,147,0.16)",
      black: "#5c706b", red: "#bf8f95", green: "#7fae95",
      yellow: "#b9ae79", blue: "#87a9c2", magenta: "#a291c0",
      cyan: "#70a9a1", white: "#cddbd6",
      brightBlack: "#80938f", brightRed: "#d2a7ae", brightGreen: "#99c1ad",
      brightYellow: "#cdc59b", brightBlue: "#a3bfd5", brightMagenta: "#b8abd1",
      brightCyan: "#8dc0b9", brightWhite: "#fbfefd",
    };
  }
  return {
    background: "#f7f3ee",
    foreground: "#34404d",
    cursor: "#5f88b6",
    selectionBackground: "rgba(95,136,182,0.14)",
    black: "#5b646e", red: "#c58f8f", green: "#8fb58c",
    yellow: "#c6ad81", blue: "#8ea8c8", magenta: "#b09ac5",
    cyan: "#88b6b1", white: "#d6d0c8",
    brightBlack: "#808992", brightRed: "#d9aaaa", brightGreen: "#a7cda4",
    brightYellow: "#d9c29f", brightBlue: "#abc0db", brightMagenta: "#c3b1d7",
    brightCyan: "#a5ceca", brightWhite: "#faf8f4",
  };
}

function buildTheme(customBg?: string, customFg?: string, preset: ThemePreset = DEFAULT_THEME_PRESET) {
  const base = presetTheme(preset, isDark());
  return {
    ...base,
    background: customBg ?? base.background,
    foreground: customFg ?? base.foreground,
  };
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
            <label>Theme</label>
            <select class="pty-settings-input" id="pty-theme">
              <option value="soft">Pastel Soft</option>
              <option value="warm">Pastel Warm</option>
              <option value="mint">Pastel Mint</option>
            </select>
            <label>Keep custom</label>
            <input type="checkbox" id="pty-keep-colors" />
          </div>
        </div>
        <button class="pty-settings-toggle" id="pty-settings-btn" title="Terminal Settings">⚙</button>
      </div>
    `;
    const wrap = this.el.querySelector<HTMLElement>(`#pty-${this.sessionId}`)!;
    const settingsPanel = this.el.querySelector<HTMLElement>("#pty-settings")!;
    const settingsBtn = this.el.querySelector<HTMLButtonElement>("#pty-settings-btn")!;

    // Load settings from localStorage
    let settings = this.loadSettings();
    
    this.term = new Terminal({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: "block",
      allowTransparency: false,
      scrollback: 5000,
      theme: buildTheme(settings.bgColor, settings.fgColor, settings.themePreset),
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

      // Handle Shift/Alt/Meta+Enter for multiline
      if (isShiftEnter || isAltEnter || isMetaEnter) {
        ptyWrite(this.sessionId, '\n').catch(() => {});
        return false;
      }

      // Handle Backspace
      if ((e.key === 'Backspace' || e.code === 'Backspace') && e.type === 'keydown') {
        ptyWrite(this.sessionId, '\x7f').catch(() => {}); // ASCII DEL
        return false;
      }

      // Handle Delete
      if ((e.key === 'Delete' || e.code === 'Delete') && e.type === 'keydown') {
        ptyWrite(this.sessionId, '\x1b[3~').catch(() => {}); // VT100 Delete
        return false;
      }

      return true; // Let xterm handle other keys
    });
    // Settings panel controls
    settingsBtn.addEventListener("click", () => {
      settingsPanel.classList.toggle("pty-settings-panel--open");
    });

    const fsInput = this.el.querySelector<HTMLInputElement>("#pty-fs")!;
    const lhInput = this.el.querySelector<HTMLInputElement>("#pty-lh")!;
    const bgInput = this.el.querySelector<HTMLInputElement>("#pty-bg")!;
    const fgInput = this.el.querySelector<HTMLInputElement>("#pty-fg")!;
    const themeInput = this.el.querySelector<HTMLSelectElement>("#pty-theme")!;
    const keepColorsInput = this.el.querySelector<HTMLInputElement>("#pty-keep-colors")!;

    const initialTheme = buildTheme(settings.bgColor, settings.fgColor, settings.themePreset);
    fsInput.value = String(settings.fontSize);
    lhInput.value = String(settings.lineHeight);
    bgInput.value = initialTheme.background;
    fgInput.value = initialTheme.foreground;
    themeInput.value = settings.themePreset ?? DEFAULT_THEME_PRESET;
    keepColorsInput.checked = settings.keepCustomColorsOnPreset ?? false;

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
      settings = { ...settings, bgColor: bg };
      this.term.options.theme = buildTheme(bg, settings.fgColor, settings.themePreset);
      this.saveSettings({ bgColor: bg });
    });

    fgInput.addEventListener("change", () => {
      const fg = fgInput.value;
      settings = { ...settings, fgColor: fg };
      this.term.options.theme = buildTheme(settings.bgColor, fg, settings.themePreset);
      this.saveSettings({ fgColor: fg });
    });

    themeInput.addEventListener("change", () => {
      const preset = themeInput.value as ThemePreset;
      const keepCustom = keepColorsInput.checked;
      const nextBg = keepCustom ? settings.bgColor : undefined;
      const nextFg = keepCustom ? settings.fgColor : undefined;
      settings = { ...settings, themePreset: preset, bgColor: nextBg, fgColor: nextFg };
      const nextTheme = buildTheme(nextBg, nextFg, preset);
      this.term.options.theme = nextTheme;
      bgInput.value = nextTheme.background;
      fgInput.value = nextTheme.foreground;
      this.saveSettings({ themePreset: preset, bgColor: nextBg, fgColor: nextFg });
    });

    keepColorsInput.addEventListener("change", () => {
      const keepCustom = keepColorsInput.checked;
      if (keepCustom) {
        settings = { ...settings, keepCustomColorsOnPreset: true, bgColor: bgInput.value, fgColor: fgInput.value };
        this.saveSettings({ keepCustomColorsOnPreset: true, bgColor: bgInput.value, fgColor: fgInput.value });
        return;
      }
      const preset = settings.themePreset ?? DEFAULT_THEME_PRESET;
      const nextTheme = buildTheme(undefined, undefined, preset);
      settings = { ...settings, keepCustomColorsOnPreset: false, bgColor: undefined, fgColor: undefined };
      this.term.options.theme = nextTheme;
      bgInput.value = nextTheme.background;
      fgInput.value = nextTheme.foreground;
      this.saveSettings({ keepCustomColorsOnPreset: false, bgColor: undefined, fgColor: undefined });
    });

    // Follow system theme changes live
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      this.term.options.theme = buildTheme(settings.bgColor, settings.fgColor, settings.themePreset);
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
      themePreset: s.themePreset ?? DEFAULT_THEME_PRESET,
      keepCustomColorsOnPreset: s.keepCustomColorsOnPreset ?? false,
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

