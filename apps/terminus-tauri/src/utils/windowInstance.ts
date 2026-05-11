const SESSION_KEY = "terminus-window-instance-id";

export function getWindowInstanceId(): string {
  const existing = sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;

  const generated =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `win-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  sessionStorage.setItem(SESSION_KEY, generated);
  return generated;
}
