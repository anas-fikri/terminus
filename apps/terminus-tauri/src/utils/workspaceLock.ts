import { getWindowInstanceId } from "./windowInstance";

interface WorkspaceLockRecord {
  workspace: string;
  ownerId: string;
  acquiredAt: number;
  heartbeatAt: number;
}

interface AcquireResult {
  ok: boolean;
  ownerId?: string;
  heartbeatAt?: number;
}

const LOCK_PREFIX = "terminus-workspace-lock:";

function lockKey(workspace: string): string {
  return `${LOCK_PREFIX}${encodeURIComponent(workspace)}`;
}

function readLock(workspace: string): WorkspaceLockRecord | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(lockKey(workspace)) ?? "null") as WorkspaceLockRecord | null;
    if (!parsed) return undefined;
    if (typeof parsed.ownerId !== "string") return undefined;
    if (typeof parsed.heartbeatAt !== "number") return undefined;
    if (typeof parsed.acquiredAt !== "number") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export class WorkspaceLockManager {
  private readonly ownerId = getWindowInstanceId();
  private readonly ttlMs: number;
  private readonly heartbeatMs: number;
  private activeWorkspace?: string;
  private heartbeatId?: number;

  constructor(ttlMs = 20000, heartbeatMs = 5000) {
    this.ttlMs = ttlMs;
    this.heartbeatMs = heartbeatMs;
  }

  bindWindowLifecycle(): void {
    const release = () => this.releaseCurrent();
    window.addEventListener("beforeunload", release);
    window.addEventListener("pagehide", release);
  }

  tryAcquire(workspace: string): AcquireResult {
    const target = workspace.trim();
    if (!target) return { ok: false };

    const now = Date.now();
    const existing = readLock(target);
    if (existing && existing.ownerId !== this.ownerId) {
      const alive = now - existing.heartbeatAt < this.ttlMs;
      if (alive) {
        return {
          ok: false,
          ownerId: existing.ownerId,
          heartbeatAt: existing.heartbeatAt,
        };
      }
    }

    if (this.activeWorkspace && this.activeWorkspace !== target) {
      this.release(this.activeWorkspace);
    }

    const nextLock: WorkspaceLockRecord = {
      workspace: target,
      ownerId: this.ownerId,
      acquiredAt: existing?.ownerId === this.ownerId ? existing.acquiredAt : now,
      heartbeatAt: now,
    };

    localStorage.setItem(lockKey(target), JSON.stringify(nextLock));
    this.activeWorkspace = target;
    this.startHeartbeat();

    return { ok: true };
  }

  releaseCurrent(): void {
    if (!this.activeWorkspace) return;
    this.release(this.activeWorkspace);
    this.activeWorkspace = undefined;
    if (this.heartbeatId) {
      window.clearInterval(this.heartbeatId);
      this.heartbeatId = undefined;
    }
  }

  private release(workspace: string): void {
    const existing = readLock(workspace);
    if (existing?.ownerId === this.ownerId) {
      localStorage.removeItem(lockKey(workspace));
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatId) return;
    this.heartbeatId = window.setInterval(() => {
      if (!this.activeWorkspace) return;

      const current = readLock(this.activeWorkspace);
      if (current && current.ownerId !== this.ownerId) {
        return;
      }

      const now = Date.now();
      const next: WorkspaceLockRecord = {
        workspace: this.activeWorkspace,
        ownerId: this.ownerId,
        acquiredAt: current?.acquiredAt ?? now,
        heartbeatAt: now,
      };
      localStorage.setItem(lockKey(this.activeWorkspace), JSON.stringify(next));
    }, this.heartbeatMs);
  }
}
