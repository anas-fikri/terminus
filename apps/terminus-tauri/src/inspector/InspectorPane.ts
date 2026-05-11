import "./inspector.css";

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const INSPECT_PROPS = [
  "display", "position", "width", "height", "margin", "padding",
  "font-size", "font-family", "font-weight", "color", "background-color",
  "border", "border-radius", "flex", "grid", "z-index", "opacity",
  "overflow", "box-shadow", "cursor",
];

export class InspectorPane {
  private el: HTMLElement;
  private pickerActive = false;
  private overlay: HTMLElement | null = null;
  private highlight: HTMLElement | null = null;
  private contentEl!: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    this.mount();
  }

  private mount(): void {
    this.el.innerHTML = `
      <div class="inspector">
        <div class="inspector__header">
          <span class="inspector__title">Inspector</span>
          <button class="inspector__pick-btn" id="insp-pick">⊕ Pick Element</button>
        </div>
        <div class="inspector__body" id="insp-body">
          <div class="inspector__hint">
            Click <strong>Pick Element</strong> then hover &amp; click any element to inspect it.
          </div>
        </div>
      </div>
    `;

    this.contentEl = this.el.querySelector("#insp-body")!;
    this.el.querySelector("#insp-pick")!.addEventListener("click", () => {
      this.pickerActive ? this.stopPicker() : this.startPicker();
    });
  }

  private startPicker(): void {
    this.pickerActive = true;
    const btn = this.el.querySelector<HTMLButtonElement>("#insp-pick")!;
    btn.textContent = "✕ Cancel";
    btn.classList.add("inspector__pick-btn--active");

    // Transparent overlay captures all pointer events
    this.overlay = document.createElement("div");
    this.overlay.className = "inspector-overlay";

    // Floating highlight box
    this.highlight = document.createElement("div");
    this.highlight.className = "inspector-highlight";
    this.highlight.style.display = "none";

    document.body.appendChild(this.overlay);
    document.body.appendChild(this.highlight);

    this.overlay.addEventListener("mousemove", (e) => {
      const target = this.elementUnder(e.clientX, e.clientY);
      if (target) this.positionHighlight(target);
    });

    this.overlay.addEventListener("click", (e) => {
      e.preventDefault();
      const target = this.elementUnder(e.clientX, e.clientY);
      if (target) {
        this.showElement(target);
        this.stopPicker();
      }
    });

    // Escape key cancels
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { this.stopPicker(); document.removeEventListener("keydown", onKey); }
    };
    document.addEventListener("keydown", onKey);
  }

  private stopPicker(): void {
    this.pickerActive = false;
    const btn = this.el.querySelector<HTMLButtonElement>("#insp-pick");
    if (btn) { btn.textContent = "⊕ Pick Element"; btn.classList.remove("inspector__pick-btn--active"); }
    this.overlay?.remove();
    this.highlight?.remove();
    this.overlay = null;
    this.highlight = null;
  }

  /** Get real element under cursor by hiding overlay temporarily */
  private elementUnder(x: number, y: number): Element | null {
    if (this.overlay) this.overlay.style.pointerEvents = "none";
    const el = document.elementFromPoint(x, y);
    if (this.overlay) this.overlay.style.pointerEvents = "";
    if (!el || el === this.overlay || el === this.highlight) return null;
    return el;
  }

  private positionHighlight(el: Element): void {
    if (!this.highlight) return;
    const r = el.getBoundingClientRect();
    Object.assign(this.highlight.style, {
      display: "block",
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  }

  private showElement(el: Element): void {
    const styles = window.getComputedStyle(el);
    const attrs = Array.from(el.attributes)
      .map((a) => `<span class="insp-attr-name">${escHtml(a.name)}</span>=<span class="insp-attr-val">"${escHtml(a.value)}"</span>`)
      .join(" ");

    const styleRows = INSPECT_PROPS
      .filter((p) => styles.getPropertyValue(p).trim())
      .map(
        (p) =>
          `<div class="insp-row"><span class="insp-prop">${p}</span><span class="insp-val">${escHtml(styles.getPropertyValue(p).trim())}</span></div>`
      )
      .join("");

    // Breadcrumb path
    const path = this.breadcrumb(el);

    // Box model dimensions
    const rect = el.getBoundingClientRect();

    this.contentEl.innerHTML = `
      <div class="insp-section">
        <div class="insp-section-title">Path</div>
        <div class="insp-breadcrumb">${path}</div>
      </div>

      <div class="insp-section">
        <div class="insp-section-title">Element</div>
        <pre class="insp-code">&lt;<strong>${escHtml(el.tagName.toLowerCase())}</strong> ${attrs}&gt;</pre>
      </div>

      <div class="insp-section">
        <div class="insp-section-title">Box — ${rect.width.toFixed(1)} × ${rect.height.toFixed(1)} px</div>
        <div class="insp-box-model">
          <div class="insp-box-outer">margin</div>
          <div class="insp-box-border">border</div>
          <div class="insp-box-padding">padding</div>
          <div class="insp-box-content">${rect.width.toFixed(0)} × ${rect.height.toFixed(0)}</div>
        </div>
      </div>

      <div class="insp-section">
        <div class="insp-section-title">Computed Styles</div>
        <div class="insp-styles">${styleRows || "<em>—</em>"}</div>
      </div>

      <div class="insp-section">
        <div class="insp-section-title">innerHTML (first 600 chars)</div>
        <pre class="insp-code">${escHtml(el.innerHTML.slice(0, 600))}</pre>
      </div>
    `;
  }

  private breadcrumb(el: Element): string {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body) {
      const tag = cur.tagName.toLowerCase();
      const id = cur.id ? `#${cur.id}` : "";
      const cls = cur.className && typeof cur.className === "string"
        ? "." + cur.className.trim().split(/\s+/).slice(0, 2).join(".")
        : "";
      parts.unshift(`<span class="insp-crumb">${escHtml(tag + id + cls)}</span>`);
      cur = cur.parentElement;
    }
    return parts.join(" › ");
  }
}
