/**
 * Flat monochrome SVG icons (16×16 viewBox, currentColor fill).
 * Returns an inline SVG string suitable for innerHTML.
 */
export function icon(name: IconName, size = 14): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:inline-block;vertical-align:middle;flex-shrink:0">
    ${PATHS[name]}
  </svg>`;
}

export type IconName =
  | "terminal"
  | "file"
  | "folder"
  | "folder-open"
  | "globe"
  | "tree"
  | "plus"
  | "close"
  | "chevron-right"
  | "chevron-down"
  | "eye"
  | "paperclip"
  | "project"
  | "browse";

const PATHS: Record<IconName, string> = {
  terminal: `<rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
    <polyline points="5,6 7.5,8 5,10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="8.5" y1="10" x2="11" y2="10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`,

  file: `<path d="M4 2h5.5L12 4.5V14H4V2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    <polyline points="9.5,2 9.5,5 12,5" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    <line x1="6" y1="8" x2="10" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
    <line x1="6" y1="10.5" x2="10" y2="10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,

  folder: `<path d="M2 4.5A1.5 1.5 0 013.5 3h3l1.5 1.5H12.5A1.5 1.5 0 0114 6v5.5A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5V4.5z"
    stroke="currentColor" stroke-width="1.3" fill="none"/>`,

  "folder-open": `<path d="M2 5.5A1.5 1.5 0 013.5 4h3l1.5 1.5H12A1.5 1.5 0 0113.5 7v.5H3A1 1 0 002 8.5v3A1.5 1.5 0 003.5 13h9A1.5 1.5 0 0014 11.5L13 7"
    stroke="currentColor" stroke-width="1.3" fill="none"/>`,

  globe: `<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/>
    <ellipse cx="8" cy="8" rx="2.5" ry="6" stroke="currentColor" stroke-width="1.1"/>
    <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.1"/>
    <line x1="2.5" y1="5.5" x2="13.5" y2="5.5" stroke="currentColor" stroke-width="1.1"/>
    <line x1="2.5" y1="10.5" x2="13.5" y2="10.5" stroke="currentColor" stroke-width="1.1"/>`,

  tree: `<rect x="7" y="2" width="5" height="3" rx="1" stroke="currentColor" stroke-width="1.2"/>
    <rect x="2" y="6.5" width="4.5" height="3" rx="1" stroke="currentColor" stroke-width="1.2"/>
    <rect x="9.5" y="6.5" width="4.5" height="3" rx="1" stroke="currentColor" stroke-width="1.2"/>
    <rect x="2" y="11" width="4.5" height="3" rx="1" stroke="currentColor" stroke-width="1.2"/>
    <line x1="9.5" y1="5" x2="9.5" y2="6.5" stroke="currentColor" stroke-width="1.1"/>
    <line x1="4.25" y1="5" x2="9.5" y2="5" stroke="currentColor" stroke-width="1.1"/>
    <line x1="4.25" y1="5" x2="4.25" y2="6.5" stroke="currentColor" stroke-width="1.1"/>
    <line x1="4.25" y1="9.5" x2="4.25" y2="11" stroke="currentColor" stroke-width="1.1"/>`,

  plus: `<line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,

  close: `<line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,

  "chevron-right": `<polyline points="6,4 10,8 6,12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,

  "chevron-down": `<polyline points="4,6 8,10 12,6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,

  eye: `<path d="M2 8s2.5-4.5 6-4.5S14 8 14 8s-2.5 4.5-6 4.5S2 8 2 8z" stroke="currentColor" stroke-width="1.3"/>
    <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.2"/>`,

  paperclip: `<path d="M12 5.5L7 10.5a2.5 2.5 0 01-3.5-3.5l5.5-5.5a1.5 1.5 0 012 2L5.5 9a.5.5 0 01-.7-.7L10 3"
    stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/>`,

  project: `<rect x="2" y="3" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.3"/>
    <rect x="9" y="3" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.3"/>
    <rect x="2" y="9" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.3"/>
    <rect x="9" y="9" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.3"/>`,

  browse: `<path d="M2 4h9v8H2z" stroke="currentColor" stroke-width="1.3" fill="none"/>
    <path d="M5 4V3h7v7h-2" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/>`,
};
