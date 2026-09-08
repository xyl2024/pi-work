"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "../ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import { copyText } from "@/lib/client/clipboard";
import { ICONS } from "@/components/ui/icons";
import { useContextMenu, type ContextMenuItem } from "../ui/ContextMenu";

const CWD_KEY = "pi-terminal-cwd";
/** localStorage key persisting the terminal tab bar across page refreshes. */
const STATE_KEY = "pi-terminal-tabs-state";

/** Generate a stable session id shared by the client and the terminal server. */
function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface TerminalPanelProps {
  /** cwd used when creating a new terminal (active session cwd, fallback chain). */
  defaultCwd: string;
  /** whether the bottom panel is visible. */
  open: boolean;
  /** collapse the panel — terminals keep running (their WS stays open). */
  onClosePanel: () => void;
  /** toggle occupying the whole center column above the terminal. */
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}

interface TabInfo {
  id: number;
  cwd: string;
  /** user-chosen display name; falls back to cwd when unset/empty. */
  title?: string;
  /**
   * Stable pane keys, left → right. Length 1 = single terminal; length 2 =
   * split view (`panes[0]` is always the original shell). Keys are identity,
   * not index, so closing one pane never remounts the survivor's pty.
   */
  panes: string[];
  /** pane key → server-side terminal session id; enables re-attach after refresh. */
  sessionIds: Record<string, string>;
}

interface PersistedTerminalState {
  tabs: TabInfo[];
  activeId: number | null;
  nextId: number;
  splitRatio: Record<number, number>;
  focusedPane: Record<number, string>;
}

function loadPersistedState(): PersistedTerminalState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedTerminalState;
    if (!Array.isArray(parsed.tabs) || typeof parsed.nextId !== "number") return null;
    // Drop any tab whose panes carry no session ids (corrupt / very old data).
    const tabs = parsed.tabs.filter(
      (tab) => tab && typeof tab.id === "number" && typeof tab.cwd === "string" && Array.isArray(tab.panes) && tab.panes.length > 0,
    );
    // Ensure every pane has a session id — a missing one would otherwise get a
    // fresh id on each render instead of a stable identity.
    for (const tab of tabs) {
      tab.sessionIds = { ...tab.sessionIds };
      for (const pane of tab.panes) {
        if (!tab.sessionIds[pane]) tab.sessionIds[pane] = newSessionId();
      }
    }
    return { ...parsed, tabs, activeId: typeof parsed.activeId === "number" ? parsed.activeId : null };
  } catch {
    return null;
  }
}

/** Minimum width of either split pane, in px (clamps divider dragging). */
const MIN_PANE_WIDTH = 120;

function terminalBasename(cwd: string): string {
  const normalized = cwd.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || cwd;
}

function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    background: v("--bg", "#0d1117"),
    foreground: v("--text", "#e6edf3"),
    cursor: v("--accent", "#4f9cf9"),
    selectionBackground: v("--bg-selected", "#264f78"),
    fontFamily: v("--font-mono-stack", "monospace"),
  };
}

const smallButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text)",
  padding: "2px 10px",
  cursor: "pointer",
  fontSize: 12,
  flexShrink: 0,
};

/**
 * One xterm + one WebSocket + one server-side pty. Owns its full lifecycle:
 * fetch the WS info → connect → send `start` with the fixed cwd and a stable
 * `sessionId`. The server keeps the pty (and its scrollback) alive across
 * disconnects, so reconnecting with the same `sessionId` re-attaches the
 * existing shell and replays its output; a missing session just spawns fresh.
 */
