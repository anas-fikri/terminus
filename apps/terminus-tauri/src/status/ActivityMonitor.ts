export interface ActivitySnapshot {
  skill: string;
  tool: string;
  detail: string;
  workspace: string;
  timestamp: number;
}

const EVENT_NAME = "terminus:activity";
const STORAGE_KEY = "terminus:last-activity";

const DEFAULT_ACTIVITY: ActivitySnapshot = {
  skill: "idle",
  tool: "startup",
  detail: "Waiting for actions",
  workspace: ".",
  timestamp: Date.now(),
};

let lastActivity = loadInitialActivity();

function loadInitialActivity(): ActivitySnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ACTIVITY };
    const parsed = JSON.parse(raw) as Partial<ActivitySnapshot>;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_ACTIVITY };
    return {
      skill: typeof parsed.skill === "string" ? parsed.skill : DEFAULT_ACTIVITY.skill,
      tool: typeof parsed.tool === "string" ? parsed.tool : DEFAULT_ACTIVITY.tool,
      detail: typeof parsed.detail === "string" ? parsed.detail : DEFAULT_ACTIVITY.detail,
      workspace: typeof parsed.workspace === "string" ? parsed.workspace : DEFAULT_ACTIVITY.workspace,
      timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now(),
    };
  } catch {
    return { ...DEFAULT_ACTIVITY };
  }
}

function persistActivity(snapshot: ActivitySnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage quota errors.
  }
}

export function trackActivity(update: Partial<ActivitySnapshot> & { tool: string }): ActivitySnapshot {
  lastActivity = {
    skill: update.skill ?? lastActivity.skill,
    tool: update.tool,
    detail: update.detail ?? lastActivity.detail,
    workspace: update.workspace ?? lastActivity.workspace,
    timestamp: Date.now(),
  };

  persistActivity(lastActivity);
  window.dispatchEvent(new CustomEvent<ActivitySnapshot>(EVENT_NAME, { detail: lastActivity }));
  return { ...lastActivity };
}

export function getLastActivity(): ActivitySnapshot {
  return { ...lastActivity };
}

export function onActivityChanged(cb: (snapshot: ActivitySnapshot) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<ActivitySnapshot>).detail;
    cb(detail);
  };
  window.addEventListener(EVENT_NAME, handler as EventListener);
  return () => window.removeEventListener(EVENT_NAME, handler as EventListener);
}