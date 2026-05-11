import type { AiStateValue } from "../ipc/bridge";
import "./status.css";

const STATE_LABELS: Record<AiStateValue, string> = {
  loading: "Loading",
  working: "Working",
  thinking: "Thinking",
  streaming: "Streaming",
  done: "Ready",
  error: "Error",
};

export class AiStateIndicator {
  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    this.el.className = "ai-state";
  }

  setState(state: AiStateValue): void {
    this.el.className = `ai-state ai-state--${state}`;
    const dot = state !== "done" ? `<span class="ai-state__dot"></span>` : "";
    this.el.innerHTML = `${dot}<span>${STATE_LABELS[state]}</span>`;
  }
}
