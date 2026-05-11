import { open, save } from "@tauri-apps/plugin-dialog";
import {
  getHostToolStatus,
  getKubectlContexts,
  getKubectlHostInfo,
  readFileContent,
  writeFileContentOverwrite,
} from "../ipc/bridge";
import { readVersionedStorage, writeVersionedStorage } from "../utils/versionedStorage";
import "./extensions.css";

export interface ExtensionLaunchRequest {
  label: string;
  command: string;
  workspace?: string;
}

type LaunchCallback = (request: ExtensionLaunchRequest) => void;

type ExtensionId = "ssh" | "kubernetes";

type StatusKind = "info" | "success" | "error";

interface ExtensionState {
  sshHost: string;
  sshUser: string;
  sshPort: string;
  sshWorkspace: string;
  sshIdentityFile: string;
  sshProxyJump: string;
  sshPortForwards: string;
  sshProfileName: string;
  sshProfiles: SshProfile[];
  sshSelectedProfile: string;
  kubeContext: string;
  kubeNamespace: string;
  kubeWorkspace: string;
  kubePod: string;
  kubeContainer: string;
  kubeProfileName: string;
  kubeProfiles: KubeProfile[];
  kubeSelectedProfile: string;
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
  pod: string;
  container: string;
}

interface ProfilesExport {
  version: 1;
  exportedAt: string;
  sshProfiles: SshProfile[];
  kubeProfiles: KubeProfile[];
}

const STORAGE_KEY = "terminus-extension-manager-state";

export class ExtensionsPanel {
  private el: HTMLElement;
  private onLaunch: LaunchCallback;
  private activeExtension: ExtensionId = "ssh";
  private workspace = ".";
  private state: ExtensionState = this.loadState();
  private kubectlInfoLoaded = false;
  private kubectlContexts: string[] = [];
  private statusText = "";
  private statusKind: StatusKind = "info";
  private stateRev = 0;

  constructor(el: HTMLElement, onLaunch: LaunchCallback) {
    this.el = el;
    this.onLaunch = onLaunch;
    this.mount();
    void this.autodetectKubectlHost();
  }

