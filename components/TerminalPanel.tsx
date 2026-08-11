"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "./Tooltip";

const CWD_KEY = "pi-terminal-cwd";

export interface TerminalPanelProps {
  /** cwd used when creating a new terminal (active session cwd, fallback chain). */
  defaultCwd: string;
  /** whether the bottom panel is visible. */
  open: boolean;
  /** where the terminal panel is currently docked. */
  location: "bottom" | "right";
  onMove: () => void;
  /** whether the panel is maximized. */
  maximized: boolean;
  onToggleMaximize: () => void;
  /** collapse the panel — terminals keep running (their WS stays open). */
  onClosePanel: () => void;
}

interface TabInfo {
  id: number;
  cwd: string;
  /** user-chosen display name; falls back to cwd when unset/empty. */
  title?: string;
}

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
    fontFamily: v("--font-mono", "monospace"),
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
 * fetch the WS info → connect → send `start` with the fixed cwd. Closing the
 * WS (tab close / unmount) makes the server kill the pty; restart re-sends
 * `start` over the same connection.
 */
function TerminalInstance({ cwd, active }: { cwd: string; active: boolean }) {
  const { t } = useI18n();
  // `t` changes identity on locale switch — keep a ref so the WS effect
  // (which tears down the pty on re-run) never re-runs for a cosmetic change.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
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
    term.open(container);
    try {
      fit.fit();
    } catch {
      // container hidden mid-transition — resize will catch up on open
    }
    termRef.current = term;
    fitRef.current = fit;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Suppress onerror/onclose after intentional teardown (unmount,
    // disconnect) — otherwise cleanup's ws.close() would flip the instance
    // into the error state.
    let settled = false;

    ws.onopen = () => {
      if (settled) return;
      ws.send(JSON.stringify({ type: "start", cwd }));
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      setPhase("ready");
    };
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
      dataSub.dispose();
      resizeSub.dispose();
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
  }, [wsUrl, cwd]);

  // When the tab becomes visible again (switch back, panel reopen), re-fit —
  // display:none / zero-height containers leave xterm with stale dimensions.
  useEffect(() => {
    if (!active) return;
    try {
      fitRef.current?.fit();
    } catch {
      // ignore
    }
  }, [active]);

  const handleRestart = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    setPhase("ready");
    setExitCode(null);
    setStatusMsg("");
    try {
      const term = termRef.current;
      if (term) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      ws.send(JSON.stringify({ type: "start", cwd }));
    } catch {
      // ignore
    }
  }, [cwd]);

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
export function TerminalPanel({ defaultCwd, open, location, onMove, maximized, onToggleMaximize, onClosePanel }: TerminalPanelProps) {
  const { t } = useI18n();
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const nextIdRef = useRef(1);
  const openedRef = useRef(false);

  const createTerminal = useCallback((cwd: string) => {
    const id = nextIdRef.current++;
    try {
      localStorage.setItem(CWD_KEY, cwd);
    } catch {
      // ignore
    }
    setTabs((prev) => [...prev, { id, cwd, title: terminalBasename(cwd) }]);
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
    setTabs((prev) => prev.filter((tab) => tab.id !== id));
  }, []);

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
          background: "var(--bg-panel)",
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
                    outline: "none",
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
        <Tooltip content={location === "bottom" ? t("Move terminal to right") : t("Move terminal to bottom")}>
        <button
          onClick={onMove}
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
            {location === "bottom" ? (
              <>
                <path d="M14 5l7 7-7 7" />
                <path d="M3 12h18" />
              </>
            ) : (
              <>
                <path d="M5 10l7 7 7-7" />
                <path d="M12 3v14" />
              </>
            )}
          </svg>
        </button>
        </Tooltip>
        {location === "bottom" && (
        <Tooltip content={maximized ? t("Restore terminal") : t("Maximize terminal")}>
        <button
          onClick={onToggleMaximize}
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
            {maximized ? (
              <>
                <path d="M8 3v3a2 2 0 0 1-2 2H3" />
                <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
                <path d="M3 16h3a2 2 0 0 1 2 2v3" />
                <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
              </>
            ) : (
              <>
                <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
              </>
            )}
          </svg>
        </button>
        </Tooltip>
        )}
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

      {/* Terminal bodies — inactive tabs stay mounted so their processes keep running */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            style={{ position: "absolute", inset: 0, display: tab.id === activeId ? "block" : "none" }}
          >
            <TerminalInstance cwd={tab.cwd} active={tab.id === activeId} />
          </div>
        ))}
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
