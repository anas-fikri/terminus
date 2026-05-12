import { open } from "@tauri-apps/plugin-dialog";
import { type ExtensionLaunchRequest } from "../extensions/ExtensionsPanel";
import { readVersionedStorage } from "../utils/versionedStorage";
import { icon } from "../utils/icons";
import "./projectspanel.css";

export type ProjectSelectedCallback = (path: string) => void;
export type RemoteSelectedCallback = (request: ExtensionLaunchRequest) => void;

const STORAGE_KEY = "terminus-recent-projects";
const EXTENSIONS_STORAGE_KEY = "terminus-extension-manager-state";
const REMOTE_VISIBILITY_KEY = "terminus-projects-show-remote-live";
const MAX_RECENTS = 10;

interface ExtensionStateLike {
  sshProfiles?: SshProfile[];
  kubeProfiles?: KubeProfile[];
}

interface SshProfile {
  name: string;
  host: string;
  user: string;
  port: string;
  workspace: string;
  identityFile: string;
  proxyJump: string;
  portForwards: string;
}

interface KubeProfile {
  name: string;
  context: string;
  namespace: string;
  workspace: string;
}

type RemoteKind = "ssh" | "kubernetes";

interface RemoteEntry {
  id: string;
  kind: RemoteKind;
  name: string;
  path: string;
  command: string;
  workspace: string;
}

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

export class ProjectsPanel {
  private el: HTMLElement;
  private onSelect: ProjectSelectedCallback;
  private onRemoteSelect?: RemoteSelectedCallback;
  private recents: string[] = [];
  private activeProject = "";
  private showRemoteLive = true;

  constructor(el: HTMLElement, onSelect: ProjectSelectedCallback, onRemoteSelect?: RemoteSelectedCallback) {
    this.el = el;
    this.onSelect = onSelect;
    this.onRemoteSelect = onRemoteSelect;
    this.recents = this.loadRecents();
    this.showRemoteLive = this.loadRemoteVisibility();
    this.mount();
  }

  private mount(): void {
    this.el.innerHTML = `
      <div class="pp">
        <div class="pp__header">
          <span class="pp__title">PROJECTS</span>
          <button class="pp__open-btn" id="pp-open" title="Open folder">${icon("plus", 14)}</button>
        </div>
        <div class="pp__list" id="pp-list"></div>
        <div class="pp__footer">
          <button class="pp__browse-btn" id="pp-browse">${icon("browse", 12)} Browse folder…</button>
        </div>
      </div>
    `;

    this.el.querySelector("#pp-open")!.addEventListener("click", () => this.browse());
    this.el.querySelector("#pp-browse")!.addEventListener("click", () => this.browse());

    this.renderList();
  }

  private async browse(): Promise<void> {
    const result = await open({ directory: true, multiple: false, title: "Select project folder" });
    if (result) this.select(result as string);
  }

  async browsePicker(): Promise<void> {
    return this.browse();
  }

  private select(path: string): void {
    this.addRecent(path);
    this.activeProject = path;
    this.renderList();
    this.onSelect(path);
  }

  setActive(path: string): void {
    this.activeProject = path;
    if (path && !this.recents.includes(path)) {
      this.addRecent(path);
    }
    this.renderList();
  }

  private renderList(): void {
    const list = this.el.querySelector<HTMLElement>("#pp-list")!;
    const remoteEntries = this.loadRemoteEntries();
    if (this.recents.length === 0 && remoteEntries.length === 0) {
      list.innerHTML = `<div class="pp__empty">No recent projects</div>`;
      return;
    }

    list.innerHTML = "";

    if (this.recents.length > 0) {
      const localHeader = document.createElement("div");
      localHeader.className = "pp__section";
      localHeader.textContent = "LOCAL";
      list.appendChild(localHeader);
    }

    for (const p of this.recents) {
      const item = document.createElement("button");
      item.className = "pp__item" + (p === this.activeProject ? " pp__item--active" : "");
      item.title = p;
      item.innerHTML = `
        <span class="pp__item-icon">${p === this.activeProject ? icon("chevron-right", 10) : icon("folder", 10)}</span>
        <div class="pp__item-info">
          <div class="pp__item-name">${escHtml(basename(p))}</div>
          <div class="pp__item-path">${escHtml(p)}</div>
        </div>
      `;
      item.addEventListener("click", () => this.select(p));
      list.appendChild(item);
    }

    if (remoteEntries.length > 0) {
      const remoteHeader = document.createElement("div");
      remoteHeader.className = "pp__section-row";
      remoteHeader.innerHTML = `
        <span class="pp__section">REMOTE (LIVE)</span>
        <button class="pp__section-toggle" type="button">${this.showRemoteLive ? "Hide" : "Show"}</button>
      `;
      remoteHeader.querySelector(".pp__section-toggle")?.addEventListener("click", () => {
        this.showRemoteLive = !this.showRemoteLive;
        this.persistRemoteVisibility();
        this.renderList();
      });
      list.appendChild(remoteHeader);

      if (!this.showRemoteLive) {
        const collapsed = document.createElement("div");
        collapsed.className = "pp__empty pp__empty--remote";
        collapsed.textContent = `Hidden (${remoteEntries.length} live target${remoteEntries.length > 1 ? "s" : ""})`;
        list.appendChild(collapsed);
        return;
      }

      for (const entry of remoteEntries) {
        const item = document.createElement("button");
        item.className = "pp__item pp__item--remote";
        item.title = `${entry.name}\n${entry.path}`;
        const badgeClass = entry.kind === "kubernetes" ? "pp__badge pp__badge--danger" : "pp__badge pp__badge--warn";
        const badgeText = entry.kind === "kubernetes" ? "LIVE K8S" : "LIVE SSH";
        const kindIcon = entry.kind === "kubernetes" ? icon("project", 10) : icon("terminal", 10);
        item.innerHTML = `
          <span class="pp__item-icon">${kindIcon}</span>
          <div class="pp__item-info">
            <div class="pp__item-name">${escHtml(entry.name)}</div>
            <div class="pp__item-path">${escHtml(entry.path)}</div>
          </div>
          <span class="${badgeClass}">${badgeText}</span>
        `;
        item.addEventListener("click", () => {
          if (!this.confirmRemoteLaunch(entry)) return;
          this.onRemoteSelect?.({
            label: entry.name,
            command: entry.command,
            workspace: entry.workspace,
          });
        });
        list.appendChild(item);
      }
    }
  }

