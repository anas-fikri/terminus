import { TabBar } from "./TabBar";
import { Explorer } from "../explorer/Explorer";
import { TerminalPane } from "../terminal/TerminalPane";
import { StatusBar } from "../status/StatusBar";
import { ViewerPane, type ViewerAttachment } from "../viewer/ViewerPane";
import { BrowserPane } from "../browser/BrowserPane";
import { ProjectsPanel } from "../projects/ProjectsPanel";
import { getTree, readFileContent, type TreeNode } from "../ipc/bridge";
import { attachResizeHandle } from "../utils/resize";
import { trackActivity } from "../status/ActivityMonitor";
import "./shell.css";

export type TabType = "session" | "viewer" | "browser";

export interface Tab {
  id: string;
  label: string;
  workspace: string;
  type: TabType;
  projectPath?: string;  // Track which project this session belongs to
  filePath?: string;
  url?: string;
}

type PaneInstance =
  | { type: "session"; pane: TerminalPane; el: HTMLElement }
  | { type: "viewer"; pane: ViewerPane; el: HTMLElement }
  | { type: "browser"; pane: BrowserPane; el: HTMLElement };

export class Shell {
  private root: HTMLElement;
  private tabs: Tab[] = [];
  private activeTabId: string | null = null;
  private panes = new Map<string, PaneInstance>();

  private tabBar!: TabBar;
  private explorer!: Explorer;
  private projectsPanel!: ProjectsPanel;
  private statusBar!: StatusBar;
  private mainEl!: HTMLElement;
  private inspectorVisible = true;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  mount(): void {
    this.root.innerHTML = `
      <div class="shell">
        <div class="shell__tabbar" id="slot-tabbar"></div>
        <div class="shell__body">
          <div class="shell__projects" id="slot-projects"></div>
          <div class="shell__main" id="slot-main"></div>
          <div class="shell__tree" id="slot-tree"></div>
        </div>
        <div class="shell__statusbar" id="slot-statusbar"></div>
      </div>
    `;

    this.mainEl = this.root.querySelector("#slot-main")!;

    this.tabBar = new TabBar(
      this.root.querySelector("#slot-tabbar")!,
      {
        onActivate: (id) => this.activateTab(id),
        onNew: () => this.newSessionTab(),
        onNewViewer: () => this.newViewerTab(),
        onNewBrowser: (url) => this.newBrowserTab(url),
        onToggleInspector: () => this.toggleInspector(),
        onOpenProject: () => this.projectsPanel.browsePicker(),
        onClose: (id) => this.closeTab(id),
      }
    );

    this.projectsPanel = new ProjectsPanel(
      this.root.querySelector("#slot-projects")!,
      (path) => this.openProject(path)
    );

    this.explorer = new Explorer(
      this.root.querySelector("#slot-tree")!,
      (path) => this.openFile(path),
      (path) => this.attachFileToActiveSession(path)
    );

    this.statusBar = new StatusBar(this.root.querySelector("#slot-statusbar")!);

    // Attach resize handles
    const body = this.root.querySelector<HTMLElement>(".shell__body")!;
    const projectsEl = this.root.querySelector<HTMLElement>("#slot-projects")!;
    const treeEl = this.root.querySelector<HTMLElement>("#slot-tree")!;
    attachResizeHandle(body, projectsEl, this.mainEl, "horizontal", "terminus-projects-width");
    attachResizeHandle(body, this.mainEl, treeEl, "horizontal", "terminus-tree-width");

    // Setup keyboard shortcuts
    this.setupKeyboardShortcuts();

    // Create initial session tab
    this.newSessionTab();
  }