  setWorkspace(workspace: string): void {
    this.workspace = workspace || ".";
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private mount(): void {
    this.render();
  }

  private async autodetectKubectlHost(): Promise<void> {
    if (this.kubectlInfoLoaded) return;
    this.kubectlInfoLoaded = true;

    try {
      const [info, contexts] = await Promise.all([getKubectlHostInfo(), getKubectlContexts()]);
      this.kubectlContexts = contexts;
      if (!info.available) {
        this.setStatus("kubectl tidak terdeteksi di host. Isi manual tetap bisa.", "info");
        this.render();
        return;
      }

      let changed = false;
      if (!this.state.kubeContext && info.current_context) {
        this.state.kubeContext = info.current_context;
        changed = true;
      }
      if ((!this.state.kubeNamespace || this.state.kubeNamespace === "default") && info.namespace) {
        this.state.kubeNamespace = info.namespace;
        changed = true;
      }

      this.setStatus("kubectl aktif terdeteksi. Context/namespace host dipakai otomatis.", "success");
      if (changed) this.saveState();
      this.render();
    } catch {
      this.setStatus("Gagal baca info kubectl host. Gunakan input manual.", "error");
      this.render();
    }
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="extensions-panel">
        <div class="extensions-panel__header">
          <div>
            <div class="extensions-panel__eyebrow">EXTENSION MANAGER</div>
            <div class="extensions-panel__title">Built-in integrations</div>
          </div>
          <div class="extensions-panel__badge">VS Code-inspired base</div>
        </div>
        <div class="extensions-panel__layout">
          <div class="extensions-panel__nav">
            <button class="extensions-panel__nav-item ${this.activeExtension === "ssh" ? "extensions-panel__nav-item--active" : ""}" data-extension="ssh">SSH Remote</button>
            <button class="extensions-panel__nav-item ${this.activeExtension === "kubernetes" ? "extensions-panel__nav-item--active" : ""}" data-extension="kubernetes">Kubernetes</button>
          </div>
          <div class="extensions-panel__detail">
            ${this.activeExtension === "ssh" ? this.renderSshDetail() : this.renderKubernetesDetail()}
            ${this.statusText ? `<div class="extensions-panel__status extensions-panel__status--${this.statusKind}">${escapeHtml(this.statusText)}</div>` : ""}
          </div>
        </div>
      </div>
    `;

    this.el.querySelectorAll<HTMLElement>("[data-extension]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.extension as ExtensionId;
        if (!id) return;
        this.activeExtension = id;
        this.render();
      });
    });

    if (this.activeExtension === "ssh") {
      this.bindSshDetail();
    } else {
      this.bindKubernetesDetail();
    }

    this.el.querySelector("#profiles-import")?.addEventListener("click", () => void this.importProfiles());
    this.el.querySelector("#profiles-export")?.addEventListener("click", () => void this.exportProfiles());
  }

  private renderSshDetail(): string {
    const profileOptions = this.state.sshProfiles
      .map((p) => `<option value="${escapeHtml(p.name)}" ${p.name === this.state.sshSelectedProfile ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
      .join("");

    return `
      <div class="extensions-panel__card">
        <div class="extensions-panel__toolbar-actions">
          <button class="extensions-panel__secondary" id="profiles-import">Import profiles</button>
          <button class="extensions-panel__secondary" id="profiles-export">Export profiles</button>
          <button class="extensions-panel__secondary" id="ssh-test-tool">Test SSH tool</button>
        </div>
        <div class="extensions-panel__card-title">SSH Remote</div>
        <div class="extensions-panel__card-subtitle">Launch SSH with optional key, proxy jump, and strict local port-forward validation.</div>

        <div class="extensions-panel__form-grid">
          <label class="extensions-panel__field extensions-panel__field--full">
            <span>Profile</span>
            <select id="ssh-profile-list">
              <option value="">(select profile)</option>
              ${profileOptions}
            </select>
          </label>
          <label class="extensions-panel__field extensions-panel__field--full">
            <span>Profile Name</span>
            <input id="ssh-profile-name" type="text" placeholder="prod-bastion" value="${escapeHtml(this.state.sshProfileName)}" />
          </label>
        </div>

        <div class="extensions-panel__form-grid">
          <label class="extensions-panel__field">
            <span>Host</span>
            <input id="ssh-host" type="text" placeholder="example.com" value="${escapeHtml(this.state.sshHost)}" />
          </label>
          <label class="extensions-panel__field">
            <span>User</span>
            <input id="ssh-user" type="text" placeholder="root" value="${escapeHtml(this.state.sshUser)}" />
          </label>
          <label class="extensions-panel__field">
            <span>Port</span>
            <input id="ssh-port" type="number" min="1" max="65535" value="${escapeHtml(this.state.sshPort)}" />
          </label>
          <label class="extensions-panel__field extensions-panel__field--full">
            <span>Identity File</span>
            <input id="ssh-identity" type="text" placeholder="~/.ssh/id_ed25519" value="${escapeHtml(this.state.sshIdentityFile)}" />
          </label>
          <label class="extensions-panel__field extensions-panel__field--full">
            <span>ProxyJump</span>
            <input id="ssh-proxy-jump" type="text" placeholder="bastion-user@bastion-host" value="${escapeHtml(this.state.sshProxyJump)}" />
          </label>
          <label class="extensions-panel__field extensions-panel__field--full">
            <span>Port Forwards (format: local:host:remote, dipisah koma)</span>
            <input id="ssh-port-forwards" type="text" placeholder="5432:127.0.0.1:5432,8080:127.0.0.1:80" value="${escapeHtml(this.state.sshPortForwards)}" />
          </label>
          <label class="extensions-panel__field extensions-panel__field--full">
            <span>Workspace</span>
            <input id="ssh-workspace" type="text" value="${escapeHtml(this.state.sshWorkspace || this.workspace)}" />
          </label>
        </div>

        <div class="extensions-panel__actions extensions-panel__actions--wrap">
          <button class="extensions-panel__primary" id="ssh-launch">Open SSH Session</button>
          <button class="extensions-panel__secondary" id="ssh-save-profile">Save profile</button>
          <button class="extensions-panel__secondary" id="ssh-delete-profile">Delete profile</button>
          <button class="extensions-panel__secondary" id="ssh-copy">Copy command</button>
        </div>

        <div class="extensions-panel__hint">
          Command preview: <code id="ssh-preview">${escapeHtml(this.buildSshCommandPreview())}</code>
        </div>
      </div>
    `;
  }

  private renderKubernetesDetail(): string {
    const profileOptions = this.state.kubeProfiles
      .map((p) => `<option value="${escapeHtml(p.name)}" ${p.name === this.state.kubeSelectedProfile ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
      .join("");

    const contextOptions = this.kubectlContexts
      .map((ctx) => `<option value="${escapeHtml(ctx)}">${escapeHtml(ctx)}</option>`)
      .join("");

    return `
      <div class="extensions-panel__card">
        <div class="extensions-panel__toolbar-actions">
          <button class="extensions-panel__secondary" id="profiles-import">Import profiles</button>
          <button class="extensions-panel__secondary" id="profiles-export">Export profiles</button>
          <button class="extensions-panel__secondary" id="kube-test-tool">Test kubectl</button>
        </div>
        <div class="extensions-panel__card-title">Kubernetes</div>
        <div class="extensions-panel__card-subtitle">Active host kubectl context otomatis dipakai kalau tersedia.</div>

        <div class="extensions-panel__form-grid">
          <label class="extensions-panel__field extensions-panel__field--full">
            <span>Profile</span>
            <select id="kube-profile-list">
              <option value="">(select profile)</option>
              ${profileOptions}
            </select>
          </label>
          <label class="extensions-panel__field extensions-panel__field--full">
            <span>Profile Name</span>
            <input id="kube-profile-name" type="text" placeholder="production-cluster" value="${escapeHtml(this.state.kubeProfileName)}" />
          </label>
        </div>

        <div class="extensions-panel__form-grid">
          <label class="extensions-panel__field">
            <span>Context</span>
            <input id="kube-context" list="kube-context-list" type="text" placeholder="prod-cluster" value="${escapeHtml(this.state.kubeContext)}" />
            <datalist id="kube-context-list">${contextOptions}</datalist>
          </label>
          <label class="extensions-panel__field">
            <span>Namespace</span>
            <input id="kube-namespace" type="text" placeholder="default" value="${escapeHtml(this.state.kubeNamespace)}" />
          </label>
          <label class="extensions-panel__field">
            <span>Pod</span>
            <input id="kube-pod" type="text" placeholder="api-74f6f5dd79-xqk9b" value="${escapeHtml(this.state.kubePod)}" />
          </label>
          <label class="extensions-panel__field">
            <span>Container</span>
            <input id="kube-container" type="text" placeholder="app" value="${escapeHtml(this.state.kubeContainer)}" />
          </label>
          <label class="extensions-panel__field extensions-panel__field--full">
            <span>Workspace</span>
            <input id="kube-workspace" type="text" value="${escapeHtml(this.state.kubeWorkspace || this.workspace)}" />
          </label>
        </div>

        <div class="extensions-panel__actions extensions-panel__actions--wrap">
          <button class="extensions-panel__primary" id="kube-launch">Open K8s Shell</button>
          <button class="extensions-panel__secondary" id="kube-save-profile">Save profile</button>
          <button class="extensions-panel__secondary" id="kube-delete-profile">Delete profile</button>
          <button class="extensions-panel__secondary" id="kube-pods">Get pods</button>
          <button class="extensions-panel__secondary" id="kube-nodes">Get nodes</button>
          <button class="extensions-panel__secondary" id="kube-logs">Logs</button>
          <button class="extensions-panel__secondary" id="kube-describe">Describe</button>
          <button class="extensions-panel__secondary" id="kube-exec">Exec</button>
        </div>

        <div class="extensions-panel__hint">
          Command preview: <code id="kube-preview">${escapeHtml(this.buildKubeCommandPreview("get pods -A"))}</code>
        </div>
      </div>
    `;
  }

  private bindSshDetail(): void {
    const host = this.getInputValue("ssh-host", this.state.sshHost);
    const user = this.getInputValue("ssh-user", this.state.sshUser);
    const port = this.getInputValue("ssh-port", this.state.sshPort);
    const workspace = this.getInputValue("ssh-workspace", this.state.sshWorkspace || this.workspace);

    this.updatePreview("ssh-preview", this.buildSshCommand(host, user, port, this.state.sshIdentityFile, this.state.sshProxyJump, this.state.sshPortForwards));

    this.el.querySelector("#ssh-profile-list")?.addEventListener("change", () => {
      const selected = this.getInputValue("ssh-profile-list", "").trim();
      if (!selected) return;
      const profile = this.state.sshProfiles.find((item) => item.name === selected);
      if (!profile) return;
      this.state = {
        ...this.state,
        sshSelectedProfile: selected,
        sshProfileName: profile.name,
        sshHost: profile.host,
        sshUser: profile.user,
        sshPort: profile.port,
        sshWorkspace: profile.workspace,
        sshIdentityFile: profile.identityFile,
        sshProxyJump: profile.proxyJump,
        sshPortForwards: profile.portForwards,
      };
      this.saveState();
      this.render();
    });

    this.el.querySelectorAll("#ssh-profile-name,#ssh-host,#ssh-user,#ssh-port,#ssh-identity,#ssh-proxy-jump,#ssh-port-forwards,#ssh-workspace")
      .forEach((node) => node.addEventListener("input", () => this.syncAndPreviewSsh()));

    this.el.querySelector("#ssh-launch")?.addEventListener("click", () => {
      const nextHost = this.getInputValue("ssh-host", host).trim();
      const nextUser = this.getInputValue("ssh-user", user).trim();
      const nextPort = this.getInputValue("ssh-port", port).trim() || "22";
      const nextIdentity = this.getInputValue("ssh-identity", this.state.sshIdentityFile).trim();
      const nextProxyJump = this.getInputValue("ssh-proxy-jump", this.state.sshProxyJump).trim();
      const nextForwards = this.getInputValue("ssh-port-forwards", this.state.sshPortForwards).trim();
      const nextWorkspace = this.getInputValue("ssh-workspace", workspace).trim() || this.workspace;

      const forwardError = this.validatePortForwards(nextForwards);
      if (forwardError) {
        this.setStatus(forwardError, "error");
        this.render();
        return;
      }

      const command = this.buildSshCommand(nextHost, nextUser, nextPort, nextIdentity, nextProxyJump, nextForwards);
      if (!nextHost || !nextUser) {
        this.setStatus("Host dan user wajib diisi untuk SSH.", "error");
        this.render();
        return;
      }

      this.state = {
        ...this.state,
        sshHost: nextHost,
        sshUser: nextUser,
        sshPort: nextPort,
        sshIdentityFile: nextIdentity,
        sshProxyJump: nextProxyJump,
        sshPortForwards: nextForwards,
        sshWorkspace: nextWorkspace,
      };
      this.saveState();
      this.setStatus("SSH session diluncurkan.", "success");
      this.onLaunch({ label: `SSH: ${nextUser}@${nextHost}`, command, workspace: nextWorkspace });
      this.render();
    });

    this.el.querySelector("#ssh-copy")?.addEventListener("click", async () => {
      const command = this.buildSshCommand(
        this.getInputValue("ssh-host", host).trim(),
        this.getInputValue("ssh-user", user).trim(),
        this.getInputValue("ssh-port", port).trim() || "22",
        this.getInputValue("ssh-identity", this.state.sshIdentityFile).trim(),
        this.getInputValue("ssh-proxy-jump", this.state.sshProxyJump).trim(),
        this.getInputValue("ssh-port-forwards", this.state.sshPortForwards).trim()
      );
      await navigator.clipboard.writeText(command);
      this.setStatus("Command SSH disalin ke clipboard.", "success");
      this.render();
    });

    this.el.querySelector("#ssh-save-profile")?.addEventListener("click", () => {
      const profile: SshProfile = {
        name: this.getInputValue("ssh-profile-name", "").trim() || `${this.getInputValue("ssh-user", "root").trim()}@${this.getInputValue("ssh-host", "").trim()}`,
        host: this.getInputValue("ssh-host", "").trim(),
        user: this.getInputValue("ssh-user", "").trim(),
        port: this.getInputValue("ssh-port", "22").trim() || "22",
        workspace: this.getInputValue("ssh-workspace", this.workspace).trim() || this.workspace,
        identityFile: this.getInputValue("ssh-identity", "").trim(),
        proxyJump: this.getInputValue("ssh-proxy-jump", "").trim(),
        portForwards: this.getInputValue("ssh-port-forwards", "").trim(),
      };
      if (!profile.name || !profile.host || !profile.user) {
        this.setStatus("Profile SSH butuh name, host, dan user.", "error");
        this.render();
        return;
      }

      const forwardError = this.validatePortForwards(profile.portForwards);
      if (forwardError) {
        this.setStatus(forwardError, "error");
        this.render();
        return;
      }

      const filtered = this.state.sshProfiles.filter((item) => item.name !== profile.name);
      this.state = {
        ...this.state,
        sshProfileName: profile.name,
        sshSelectedProfile: profile.name,
        sshProfiles: [profile, ...filtered].slice(0, 30),
      };
      this.saveState();
      this.setStatus("Profile SSH tersimpan.", "success");
      this.render();
    });

    this.el.querySelector("#ssh-delete-profile")?.addEventListener("click", () => {
      const target = this.getInputValue("ssh-profile-list", "").trim() || this.getInputValue("ssh-profile-name", "").trim();
      if (!target) return;
      this.state = {
        ...this.state,
        sshProfiles: this.state.sshProfiles.filter((item) => item.name !== target),
        sshSelectedProfile: "",
      };
      this.saveState();
      this.setStatus(`Profile SSH ${target} dihapus.`, "success");
      this.render();
    });

    this.el.querySelector("#ssh-test-tool")?.addEventListener("click", () => void this.testHostTools("ssh"));
  }

  private bindKubernetesDetail(): void {
    const context = this.getInputValue("kube-context", this.state.kubeContext);
    const namespace = this.getInputValue("kube-namespace", this.state.kubeNamespace);
    const workspace = this.getInputValue("kube-workspace", this.state.kubeWorkspace || this.workspace);

    this.updatePreview("kube-preview", this.buildKubeCommand(context, namespace, "get pods -A"));

    this.el.querySelector("#kube-profile-list")?.addEventListener("change", () => {
      const selected = this.getInputValue("kube-profile-list", "").trim();
      if (!selected) return;
      const profile = this.state.kubeProfiles.find((item) => item.name === selected);
      if (!profile) return;
      this.state = {
        ...this.state,
        kubeSelectedProfile: selected,
        kubeProfileName: profile.name,
        kubeContext: profile.context,
        kubeNamespace: profile.namespace,
        kubeWorkspace: profile.workspace,
        kubePod: profile.pod,
        kubeContainer: profile.container,
      };
      this.saveState();
      this.render();
    });

    this.el.querySelectorAll("#kube-profile-name,#kube-context,#kube-namespace,#kube-pod,#kube-container,#kube-workspace")
      .forEach((node) => node.addEventListener("input", () => this.syncAndPreviewKube()));

    this.el.querySelector("#kube-launch")?.addEventListener("click", () => {
      const nextContext = this.getInputValue("kube-context", context).trim();
      const nextNamespace = this.getInputValue("kube-namespace", namespace).trim();
      const nextWorkspace = this.getInputValue("kube-workspace", workspace).trim() || this.workspace;
      const command = this.buildKubeCommand(nextContext, nextNamespace, "get pods -A");
      this.state = {
        ...this.state,
        kubeContext: nextContext,
        kubeNamespace: nextNamespace,
        kubeWorkspace: nextWorkspace,
      };
      this.saveState();
      this.setStatus("Kubernetes shell diluncurkan.", "success");
      this.onLaunch({ label: `K8s: ${nextContext || "default"}`, command, workspace: nextWorkspace });
      this.render();
    });

    this.el.querySelector("#kube-pods")?.addEventListener("click", () => this.launchKubeAction("get pods -A", "K8s pods"));
    this.el.querySelector("#kube-nodes")?.addEventListener("click", () => this.launchKubeAction("get nodes", "K8s nodes"));

    this.el.querySelector("#kube-logs")?.addEventListener("click", () => {
      const pod = this.getInputValue("kube-pod", this.state.kubePod).trim();
      if (!pod) {
        this.setStatus("Isi pod dulu untuk action logs.", "error");
        this.render();
        return;
      }
      const container = this.getInputValue("kube-container", this.state.kubeContainer).trim();
      const containerArg = container ? ` -c ${escapeShell(container)}` : "";
      this.launchKubeAction(`logs -f ${escapeShell(pod)}${containerArg}`, "K8s logs");
    });

    this.el.querySelector("#kube-describe")?.addEventListener("click", () => {
      const pod = this.getInputValue("kube-pod", this.state.kubePod).trim();
      if (!pod) {
        this.setStatus("Isi pod dulu untuk action describe.", "error");
        this.render();
        return;
      }
      this.launchKubeAction(`describe pod ${escapeShell(pod)}`, "K8s describe");
    });

    this.el.querySelector("#kube-exec")?.addEventListener("click", () => {
      const pod = this.getInputValue("kube-pod", this.state.kubePod).trim();
      if (!pod) {
        this.setStatus("Isi pod dulu untuk action exec.", "error");
        this.render();
        return;
      }
      const container = this.getInputValue("kube-container", this.state.kubeContainer).trim();
      const containerArg = container ? ` -c ${escapeShell(container)}` : "";
      this.launchKubeAction(`exec -it ${escapeShell(pod)}${containerArg} -- sh`, "K8s exec");
    });

    this.el.querySelector("#kube-save-profile")?.addEventListener("click", () => {
      const profile: KubeProfile = {
        name: this.getInputValue("kube-profile-name", "").trim() || this.getInputValue("kube-context", "default").trim() || "default",
        context: this.getInputValue("kube-context", "").trim(),
        namespace: this.getInputValue("kube-namespace", "default").trim() || "default",
        workspace: this.getInputValue("kube-workspace", this.workspace).trim() || this.workspace,
        pod: this.getInputValue("kube-pod", "").trim(),
        container: this.getInputValue("kube-container", "").trim(),
      };
      if (!profile.name) {
        this.setStatus("Profile Kubernetes butuh minimal nama.", "error");
        this.render();
        return;
      }

      const filtered = this.state.kubeProfiles.filter((item) => item.name !== profile.name);
      this.state = {
        ...this.state,
        kubeProfileName: profile.name,
        kubeSelectedProfile: profile.name,
        kubeProfiles: [profile, ...filtered].slice(0, 30),
      };
      this.saveState();
      this.setStatus("Profile Kubernetes tersimpan.", "success");
      this.render();
    });

    this.el.querySelector("#kube-delete-profile")?.addEventListener("click", () => {
      const target = this.getInputValue("kube-profile-list", "").trim() || this.getInputValue("kube-profile-name", "").trim();
      if (!target) return;
      this.state = {
        ...this.state,
        kubeProfiles: this.state.kubeProfiles.filter((item) => item.name !== target),
        kubeSelectedProfile: "",
      };
      this.saveState();
      this.setStatus(`Profile Kubernetes ${target} dihapus.`, "success");
      this.render();
    });

    this.el.querySelector("#kube-test-tool")?.addEventListener("click", () => void this.testHostTools("kubectl"));
  }

  private async testHostTools(tool: "ssh" | "kubectl"): Promise<void> {
    try {
      const status = await getHostToolStatus();
      if (tool === "ssh") {
        this.setStatus(status.ssh_available ? "SSH tersedia di host." : "SSH tidak ditemukan di host.", status.ssh_available ? "success" : "error");
      } else {
        this.setStatus(status.kubectl_available ? "kubectl tersedia di host." : "kubectl tidak ditemukan di host.", status.kubectl_available ? "success" : "error");
      }
      this.render();
    } catch {
      this.setStatus("Gagal melakukan health-check tools host.", "error");
      this.render();
    }
  }

  private launchKubeAction(action: string, labelPrefix: string): void {
    const context = this.getInputValue("kube-context", this.state.kubeContext).trim();
    const namespace = this.getInputValue("kube-namespace", this.state.kubeNamespace).trim();
    const workspace = this.getInputValue("kube-workspace", this.state.kubeWorkspace || this.workspace).trim() || this.workspace;
    const command = this.buildKubeCommand(context, namespace, action);
    this.onLaunch({
      label: `${labelPrefix}: ${context || "default"}`,
      command,
      workspace,
    });
    this.setStatus(`${labelPrefix} command dikirim ke terminal.`, "success");
    this.render();
  }

  private syncAndPreviewSsh(): void {
    const host = this.getInputValue("ssh-host", this.state.sshHost);
    const user = this.getInputValue("ssh-user", this.state.sshUser);
    const port = this.getInputValue("ssh-port", this.state.sshPort);
    this.state = {
      ...this.state,
      sshHost: host,
      sshUser: user,
      sshPort: port,
      sshWorkspace: this.getInputValue("ssh-workspace", this.state.sshWorkspace || this.workspace),
      sshIdentityFile: this.getInputValue("ssh-identity", this.state.sshIdentityFile),
      sshProxyJump: this.getInputValue("ssh-proxy-jump", this.state.sshProxyJump),
      sshPortForwards: this.getInputValue("ssh-port-forwards", this.state.sshPortForwards),
      sshProfileName: this.getInputValue("ssh-profile-name", this.state.sshProfileName),
    };
    this.saveState();
    this.updatePreview("ssh-preview", this.buildSshCommand(host, user, port, this.state.sshIdentityFile, this.state.sshProxyJump, this.state.sshPortForwards));
  }

  private syncAndPreviewKube(): void {
    const context = this.getInputValue("kube-context", this.state.kubeContext);
    const namespace = this.getInputValue("kube-namespace", this.state.kubeNamespace);
    this.state = {
      ...this.state,
      kubeContext: context,
      kubeNamespace: namespace,
      kubeWorkspace: this.getInputValue("kube-workspace", this.state.kubeWorkspace || this.workspace),
      kubePod: this.getInputValue("kube-pod", this.state.kubePod),
      kubeContainer: this.getInputValue("kube-container", this.state.kubeContainer),
      kubeProfileName: this.getInputValue("kube-profile-name", this.state.kubeProfileName),
    };
    this.saveState();
    this.updatePreview("kube-preview", this.buildKubeCommand(context, namespace, "get pods -A"));
  }

  private validatePortForwards(value: string): string | null {
    if (!value.trim()) return null;
    const entries = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    for (const entry of entries) {
      const match = entry.match(/^(\d{1,5}):([A-Za-z0-9._-]+):(\d{1,5})$/);
      if (!match) {
        return `Format port-forward invalid: ${entry}. Gunakan local:host:remote.`;
      }
      const local = Number(match[1]);
      const remote = Number(match[3]);
      if (local < 1 || local > 65535 || remote < 1 || remote > 65535) {
        return `Port di luar range valid (1-65535): ${entry}.`;
      }
    }

    return null;
  }

  private buildSshCommandPreview(): string {
    return this.buildSshCommand(
      this.state.sshHost,
      this.state.sshUser,
      this.state.sshPort,
      this.state.sshIdentityFile,
      this.state.sshProxyJump,
      this.state.sshPortForwards
    );
  }

  private buildKubeCommandPreview(action: string): string {
    return this.buildKubeCommand(this.state.kubeContext, this.state.kubeNamespace, action);
  }

  private buildSshCommand(host: string, user: string, port: string, identityFile: string, proxyJump: string, portForwards: string): string {
    const target = [user.trim(), host.trim()].filter(Boolean).join("@");
    const portArg = port.trim() && port.trim() !== "22" ? ` -p ${escapeShell(port.trim())}` : "";
    const identityArg = identityFile.trim() ? ` -i ${escapeShell(identityFile.trim())}` : "";
    const proxyArg = proxyJump.trim() ? ` -J ${escapeShell(proxyJump.trim())}` : "";
    const forwardArgs = portForwards
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => ` -L ${escapeShell(item)}`)
      .join("");
    return `ssh${identityArg}${proxyArg}${portArg}${forwardArgs} ${target}`.replace(/\s+/g, " ").trim();
  }

  private buildKubeCommand(context: string, namespace: string, action: string): string {
    const contextArg = context.trim() ? `--context ${escapeShell(context.trim())} ` : "";
    const namespaceArg = namespace.trim() ? `-n ${escapeShell(namespace.trim())} ` : "";
    return `kubectl ${contextArg}${namespaceArg}${action}`.replace(/\s+/g, " ").trim();
  }

  private getInputValue(id: string, fallback: string): string {
    const input = this.el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
    return input?.value ?? fallback;
  }

  private updatePreview(id: string, text: string): void {
    const el = this.el.querySelector<HTMLElement>(`#${id}`);
    if (el) el.textContent = text;
  }

  private setStatus(text: string, kind: StatusKind): void {
    this.statusText = text;
    this.statusKind = kind;
  }

  private async exportProfiles(): Promise<void> {
    try {
      const path = await save({
        title: "Export extension profiles",
        defaultPath: "terminus-extension-profiles.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;

      const payload: ProfilesExport = {
        version: 1,
        exportedAt: new Date().toISOString(),
        sshProfiles: this.state.sshProfiles,
        kubeProfiles: this.state.kubeProfiles,
      };
      await writeFileContentOverwrite(path, JSON.stringify(payload, null, 2));
      this.setStatus("Profiles berhasil di-export.", "success");
      this.render();
    } catch {
      this.setStatus("Export profiles gagal.", "error");
      this.render();
    }
  }

  private async importProfiles(): Promise<void> {
    try {
      const selected = await open({
        title: "Import extension profiles",
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      const path = typeof selected === "string" ? selected : "";
      if (!path) return;

      const raw = await readFileContent(path);
      const parsed = JSON.parse(raw) as Partial<ProfilesExport>;
      const sshProfiles = Array.isArray(parsed.sshProfiles) ? parsed.sshProfiles : [];
      const kubeProfiles = Array.isArray(parsed.kubeProfiles) ? parsed.kubeProfiles : [];

      this.state = {
        ...this.state,
        sshProfiles: dedupeProfiles(sshProfiles, (item) => item.name).slice(0, 30),
        kubeProfiles: dedupeProfiles(kubeProfiles, (item) => item.name).slice(0, 30),
      };
      this.saveState();
      this.setStatus("Profiles berhasil di-import.", "success");
      this.render();
    } catch {
      this.setStatus("Import profiles gagal. Pastikan JSON valid.", "error");
      this.render();
    }
  }

  private loadState(): ExtensionState {
    const stored = readVersionedStorage<Partial<ExtensionState>>(STORAGE_KEY, {});
    this.stateRev = stored.meta.rev;
    const parsed = stored.value;
    return {
      sshHost: parsed.sshHost ?? "",
      sshUser: parsed.sshUser ?? "root",
      sshPort: parsed.sshPort ?? "22",
      sshWorkspace: parsed.sshWorkspace ?? ".",
      sshIdentityFile: parsed.sshIdentityFile ?? "",
      sshProxyJump: parsed.sshProxyJump ?? "",
      sshPortForwards: parsed.sshPortForwards ?? "",
      sshProfileName: parsed.sshProfileName ?? "",
      sshProfiles: parsed.sshProfiles ?? [],
      sshSelectedProfile: parsed.sshSelectedProfile ?? "",
      kubeContext: parsed.kubeContext ?? "",
      kubeNamespace: parsed.kubeNamespace ?? "default",
      kubeWorkspace: parsed.kubeWorkspace ?? ".",
      kubePod: parsed.kubePod ?? "",
      kubeContainer: parsed.kubeContainer ?? "",
      kubeProfileName: parsed.kubeProfileName ?? "",
      kubeProfiles: parsed.kubeProfiles ?? [],
      kubeSelectedProfile: parsed.kubeSelectedProfile ?? "",
    };
  }

  private saveState(): void {
    const next = writeVersionedStorage(STORAGE_KEY, this.state, this.stateRev);
    this.stateRev = next.meta.rev;
  }
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function escapeShell(value: string): string {
  return JSON.stringify(value);
}

function dedupeProfiles<T>(items: T[], keyFn: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = keyFn(item).trim();
    if (!key) continue;
    map.set(key, item);
  }
  return [...map.values()].reverse();
}