  private addRecent(path: string): void {
    this.recents = [path, ...this.recents.filter((p) => p !== path)].slice(0, MAX_RECENTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.recents));
  }

  private loadRecents(): string[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    } catch {
      return [];
    }
  }

  private loadRemoteVisibility(): boolean {
    try {
      const raw = localStorage.getItem(REMOTE_VISIBILITY_KEY);
      if (raw === null) return true;
      return raw !== "0";
    } catch {
      return true;
    }
  }

  private persistRemoteVisibility(): void {
    localStorage.setItem(REMOTE_VISIBILITY_KEY, this.showRemoteLive ? "1" : "0");
  }

  private confirmRemoteLaunch(entry: RemoteEntry): boolean {
    const severity = entry.kind === "kubernetes" ? "RED ALERT" : "ORANGE ALERT";
    const scope = entry.kind === "kubernetes" ? "Kubernetes cluster" : "SSH remote host";
    return window.confirm(
      `${severity}: LIVE SERVER TARGET\n\n` +
      `You are about to open ${scope}:\n${entry.path}\n\n` +
      `Command:\n${entry.command}\n\n` +
      "Continue?"
    );
  }

  private loadRemoteEntries(): RemoteEntry[] {
    const parsed = readVersionedStorage<ExtensionStateLike>(EXTENSIONS_STORAGE_KEY, {}).value;
    const sshProfiles = Array.isArray(parsed.sshProfiles) ? parsed.sshProfiles : [];
    const kubeProfiles = Array.isArray(parsed.kubeProfiles) ? parsed.kubeProfiles : [];

    const sshEntries = sshProfiles
      .filter((profile) => profile.name && profile.host)
      .map((profile): RemoteEntry => {
        const user = profile.user?.trim() || "root";
        const host = profile.host.trim();
        const workspace = profile.workspace?.trim() || ".";
        return {
          id: `ssh:${profile.name}`,
          kind: "ssh",
          name: `SSH: ${profile.name}`,
          path: `${user}@${host}`,
          command: buildSshCommand(profile),
          workspace,
        };
      });

    const kubeEntries = kubeProfiles
      .filter((profile) => profile.name)
      .map((profile): RemoteEntry => {
        const workspace = profile.workspace?.trim() || ".";
        const context = profile.context?.trim() || "(default)";
        const namespace = profile.namespace?.trim() || "default";
        return {
          id: `kube:${profile.name}`,
          kind: "kubernetes",
          name: `K8s: ${profile.name}`,
          path: `${context} / ${namespace}`,
          command: buildKubectlCommand(profile),
          workspace,
        };
      });

    return [...sshEntries, ...kubeEntries].slice(0, 20);
  }
}

function escapeShell(value: string): string {
  return JSON.stringify(value);
}

function buildSshCommand(profile: SshProfile): string {
  const user = profile.user?.trim() || "root";
  const host = profile.host.trim();
  const port = profile.port?.trim() || "22";
  const identityFile = profile.identityFile?.trim() || "";
  const proxyJump = profile.proxyJump?.trim() || "";
  const portForwards = profile.portForwards?.trim() || "";

  const target = `${user}@${host}`;
  const portArg = port !== "22" ? ` -p ${escapeShell(port)}` : "";
  const identityArg = identityFile ? ` -i ${escapeShell(identityFile)}` : "";
  const proxyArg = proxyJump ? ` -J ${escapeShell(proxyJump)}` : "";
  const forwardArgs = portForwards
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => ` -L ${escapeShell(item)}`)
    .join("");
  return `ssh${identityArg}${proxyArg}${portArg}${forwardArgs} ${target}`.replace(/\s+/g, " ").trim();
}

function buildKubectlCommand(profile: KubeProfile): string {
  const context = profile.context?.trim();
  const namespace = profile.namespace?.trim() || "default";
  const contextArg = context ? `--context ${escapeShell(context)} ` : "";
  const namespaceArg = namespace ? `-n ${escapeShell(namespace)} ` : "";
  return `kubectl ${contextArg}${namespaceArg}get pods -A`.replace(/\s+/g, " ").trim();
}

function escHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