  private setupKeyboardShortcuts(): void {
    document.addEventListener("keydown", (e) => {
      // Command+W (macOS) or Ctrl+W (Windows/Linux) to close tab
      if ((e.metaKey || e.ctrlKey) && e.key === "w") {
        e.preventDefault();
        if (this.activeTabId) {
          this.closeTab(this.activeTabId);
        }
      }

      // Command+T / Ctrl+T to new session
      if ((e.metaKey || e.ctrlKey) && e.key === "t") {
        e.preventDefault();
        this.newSessionTab();
      }

      // Command+N / Ctrl+N to new browser
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        this.newBrowserTab();
      }

      // Command+Shift+L / Ctrl+Shift+L to toggle inspector
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "l") {
        e.preventDefault();
        this.toggleInspector();
      }
    });
  }

  // ── Tab management ──

  newSessionTab(workspace = ".", projectPath?: string): void {
    const id = `tab-${Date.now()}`;
    const label = projectPath 
      ? projectPath.split("/").pop() ?? projectPath
      : "Session";
    const tab: Tab = { 
      id, 
      label, 
      workspace, 
      type: "session",
      projectPath 
    };
    this.tabs.push(tab);
    this.activateTab(id);
  }

  newViewerTab(filePath?: string): void {
    const id = `tab-${Date.now()}`;
    const name = filePath ? filePath.split("/").pop()! : "Viewer";
    const tab: Tab = { id, label: name, workspace: ".", type: "viewer", filePath };
    this.tabs.push(tab);
    this.activateTab(id); // creates the pane
    if (filePath) {
      // pane is now in this.panes after activateTab
      const inst = this.panes.get(id);
      if (inst?.type === "viewer") {
        inst.pane.open({ kind: "file", path: filePath });
      }
    }
  }

  newBrowserTab(url = "", projectPath?: string): void {
    const id = `tab-${Date.now()}`;
    const label = projectPath ? `${projectPath.split("/").filter(Boolean).pop() ?? projectPath} Preview` : url || "Browser";
    const tab: Tab = { id, label, workspace: ".", type: "browser", url, projectPath };
    this.tabs.push(tab);
    this.activateTab(id);
    if (url) {
      const inst = this.panes.get(id);
      if (inst?.type === "browser") inst.pane.setUrl(url);
    }
  }

  closeTab(id: string): void {
    const inst = this.panes.get(id);
    if (inst) { inst.el.remove(); this.panes.delete(id); }
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx !== -1) this.tabs.splice(idx, 1);

    if (this.tabs.length === 0) {
      this.newSessionTab();
      return;
    }
    if (this.activeTabId === id) {
      this.activateTab(this.tabs[Math.max(0, idx - 1)].id);
    } else {
      this.syncTabBar();
    }
  }

  private activateTab(id: string): void {
    this.activeTabId = id;

    // Create pane if not yet
    if (!this.panes.has(id)) {
      const tab = this.tabs.find((t) => t.id === id)!;
      const el = document.createElement("div");
      el.className = "shell__pane";
      this.mainEl.appendChild(el);

      let inst: PaneInstance;
      if (tab.type === "session") {
        const pane = new TerminalPane(el);
        pane.setWorkspace(tab.workspace);
        inst = { type: "session", pane, el };
      } else if (tab.type === "viewer") {
        const pane = new ViewerPane(el, (attachment) => this.attachViewerToActiveSession(attachment));
        inst = { type: "viewer", pane, el };
      } else {
        const pane = new BrowserPane(el);
        pane.setProjectContext(tab.projectPath);
        if (tab.url) pane.setUrl(tab.url);
        pane.setOnInspect((html, url, inspectPath) => this.sendInspectToTerminal(html, url, inspectPath));
        inst = { type: "browser", pane, el };
      }
      this.panes.set(id, inst);
    }

    // Show active, hide others
    this.panes.forEach((inst, tabId) => {
      inst.el.style.display = tabId === id ? "flex" : "none";
    });

    // Notify terminal pane to re-fit now that it's visible
    const active = this.panes.get(id);
    if (active?.type === "session") {
      active.pane.show();
    }

    this.syncTabBar();
  }

  private syncTabBar(): void {
    this.tabBar.setTabs(this.tabs, this.activeTabId ?? "");
  }

  // ── Inspector / tree panel toggle ──

  toggleInspector(): void {
    this.inspectorVisible = !this.inspectorVisible;
    const treeEl = this.root.querySelector<HTMLElement>("#slot-tree")!;
    treeEl.classList.toggle("shell__tree--hidden", !this.inspectorVisible);
    // Re-show (start visible)
  }

  // ── Project ──

  openProject(path: string): void {
    this.projectsPanel.setActive(path);
    this.statusBar.setWorkspace(path);
    trackActivity({
      skill: "project-context",
      tool: "open_project",
      detail: `Project active: ${path.split("/").filter(Boolean).pop() ?? path}`,
      workspace: path,
    });
    
    // Look for existing session for this project
    const existingSession = this.tabs.find(
      (t) => t.type === "session" && t.projectPath === path
    );
    
    if (existingSession) {
      // Switch to existing project session
      this.activateTab(existingSession.id);
    } else {
      // Create new session for this project
      this.newSessionTab(path, path);
    }
    
    this.explorer.load(path);
    void this.openProjectPreview(path);
  }

  private async openProjectPreview(path: string): Promise<void> {
    try {
      const tree = await getTree(path);
      const previewUrl = await this.findProjectPreviewUrl(tree);
      if (!previewUrl) return;

      const existing = this.tabs.find((t) => t.type === "browser" && t.projectPath === path);
      if (existing) {
        existing.url = previewUrl;
        existing.label = `${path.split("/").filter(Boolean).pop() ?? path} Preview`;
        this.activateTab(existing.id);
        const inst = this.panes.get(existing.id);
        if (inst?.type === "browser") inst.pane.setUrl(previewUrl);
        return;
      }

      this.newBrowserTab(previewUrl, path);
    } catch {
      // Ignore preview errors; project browsing still works.
    }
  }

  private async findProjectPreviewUrl(tree: TreeNode): Promise<string | undefined> {
    const previewFile = this.findPreviewFile(tree);
    if (previewFile) {
      return `file://${previewFile}`;
    }

    const packageJsonPath = this.findFilePath(tree, "package.json");
    if (!packageJsonPath) return undefined;

    try {
      const packageJson = JSON.parse(await readFileContent(packageJsonPath));
      const scripts = packageJson?.scripts ?? {};
      const scriptValues = Object.values(scripts).map((value) => String(value).toLowerCase());

      if (scriptValues.some((value) => value.includes("vite"))) return "http://localhost:5173";
      if (scriptValues.some((value) => value.includes("next"))) return "http://localhost:3000";
      if (scriptValues.some((value) => value.includes("nuxt"))) return "http://localhost:3000";
      if (scriptValues.some((value) => value.includes("astro"))) return "http://localhost:4321";
      if (scriptValues.some((value) => value.includes("svelte-kit") || value.includes("sveltekit"))) return "http://localhost:5173";

      const portMatch = scriptValues.join(" ").match(/localhost:(\d{2,5})/);
      if (portMatch) return `http://localhost:${portMatch[1]}`;
    } catch {
      // Ignore malformed package.json and fall through.
    }

    return undefined;
  }

  private findPreviewFile(tree: TreeNode): string | undefined {
    const preferredNames = new Set(["index.html", "index.htm"]);
    let fallback: string | undefined;

    const walk = (node: TreeNode): string | undefined => {
      if (!node.is_dir) {
        const lower = node.name.toLowerCase();
        if (preferredNames.has(lower)) return node.path;
        if (!fallback && (lower.endsWith(".html") || lower.endsWith(".htm"))) {
          fallback = node.path;
        }
        return undefined;
      }

      for (const child of node.children ?? []) {
        const found = walk(child);
        if (found) return found;
      }
      return undefined;
    };

    return walk(tree) ?? fallback;
  }

  private findFilePath(tree: TreeNode, fileName: string): string | undefined {
    if (!tree.is_dir) {
      return tree.name.toLowerCase() === fileName.toLowerCase() ? tree.path : undefined;
    }

    for (const child of tree.children ?? []) {
      const found = this.findFilePath(child, fileName);
      if (found) return found;
    }

    return undefined;
  }

  // ── Browser inspect → terminal ──

  private sendInspectToTerminal(html: string, url: string, inspectPath: string): void {
    // Find active session tab; if none, create one and then inject
    const sessionInst = this.getActiveSessionInst() ?? this.findOrCreateSessionInst();
    if (sessionInst) {
      this.activateTab(sessionInst.id);
      (this.panes.get(sessionInst.id) as { type: "session"; pane: TerminalPane; el: HTMLElement }).pane.injectInspectContext(html, url, inspectPath);
    }
  }

  private getActiveSessionInst(): Tab | undefined {
    const inst = this.panes.get(this.activeTabId ?? "");
    if (inst?.type === "session") return this.tabs.find((t) => t.id === this.activeTabId);
    return undefined;
  }

  private findOrCreateSessionInst(): Tab | undefined {
    const existing = [...this.tabs].reverse().find((t) => t.type === "session");
    if (existing) return existing;
    this.newSessionTab();
    return this.tabs[this.tabs.length - 1];
  }

  // ── File attach to active session ──

  private attachFileToActiveSession(path: string): void {
    const session = this.getOrActivateSessionPane();
    if (!session) return;
    const relativePath = this.toRelativePath(path, session.workspace);
    session.pane.attachFile(relativePath);
  }

  private attachViewerToActiveSession(attachment: ViewerAttachment): void {
    const session = this.getOrActivateSessionPane();
    if (!session) return;
    const relativePath = attachment.path
      ? this.toRelativePath(attachment.path, session.workspace)
      : undefined;
    session.pane.attachFileContent(attachment.name, attachment.content, relativePath, attachment.mode);
  }

  private getOrActivateSessionPane(): { pane: TerminalPane; workspace: string } | undefined {
    const inst = this.panes.get(this.activeTabId ?? "");
    if (inst?.type === "session") {
      const activeTab = this.tabs.find((t) => t.id === this.activeTabId);
      return { pane: inst.pane, workspace: activeTab?.workspace ?? "." };
    }

    // Find most-recent session tab and attach there
    const sessionTab = [...this.tabs].reverse().find((t) => t.type === "session");
    if (!sessionTab) return undefined;

    this.activateTab(sessionTab.id);
    const active = this.panes.get(sessionTab.id);
    if (active?.type === "session") {
      return { pane: active.pane, workspace: sessionTab.workspace };
    }

    return undefined;
  }

  private toRelativePath(path: string, base: string): string {
    if (!path) return path;
    if (!base || base === ".") return path;

    const fileParts = path.split("/").filter(Boolean);
    const baseParts = base.split("/").filter(Boolean);
    let i = 0;
    while (i < fileParts.length && i < baseParts.length && fileParts[i] === baseParts[i]) {
      i += 1;
    }

    if (i === 0) {
      return path.split("/").pop() ?? path;
    }

    const up = new Array(baseParts.length - i).fill("..");
    const down = fileParts.slice(i);
    const rel = [...up, ...down].join("/");
    return rel || ".";
  }

  // ── File open from Explorer ──

  openFile(path: string): void {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const viewerExts = ["md", "markdown", "mmd", "mermaid", "drawio", "svg", "txt", "json", "yaml", "yml", "toml"];
    const browserExts = ["html", "htm"];

    if (viewerExts.includes(ext)) {
      // Reuse existing viewer tab with same path if already open
      const existing = this.tabs.find((t) => t.type === "viewer" && t.filePath === path);
      if (existing) { this.activateTab(existing.id); return; }
      this.newViewerTab(path);
      return;
    }

    if (browserExts.includes(ext)) {
      // Open HTML in BrowserPane using a file:// URL for live preview
      const existing = this.tabs.find((t) => t.type === "browser" && t.url === `file://${path}`);
      if (existing) { this.activateTab(existing.id); return; }
      this.newBrowserTab(`file://${path}`);
      return;
    }

    // Fallback: try to open in viewer as plain text
    const existing = this.tabs.find((t) => t.type === "viewer" && t.filePath === path);
    if (existing) { this.activateTab(existing.id); return; }
    this.newViewerTab(path);
  }
}

