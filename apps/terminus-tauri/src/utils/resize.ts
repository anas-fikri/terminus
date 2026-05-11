/**
 * Attach a drag-resize handle between two sibling elements.
 * The handle sits between `prev` and `next` inside `container`.
 * `direction`: "horizontal" resizes widths (left/right panels).
 */
export function attachResizeHandle(
  container: HTMLElement,
  prev: HTMLElement,
  next: HTMLElement,
  direction: "horizontal" | "vertical",
  storageKey?: string
): HTMLElement {
  const handle = document.createElement("div");
  handle.className = `resize-handle resize-handle--${direction}`;
  container.insertBefore(handle, next);

  let dragging = false;
  let startPos = 0;
  let startPrevSize = 0;
  let startNextSize = 0;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    startPos = direction === "horizontal" ? e.clientX : e.clientY;
    const prevRect = prev.getBoundingClientRect();
    const nextRect = next.getBoundingClientRect();
    startPrevSize = direction === "horizontal" ? prevRect.width : prevRect.height;
    startNextSize = direction === "horizontal" ? nextRect.width : nextRect.height;
    document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const pos = direction === "horizontal" ? e.clientX : e.clientY;
    const delta = pos - startPos;
    const newPrev = Math.max(80, Math.min(startPrevSize + delta, startPrevSize + startNextSize - 80));
    const newNext = startPrevSize + startNextSize - newPrev;

    if (direction === "horizontal") {
      prev.style.width = `${newPrev}px`;
      next.style.width = `${newNext}px`;
      prev.style.flex = "none";
      next.style.flex = "none";
    } else {
      prev.style.height = `${newPrev}px`;
      next.style.height = `${newNext}px`;
      prev.style.flex = "none";
      next.style.flex = "none";
    }

    if (storageKey) {
      localStorage.setItem(storageKey, String(newPrev));
    }
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  // Restore persisted size
  if (storageKey) {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const size = Number(saved);
      if (size > 0) {
        if (direction === "horizontal") {
          prev.style.width = `${size}px`;
          prev.style.flex = "none";
        } else {
          prev.style.height = `${size}px`;
          prev.style.flex = "none";
        }
      }
    }
  }

  return handle;
}
