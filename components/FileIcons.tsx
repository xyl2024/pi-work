// File & folder icons for the sidebar file tree.
//
// Icons are sourced from vscode-icons (MIT, https://github.com/vscode-icons/vscode-icons)
// and served as static SVGs from /file-icons/*.svg. The icon set has ~1200 entries
// covering most common file types (React, Python, Go, Rust, Vue, etc.) plus folder
// variants. The lookup map (lib/file-icon-map.ts) is auto-generated from the
// vscode-icons source data.
//
// For files / folders not in the vscode-icons map we fall back to a minimal
// monochrome placeholder so the tree is never blank.

import {
  fileIconByName,
  fileIconByExt,
  fileIconCombos,
  folderIconByName,
  defaultFolderIcon,
  defaultFolderOpenIcon,
} from "@/lib/file-icon-map";

interface IconProps {
  size?: number;
}

const FILE_ICON_PREFIX = "/file-icons/file_type_";
const FOLDER_ICON_PREFIX = "/file-icons/folder_type_";

/** Build the /file-icons/*.svg URL for an icon name. vscode-icons stores the
 *  default fallback icons (`default_file`, `default_folder`,
 *  `default_root_folder`, …) at the root of /file-icons/ with no
 *  `file_type_` / `folder_type_` prefix; every other icon has the prefix. */
function iconUrl(name: string, kind: "file" | "folder"): string {
  if (name.startsWith("default_")) return `/file-icons/${name}.svg`;
  const prefix = kind === "file" ? FILE_ICON_PREFIX : FOLDER_ICON_PREFIX;
  return `${prefix}${name}.svg`;
}

/** Look up the vscode-icons icon name for a file. Returns the SVG stem (without
 *  the `file_type_` prefix) or null when the name doesn't match anything. */
export function lookupFileIconName(name: string): string | null {
  const lower = name.toLowerCase();
  // 1. Exact filename match (handles package.json, Dockerfile, .gitignore, etc.)
  if (Object.prototype.hasOwnProperty.call(fileIconByName, lower)) {
    return fileIconByName[lower];
  }
  const dot = lower.lastIndexOf(".");
  if (dot > 0) {
    const stem = lower.slice(0, dot);
    const ext = lower.slice(dot + 1);
    // 2. stem + allowed extensions combo (e.g. tsconfig.json, vite.config.ts)
    for (const c of fileIconCombos) {
      if (c.filename === stem && c.exts.includes(ext)) return c.icon;
    }
    // 3. Plain extension (tsx → reactts, py → python, …)
    if (Object.prototype.hasOwnProperty.call(fileIconByExt, ext)) {
      return fileIconByExt[ext];
    }
  } else if (dot === 0) {
    // 4. Dotfiles: ".env" → strip the leading dot, look up the rest as an
    //    extension (handles `.env`, `.gitignore` once the fileIconByName
    //    miss above fell through).
    const ext = lower.slice(1);
    if (Object.prototype.hasOwnProperty.call(fileIconByExt, ext)) {
      return fileIconByExt[ext];
    }
  }
  return null;
}

/** Look up the vscode-icons icon name for a folder (with optional `_opened`
 *  suffix when open). */
export function lookupFolderIconName(name: string, open: boolean): string | null {
  const lower = name.toLowerCase();
  const base = folderIconByName[lower];
  if (!base) return null;
  if (open) return base + "_opened";
  return base;
}

// ── Rendering ──────────────────────────────────────────────────────────────

function VscodeIcon({ src, size, title }: { src: string; size: number; title?: string }) {
  // Inline-rendered SVG so it follows CSS currentColor / var() when the icon
  // ships hardcoded fills we override at render time. `loading="lazy"` keeps
  // the explorer snappy when folders have many files.
  // <img> (not Next/Image): file tree icons are 14×14 px and not LCP-critical,
  // and <img> lets the browser cache the SVGs across sessions without per-icon
  // webpack ceremony.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      width={size}
      height={size}
      alt={title ?? ""}
      loading="lazy"
      draggable={false}
      style={{ display: "block", flexShrink: 0 }}
    />
  );
}

