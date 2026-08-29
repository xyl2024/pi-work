"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  key: string;
  label?: string;
  ariaLabel?: string;
  onSelect: () => void;
  destructive?: boolean;
  separatorBefore?: boolean;
  disabled?: boolean;
}

interface ContextMenuState {
  id: string;
  x: number;
  y: number;
  items: ContextMenuItem[];
  /**
   * Scroll root that should dismiss this menu when *it* scrolls. When
   * `null`, *any* scroll on the page closes the menu (legacy behavior).
   *
   * Set by `open()` callers via `triggerElement`: the provider walks
   * up to the nearest scrollable ancestor so that programmatic
   * scrolling in unrelated areas (e.g. ChatWindow auto-scrolling while
   * a message is streaming) doesn't dismiss a context menu the user
   * just opened on a different surface (e.g. the session tab bar).
   */
  scrollRoot: HTMLElement | Window | null;
}

interface ContextMenuOpenArgs {
  x: number;
  y: number;
  items: ContextMenuItem[];
  /**
   * Optional DOM element that originated the menu (typically the right
   * click target). Used to determine the scroll root that should
   * dismiss this menu. Pass `null`/omit to keep the legacy
   * "close on any scroll" behavior.
   */
  triggerElement?: HTMLElement | null;
}

interface ContextMenuContextValue {
  state: ContextMenuState | null;
  open: (args: ContextMenuOpenArgs) => void;
  close: () => void;
}

const ContextMenuContext = createContext<ContextMenuContextValue | null>(null);

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `ctx-${Date.now()}-${_idCounter}`;
}

const ESTIMATED_WIDTH = 220;
const ESTIMATED_HEIGHT_PER_ITEM = 24;
const EDGE_PADDING = 8;

function findScrollableAncestor(el: HTMLElement | null): HTMLElement | Window {
  let cur: HTMLElement | null = el;
  while (cur && cur !== document.body) {
    const style = typeof window !== "undefined" ? window.getComputedStyle(cur) : null;
    if (style) {
      const overflowY = style.overflowY;
      const overflowX = style.overflowX;
      // Only use an element as the root when it can actually scroll. Many
      // layout containers use `overflow: hidden` merely for clipping and
      // should not shadow the real scroll container above them.
      const canScrollY =
        (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
        cur.scrollHeight > cur.clientHeight;
      const canScrollX =
        (overflowX === "auto" || overflowX === "scroll" || overflowX === "overlay") &&
        cur.scrollWidth > cur.clientWidth;
      if (canScrollY || canScrollX) return cur;
    }
    cur = cur.parentElement;
  }
  return window;
}

function isScrollInRoot(target: EventTarget | null, root: HTMLElement | Window | null): boolean {
  if (!target) return false;
  // No explicit root: any scroll closes (back‑forward behavior).
  if (root === null) return true;
  if (root === window) {
    // window-level scrolls only — target is the document / window itself.
    return target === window || target === document || (target instanceof HTMLElement && target === document.documentElement);
  }
  if (!(target instanceof Node)) return false;
  if (target === root) return true;
  // Some browsers set `e.target` to the deepest scrollable element;
  // others set it to a parent. Use contains() to cover both.
  return (root as HTMLElement).contains(target);
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ContextMenuState | null>(null);
  const stateRef = useRef<ContextMenuState | null>(null);
  stateRef.current = state;

  const close = useCallback(() => {
    stateRef.current = null;
    setState(null);
  }, []);

  const open = useCallback((args: ContextMenuOpenArgs) => {
    // Clamp position to viewport
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;
    const separators = args.items.filter((i) => i.separatorBefore).length;
    const totalH = args.items.length * ESTIMATED_HEIGHT_PER_ITEM + separators * 9;
    const x = Math.min(args.x, vw - ESTIMATED_WIDTH - EDGE_PADDING);
    const y = Math.min(args.y, vh - totalH - EDGE_PADDING);
    const scrollRoot = args.triggerElement ? findScrollableAncestor(args.triggerElement) : null;
    setState({
      id: nextId(),
      x: Math.max(EDGE_PADDING, x),
      y: Math.max(EDGE_PADDING, y),
      items: args.items,
      scrollRoot,
    });
  }, []);

  // Close triggers: outside mousedown, ESC, scroll (scoped), resize
  useEffect(() => {
    if (!state) return;

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-pi-context-menu]")) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    // Only dismiss the menu when the *trigger's* scroll root actually
    // scrolls. This prevents ChatWindow's per-token auto-scroll from
    // killing a context menu the user just opened on the session tab
    // bar, the right-side panel, etc. Legacy `state.scrollRoot === null`
    // callers still get the old "any scroll closes" behavior.
    const onScroll = (e: Event) => {
      if (isScrollInRoot(e.target, state.scrollRoot)) close();
    };
    const onResize = () => close();

    // Use capture so we get the event before any inner handlers
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize, true);
    };
  }, [state, close]);

  const value = useMemo<ContextMenuContextValue>(() => ({ state, open, close }), [state, open, close]);

  return (
    <ContextMenuContext.Provider value={value}>
      {children}
      {state && <ContextMenuView state={state} onItem={close} />}
    </ContextMenuContext.Provider>
  );
}

export function useContextMenu(): ContextMenuContextValue {
  const ctx = useContext(ContextMenuContext);
  if (!ctx) throw new Error("useContextMenu must be used within ContextMenuProvider");
  return ctx;
}

function ContextMenuView({ state, onItem }: { state: ContextMenuState; onItem: () => void }) {
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalEl(document.body);
  }, []);

  if (!portalEl) return null;

  return createPortal(
    <div
      data-pi-context-menu
      role="menu"
      style={{
        position: "fixed",
        left: state.x,
        top: state.y,
        zIndex: 10001,
        minWidth: 180,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        boxShadow: "0 6px 20px rgba(0,0,0,0.32)",
        padding: 4,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((it) => (
        <ContextMenuRow key={it.key} item={it} onPick={onItem} />
      ))}
    </div>,
    portalEl
  );
}

function ContextMenuRow({ item, onPick }: { item: ContextMenuItem; onPick: () => void }) {
  if (item.separatorBefore) {
    return (
      <>
        <div
          role="separator"
          style={{
            height: 1,
            background: "var(--border)",
            margin: "4px 4px",
          }}
        />
        <RowInner item={item} onPick={onPick} />
      </>
    );
  }
  return <RowInner item={item} onPick={onPick} />;
}

function RowInner({ item, onPick }: { item: ContextMenuItem; onPick: () => void }) {
  return (
    <div
      role="menuitem"
      aria-label={item.ariaLabel ?? item.label}
      aria-disabled={item.disabled}
      onMouseDown={(e) => {
        // Use mousedown to close before potential click handlers fire on items
        e.preventDefault();
        e.stopPropagation();
        if (item.disabled) return;
        item.onSelect();
        onPick();
      }}
      style={{
        padding: "5px 10px",
        fontSize: 12,
        color: item.disabled
          ? "var(--text-dim)"
          : item.destructive
            ? "#f87171"
            : "var(--text)",
        cursor: item.disabled ? "default" : "pointer",
        borderRadius: 4,
        userSelect: "none",
        background: "transparent",
      }}
      onMouseEnter={(e) => {
        if (!item.disabled) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {item.label}
    </div>
  );
}