function TerminalInstance({
  cwd,
  active,
  focused = false,
  sessionId,
  paneKey,
  killRegistry,
}: {
  cwd: string;
  active: boolean;
  /** In split view only the focused pane owns keyboard focus. */
  focused?: boolean;
  /** Stable session id — the same one survives page refreshes. */
  sessionId: string;
  /** Identity of this pane within its tab; used for kill registration. */
  paneKey: string;
  /** pane key → server-kill sender, so closing a tab can kill its sessions. */
  killRegistry: React.MutableRefObject<Map<string, () => void>>;
}) {
  const { t } = useI18n();
  const toast = useToast();
  // `t` changes identity on locale switch — keep a ref so the WS effect
  // (which tears down the pty on re-run) never re-runs for a cosmetic change.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  // Same pattern as tRef: the WS effect must not re-run (and tear down the
  // pty) when focus moves between split panes.
  const focusedRef = useRef(focused);
  useEffect(() => {
    focusedRef.current = focused;
  }, [focused]);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<"connecting" | "ready" | "error" | "exited">("connecting");
  const [statusMsg, setStatusMsg] = useState("");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // Fetch the WS endpoint info once per (mount, retry).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/terminal")
      .then(async (res) => {
        if (!res.ok) throw new Error(tRef.current("Terminal server unavailable"));
        const { port, token } = (await res.json()) as { port: number; token: string };
        if (cancelled) return;
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        setWsUrl(`${proto}//${window.location.hostname}:${port}/?token=${token}`);
      })
      .catch((err) => {
        if (cancelled) return;
        setStatusMsg(err instanceof Error ? err.message : tRef.current("Terminal connection failed"));
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  // xterm + WebSocket live only while wsUrl is set.
  useEffect(() => {
    if (!wsUrl) return;
    const container = containerRef.current;
    if (!container) return;

    const theme = readTheme();
    const term = new Terminal({
      fontFamily: theme.fontFamily,
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: theme.background,
        foreground: theme.foreground,
        cursor: theme.cursor,
        selectionBackground: theme.selectionBackground,
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    // URL recognition: links are underlined + pointer-cursor on hover.
    // Ctrl/Cmd+left-click opens the link; a plain click does nothing
    // (VS Code-style). The handler fires on mouseup only when press and
    // release both land on the same link, so drag-selection across a URL
    // never triggers it. Note: with "noopener" window.open always returns
    // null, so the return value can't be used to detect popup blocking.
    const webLinks = new WebLinksAddon((event, uri) => {
      if (event.ctrlKey || event.metaKey) {
        window.open(uri, "_blank", "noopener");
      }
    });
    term.loadAddon(webLinks);
    term.open(container);
    // Match common terminal emulators: Ctrl+Shift+C copies the active selection
    // rather than sending the control sequence to the shell.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown" || !event.ctrlKey || !event.shiftKey || event.code !== "KeyC") {
        return true;
      }
      event.preventDefault();
      if (!term.hasSelection()) return false;
      void copyText(term.getSelection()).then(
        () => term.clearSelection(),
        (err: unknown) => {
          console.error("terminal clipboard write failed", err);
          toast.show({ kind: "error", message: tRef.current("Clipboard access denied") });
        },
      );
      return false;
    });
    if (focusedRef.current) term.focus();
    try {
      fit.fit();
    } catch {
      // container hidden mid-transition — resize will catch up on open
    }
    termRef.current = term;
    fitRef.current = fit;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    // Capture the map once — the ref object is stable, but exhaustive-deps
    // prefers using the captured value in the cleanup below.
    const registry = killRegistry.current;
    // Refs are stable, but capture the map once so the cleanup below doesn't
    // touch `current` after re-renders (exhaustive-deps).

    // Suppress onerror/onclose after intentional teardown (unmount,
    // disconnect) — otherwise cleanup's ws.close() would flip the instance
    // into the error state.
    let settled = false;

    ws.onopen = () => {
      if (settled) return;
      // Re-attaching with a known sessionId restores the live shell (with
      // scrollback replay); an unknown id just spawns a fresh one.
      ws.send(JSON.stringify({ type: "start", cwd, sessionId }));
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      setPhase("ready");
    };
    // Register the kill sender so the parent can terminate this pane's shell
    // when the tab/pane is closed (a plain ws close leaves the session alive).
    registry.set(paneKey, () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "kill", sessionId }));
    });
     
    ws.onmessage = (ev) => {
      let msg: { type?: string; data?: string; code?: number; message?: string };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "data" && typeof msg.data === "string") {
        term.write(msg.data);
      } else if (msg.type === "error") {
        setStatusMsg(msg.message ?? tRef.current("Terminal error"));
        setPhase("error");
      } else if (msg.type === "exit") {
        setExitCode(msg.code ?? 0);
        setPhase("exited");
      }
    };
    ws.onerror = () => {
      if (settled) return;
      setStatusMsg(tRef.current("Terminal connection failed"));
      setPhase("error");
    };
    ws.onclose = () => {
      if (settled) return;
      setStatusMsg(tRef.current("Terminal connection closed"));
      setPhase("error");
    };

    const dataSub = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "data", data }));
    });
    const resizeSub = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    // Right-click copy/paste. With selection → copy to clipboard; without →
    // paste from clipboard straight into the pty (same path as keyboard
    // input). xterm 6 does not bind the system clipboard on its own.
    const sendClipboardText = (text: string) => {
      if (!text) return;
      const liveWs = wsRef.current;
      if (liveWs?.readyState === WebSocket.OPEN) {
        liveWs.send(JSON.stringify({ type: "data", data: text }));
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (term.hasSelection()) {
        const selection = term.getSelection();
        void copyText(selection).then(
          () => {
            term.clearSelection();
          },
          (err: unknown) => {
            console.error("terminal clipboard write failed", err);
            toast.show({ kind: "error", message: tRef.current("Clipboard access denied") });
          },
        );
        return;
      }

      // Reading programmatically is prohibited by browsers on HTTP LAN origins.
      // A user-initiated paste event still exposes clipboardData, so Ctrl/Cmd+V
      // remains available below even when the async Clipboard API is not.
      if (!navigator.clipboard?.readText) {
        toast.show({ kind: "error", message: tRef.current("Use Ctrl + Shift + V to paste") });
        return;
      }
      navigator.clipboard.readText().then(sendClipboardText, (err: unknown) => {
        console.error("terminal clipboard read failed", err);
        toast.show({ kind: "error", message: tRef.current("Use Ctrl + Shift + V to paste") });
      });
    };
    const handlePaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain");
      if (text === undefined) return;
      e.preventDefault();
      sendClipboardText(text);
    };
    term.element?.addEventListener("contextmenu", handleContextMenu);
    term.element?.addEventListener("paste", handlePaste);

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // ignore
      }
    });
    ro.observe(container);

    return () => {
      settled = true;
      registry.delete(paneKey);
      dataSub.dispose();
      resizeSub.dispose();
      term.element?.removeEventListener("contextmenu", handleContextMenu);
      term.element?.removeEventListener("paste", handlePaste);
      ro.disconnect();
      try {
        ws.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
      termRef.current = null;
      fitRef.current = null;
      term.dispose();
    };
  }, [wsUrl, cwd, toast, sessionId, paneKey, killRegistry]);

  // When the tab becomes visible again (switch back, panel reopen), re-fit —
  // display:none / zero-height containers leave xterm with stale dimensions.
  // Focus is handled separately: in split view only the focused pane wins.
  useEffect(() => {
    if (!active) return;
    try {
      fitRef.current?.fit();
    } catch {
      // ignore
    }
  }, [active]);

  useEffect(() => {
    if (!active || !focused) return;
    termRef.current?.focus();
  }, [active, focused]);

  const handleRestart = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    setPhase("ready");
    setExitCode(null);
    setStatusMsg("");
    try {
      const term = termRef.current;
      if (term) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      ws.send(JSON.stringify({ type: "start", cwd, sessionId }));
    } catch {
      // ignore
    }
  }, [cwd, sessionId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, padding: 4 }} />
      {phase !== "ready" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
            padding: "4px 10px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-panel)",
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          {phase === "connecting" && <span>{t("Connecting")}…</span>}
          {phase === "error" && (
            <>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{statusMsg}</span>
              <button style={smallButtonStyle} onClick={() => setRetryKey((k) => k + 1)}>
                {t("Retry")}
              </button>
            </>
          )}
          {phase === "exited" && (
            <>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t("Process exited")} ({exitCode ?? 0})
              </span>
              <button style={smallButtonStyle} onClick={handleRestart}>
                {t("Restart")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * VS Code-style bottom terminal: a tab bar of independent terminals, each
 * backed by its own WebSocket + pty. Inactive tabs stay mounted so their
 * processes keep running while hidden.
 */
export function TerminalPanel({ defaultCwd, open, onClosePanel, fullscreen, onToggleFullscreen }: TerminalPanelProps) {
  const { t } = useI18n();
  const cm = useContextMenu();
  // Lazy one-time restore from localStorage (don't re-read every render).
  const initialRef = useRef<PersistedTerminalState | null | undefined>(undefined);
  if (initialRef.current === undefined) initialRef.current = loadPersistedState();
  const initial = initialRef.current;
  const [tabs, setTabs] = useState<TabInfo[]>(() => initial?.tabs ?? []);
  const [activeId, setActiveId] = useState<number | null>(() => initial?.activeId ?? null);
  const nextIdRef = useRef(initial?.nextId ?? 1);
  const openedRef = useRef((initial?.tabs.length ?? 0) > 0);
  /** pane key → kill sender registered by each TerminalInstance. */
  const killRegistryRef = useRef<Map<string, () => void>>(new Map());
  /** Split ratio (left pane width fraction) per tab id; absent → 50/50. */
  const [splitRatio, setSplitRatio] = useState<Record<number, number>>(() => initial?.splitRatio ?? {});
  /** Which split pane has keyboard focus, per tab id; absent → the original (left) pane. */
  const [focusedPane, setFocusedPane] = useState<Record<number, string>>(() => initial?.focusedPane ?? {});

  // Persist the tab bar so a page refresh restores the same terminals
  // (each re-attaches to its live server-side session by sessionId).
  useEffect(() => {
    try {
      const state: PersistedTerminalState = {
        tabs,
        activeId,
        nextId: nextIdRef.current,
        splitRatio,
        focusedPane,
      };
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      // ignore quota/serialization errors
    }
  }, [tabs, activeId, splitRatio, focusedPane]);

  const createTerminal = useCallback((cwd: string) => {
    const id = nextIdRef.current++;
    const paneKey = `${id}`;
    try {
      localStorage.setItem(CWD_KEY, cwd);
    } catch {
      // ignore
    }
    setTabs((prev) => [...prev, { id, cwd, title: terminalBasename(cwd), panes: [paneKey], sessionIds: { [paneKey]: newSessionId() } }]);
    setActiveId(id);
  }, []);

  // First time the panel opens, auto-create the first terminal (VS Code behavior).
  useEffect(() => {
    if (open && !openedRef.current) {
      openedRef.current = true;
      createTerminal(defaultCwd || "~");
    }
  }, [open, defaultCwd, createTerminal]);

  const closeTerminal = useCallback((id: number) => {
    setTabs((prev) => {
      const tab = prev.find((t) => t.id === id);
      // Kill the shell server-side before dropping the tab — a bare WS close
      // leaves the session alive by design (for refresh re-attach).
      if (tab) for (const pane of tab.panes) killRegistryRef.current.get(pane)?.();
      return prev.filter((tab) => tab.id !== id);
    });
  }, []);

  // ── Split view (right-click a tab → “Split tab”) ──────────────────

  /** Split a single-pane tab: spawns a fresh shell (same cwd) on the right. */
  const splitTerminal = useCallback((tabId: number) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== tabId || tab.panes.length !== 1) return tab;
        // Tab ids never repeat, so `${id}-b` is a stable unique pane key.
        const paneKey = `${tabId}-b`;
        return { ...tab, panes: [tab.panes[0], paneKey], sessionIds: { ...tab.sessionIds, [paneKey]: newSessionId() } };
      }),
    );
    setSplitRatio((prev) => {
      if (prev[tabId] === undefined) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next; // fresh split starts at 50/50 again
    });
    setFocusedPane((prev) => ({ ...prev, [tabId]: `${tabId}-b` }));
  }, []);

  /** Close one pane of a split tab; the survivor keeps its pty and goes full-width. */
  const closePane = useCallback((tabId: number, paneKey: string) => {
    killRegistryRef.current.get(paneKey)?.();
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== tabId || tab.panes.length !== 2) return tab;
        const sessionIds = { ...tab.sessionIds };
        delete sessionIds[paneKey];
        return { ...tab, panes: tab.panes.filter((key) => key !== paneKey), sessionIds };
      }),
    );
    setSplitRatio((prev) => {
      if (prev[tabId] === undefined) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  /** Drag the split divider; clamps both panes to MIN_PANE_WIDTH px. */
  const startSplitDrag = useCallback(
    (tabId: number, startRatio: number, e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const wrapper = e.currentTarget.parentElement;
      if (!wrapper) return;
      const width = wrapper.getBoundingClientRect().width;
      if (width < MIN_PANE_WIDTH * 2) return;
      const startX = e.clientX;
      const min = MIN_PANE_WIDTH / width;
      const onMove = (ev: PointerEvent) => {
        const next = Math.min(1 - min, Math.max(min, startRatio + (ev.clientX - startX) / width));
        setSplitRatio((prev) => ({ ...prev, [tabId]: next }));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    },
    [],
  );

  // ── Tab rename (double-click a tab) ─────────────────────────────────
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const startRename = useCallback((tab: TabInfo) => {
    setEditingId(tab.id);
    setEditingValue(tab.title ?? tab.cwd);
  }, []);

  const commitRename = useCallback(() => {
    if (editingId === null) return;
    const next = editingValue.trim();
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === editingId ? { ...tab, title: next || undefined } : tab,
      ),
    );
    setEditingId(null);
    setEditingValue("");
  }, [editingId, editingValue]);

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setEditingValue("");
  }, []);

  // Keep activeId valid; when the last tab closes, reset the opened flag so
  // the next panel open creates a fresh terminal.
  useEffect(() => {
    if (tabs.length === 0) {
      openedRef.current = false;
      if (activeId !== null) setActiveId(null);
      return;
    }
    if (!tabs.some((tab) => tab.id === activeId)) {
      setActiveId(tabs[tabs.length - 1].id);
    }
  }, [tabs, activeId]);

  const tabScrollRef = useRef<HTMLDivElement>(null);
  const handleTabWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = tabScrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const lineHeight = 16;
    const page = Math.max(el.clientWidth, 200);
    const normalize = (value: number) => {
      if (e.deltaMode === 1) return value * lineHeight;
      if (e.deltaMode === 2) return value * page;
      return value;
    };
    const next = el.scrollLeft + normalize(e.deltaY) + normalize(e.deltaX);
    if (next === el.scrollLeft) return;
    e.preventDefault();
    el.scrollLeft = next;
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          height: 34,
          background: "transparent",
          borderBottom: "1px solid var(--border)",
          padding: "0 6px",
          gap: 2,
          minWidth: 0,
        }}
      >
        <div
          ref={tabScrollRef}
          onWheel={handleTabWheel}
          style={{
            display: "flex",
            alignItems: "center",
            flex: 1,
            minWidth: 0,
            overflowX: "auto",
            overflowY: "hidden",
            gap: 2,
          }}
        >
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <Tooltip key={tab.id} content={tab.cwd}>
            <div
              onClick={() => setActiveId(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                const items: ContextMenuItem[] =
                  tab.panes.length === 1
                    ? [
                        {
                          key: "split",
                          label: t("Split tab"),
                          onSelect: () => splitTerminal(tab.id),
                        },
                      ]
                    : [
                        {
                          key: "unsplit",
                          label: t("Unsplit tab"),
                          // “Unsplit” always keeps the original (left) shell.
                          onSelect: () => closePane(tab.id, tab.panes[1]),
                        },
                      ];
                cm.open({ x: e.clientX, y: e.clientY, items, triggerElement: e.currentTarget as HTMLElement });
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                startRename(tab);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                flexShrink: 0,
                maxWidth: 200,
                height: 24,
                padding: "0 4px 0 8px",
                borderRadius: 4,
                cursor: "pointer",
                background: active ? "var(--bg-selected)" : "transparent",
                color: active ? "var(--text)" : "var(--text-muted)",
                fontSize: 12,
              }}
            >
              <TerminalTabIcon />
              {editingId === tab.id ? (
                <input
                  autoFocus
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelRename();
                    }
                    e.stopPropagation();
                  }}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    width: "100%",
                    background: "var(--bg)",
                    color: "var(--text)",
                    border: "1px solid var(--accent)",
                    borderRadius: 2,
                    padding: "0 4px",
                    height: 18,
                    fontSize: 12,
                    fontFamily: "var(--font-sans)",
                  }}
                />
              ) : (
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {tab.title || terminalBasename(tab.cwd)}
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTerminal(tab.id);
                }}
                aria-label={t("Close terminal")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 16,
                  height: 16,
                  padding: 0,
                  background: "transparent",
                  border: "none",
                  borderRadius: 3,
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 13,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
            </Tooltip>
          );
        })}
        <Tooltip content={t("New terminal")}>
        <button
          onClick={() => createTerminal(defaultCwd || "~")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            padding: 0,
            background: "transparent",
            border: "none",
            borderRadius: 4,
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 16,
            flexShrink: 0,
          }}
        >
          +
        </button>
        </Tooltip>
        </div>
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0, gap: 2 }}>
        <Tooltip content={t(fullscreen ? "Restore terminal" : "Maximize terminal")}>
        <button
          onClick={onToggleFullscreen}
          aria-label={t(fullscreen ? "Restore terminal" : "Maximize terminal")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            padding: 0,
            background: "transparent",
            border: "none",
            borderRadius: 4,
            color: "var(--text-muted)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          {fullscreen ? <ICONS.minimize size={14} /> : <ICONS.maximize size={14} />}
        </button>
        </Tooltip>
        <Tooltip content={t("Hide terminal")}>
        <button
          onClick={onClosePanel}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            padding: 0,
            background: "transparent",
            border: "none",
            borderRadius: 4,
            color: "var(--text-muted)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        </Tooltip>
      </div>
      </div>

      {/* Terminal bodies — inactive tabs stay mounted so their processes keep running.
          A split tab renders its two panes left/right with a draggable divider. */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const split = tab.panes.length === 2;
          const ratio = split ? (splitRatio[tab.id] ?? 0.5) : 1;
          const focusedKey = focusedPane[tab.id] ?? tab.panes[0];
          return (
            <div
              key={tab.id}
              style={{
                position: "absolute",
                inset: 0,
                display: active ? "flex" : "none",
                flexDirection: "row",
                minWidth: 0,
              }}
            >
              {tab.panes.map((paneKey, index) => (
                <Fragment key={paneKey}>
                  {index === 1 && (
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      onPointerDown={(e) => startSplitDrag(tab.id, ratio, e)}
                      className="w-[3px] shrink-0 cursor-col-resize bg-[var(--border)] transition-colors hover:bg-[var(--text-muted)]"
                    />
                  )}
                  <div
                    onMouseDown={() => {
                      if (focusedKey !== paneKey) setFocusedPane((prev) => ({ ...prev, [tab.id]: paneKey }));
                    }}
                    style={{ flex: split && index === 0 ? `0 0 ${ratio * 100}%` : "1 1 0%" }}
                    className={split ? "group relative flex min-w-0 flex-col" : "relative flex min-w-0 flex-col"}
                  >
                    <TerminalInstance
                      cwd={tab.cwd}
                      active={active}
                      focused={focusedKey === paneKey}
                      sessionId={tab.sessionIds[paneKey] ?? newSessionId()}
                      paneKey={paneKey}
                      killRegistry={killRegistryRef}
                    />
                    {split && (
                      <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          closePane(tab.id, paneKey);
                        }}
                        aria-label={t("Close terminal")}
                        style={{ background: "var(--bg)" }}
                        className="absolute right-1.5 top-1 z-10 flex h-5 w-5 items-center justify-center rounded text-[13px] leading-none text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-selected)] hover:text-[var(--text)] group-hover:opacity-100"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </Fragment>
              ))}
            </div>
          );
        })}
        {tabs.length === 0 && (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              color: "var(--text-dim)",
              fontSize: 12,
            }}
          >
            <span>{t("No terminals yet")}</span>
            <button
              onClick={() => createTerminal(defaultCwd || "~")}
              style={{
                background: "var(--accent)",
                border: "none",
                borderRadius: 4,
                color: "#fff",
                padding: "4px 14px",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {t("New terminal")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TerminalTabIcon() {
  // Terminal window + `>_` shell prompt — same glyph family as the reference
  // icon (rounded window frame, greater-than prompt, cursor underline).
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" />
      <path d="M7.3 9.4 L9.6 12.5 L7.3 15.6" />
      <line x1="12" y1="15.8" x2="16.5" y2="15.8" />
    </svg>
  );
}