function FallbackFileIcon({ size }: { size: number }) {
  // Minimal monochrome file outline for files vscode-icons doesn't cover.
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 2h7l3 3v9H3V2Z"
        stroke="var(--text-dim)"
        strokeWidth="1"
        fill="var(--text-dim)"
        fillOpacity="0.08"
      />
      <path d="M10 2v3h3" stroke="var(--text-dim)" strokeWidth="1" fill="none" strokeLinejoin="round" />
    </svg>
  );
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Render the file tree icon for `name`. Tries the vscode-icons set first and
 *  falls back to a monochrome outline when nothing matches. */
export function getFileIcon(name: string, size = 14): React.ReactNode {
  const iconName = lookupFileIconName(name);
  if (iconName) {
    return <VscodeIcon src={iconUrl(iconName, "file")} size={size} title={iconName} />;
  }
  return <FallbackFileIcon size={size} />;
}

/** Render the folder icon. Pass `name` so we can pick the matching icon
 *  (`src`, `node_modules`, `.github`, …); without it we show the default
 *  vscode-icons folder icon. */
export function FolderIcon({
  size = 14,
  open = false,
  name,
}: IconProps & { open?: boolean; name?: string }) {
  const matched = name ? lookupFolderIconName(name, open) : null;
  const fallback = open ? defaultFolderOpenIcon : defaultFolderIcon;
  const iconName = matched ?? fallback;
  return <VscodeIcon src={iconUrl(iconName, "folder")} size={size} title={iconName} />;
}

/** Cwd / project icon — a filled, theme-tinted folder-with-tab silhouette
 *  used by the sidebar cwd headers and the CwdPicker trigger. Uses
 *  `currentColor` so the call site controls the colour via CSS (sidebar
 *  headers and the picker trigger both render it with `var(--text-muted)`,
 *  brightening to `var(--text)` on hover). The icon already depicts an
 *  "opened" folder, so there is no open/closed variant — the chevron next
 *  to the basename is the canonical expand/collapse affordance. */
export function CwdIcon({ size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      <path
        d="M5.19629 1.57104C5.81144 1.5711 6.38623 1.8786 6.72754 2.39038L7.19922 3.09839C7.28454 3.22635 7.42824 3.30344 7.58203 3.30347H12.1699C13.5039 3.30348 14.5859 4.38548 14.5859 5.71948V6.62671C15.2694 7.02689 15.6605 7.85012 15.4385 8.68726L14.3848 12.658C14.1037 13.7164 13.1449 14.4527 12.0498 14.4529H2.91699C1.51651 14.4529 0.451662 13.2814 0.501954 11.9519V3.98706C0.501954 2.65305 1.58396 1.57104 2.91797 1.57104H5.19629ZM3.7793 7.75562C3.30994 7.75562 2.89883 8.07153 2.77832 8.52515L1.91602 11.7722C1.74167 12.4291 2.23734 13.073 2.91699 13.073H12.0498C12.5191 13.0728 12.9304 12.757 13.0508 12.3035L14.1045 8.33374C14.1819 8.04202 13.9619 7.756 13.6602 7.75562H3.7793ZM2.91797 2.9519C2.34625 2.9519 1.88281 3.41534 1.88281 3.98706V7.2937C2.33068 6.7269 3.02249 6.37476 3.7793 6.37476H13.2051V5.71948C13.2051 5.14777 12.7416 4.68434 12.1699 4.68433H7.58203C6.96675 4.6843 6.39209 4.37595 6.05078 3.86401L5.5791 3.15601C5.49379 3.02821 5.34995 2.95196 5.19629 2.9519H2.91797Z"
        fill="currentColor"
      />
      <path
        opacity="0.2"
        d="M13.6602 7.75525C13.9618 7.7556 14.1815 8.04179 14.1045 8.33337L13.0508 12.3031C12.9304 12.7567 12.5191 13.0725 12.0498 13.0726H2.91701C2.23744 13.0725 1.7417 12.4287 1.91603 11.7719L2.77834 8.52478C2.89898 8.07146 3.31018 7.75532 3.77931 7.75525H13.6602ZM5.1963 2.95154C5.34985 2.95159 5.49377 3.02803 5.57912 3.15564L6.0508 3.86365C6.39205 4.37553 6.96685 4.68385 7.58205 4.68396H12.1699C12.7416 4.68396 13.2049 5.14754 13.2051 5.71912V6.37439H3.77931C3.02267 6.37444 2.33067 6.72671 1.88283 7.29333V3.98669C1.88299 3.4152 2.34649 2.95168 2.91798 2.95154H5.1963Z"
        fill="currentColor"
      />
    </svg>
  );
}
