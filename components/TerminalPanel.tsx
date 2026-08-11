"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useI18n } from "@/hooks/useI18n";

type Phase = "pick" | "connecting" | "ready" | "error";

const CWD_KEY = "pi-terminal-cwd";

function defaultCwd(): string {
  try {
    return localStorage.getItem(CWD_KEY) ?? "~";
  } catch {
    return "~";
  }
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

export function TerminalPanel() {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [cwdInput, setCwdInput] = useState(defaultCwd);
  const [phase, setPhase] = useState<Phase>("pick");
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [statusLine, setStatusLine] = useState("");

  // xterm + WebSocket live only while wsUrl is set. Deliberately NOT keyed
  // on `phase` — the phase flips to "ready" on ws.onopen, which would tear
  // down the effect (and dispose the terminal) right after it starts.
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

    const ws = new WebSocket(wsUrl);

    // Suppress onerror/onclose after intentional teardown (unmount,
    // disconnect) — otherwise cleanup's ws.close() would flip the panel
    // into the error state.
    let settled = false;

    ws.onopen = () => {
      if (settled) return;
      ws.send(JSON.stringify({ type: "start", cwd: cwdInput.trim() }));
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
        setStatusLine(msg.message ?? t("Terminal error"));
      } else if (msg.type === "exit") {
        setStatusLine(`${t("Process exited")} (${msg.code ?? 0})`);
      }
    };
    ws.onerror = () => {
      if (settled) return;
      setErrorMsg(t("Terminal connection failed"));
      setPhase("error");
    };
    ws.onclose = () => {
      if (settled) return;
      setErrorMsg(t("Terminal connection closed"));
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
      term.dispose();
    };
  }, [wsUrl, cwdInput, t]);

  const handleConnect = useCallback(async () => {
    const cwd = cwdInput.trim();
    if (!cwd) {
      setErrorMsg(t("Enter a terminal directory"));
      return;
    }
    try {
      localStorage.setItem(CWD_KEY, cwd);
    } catch {
      // ignore
    }
    setErrorMsg("");
    setStatusLine("");
    try {
      const res = await fetch("/api/terminal");
      if (!res.ok) throw new Error(t("Terminal server unavailable"));
      const { port, token } = (await res.json()) as { port: number; token: string };
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      setWsUrl(`${proto}//${window.location.hostname}:${port}/?token=${token}`);
      setPhase("connecting");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t("Terminal connection failed"));
      setPhase("error");
    }
  }, [cwdInput, t]);

  const handleDisconnect = useCallback(() => {
    setPhase("pick");
    setWsUrl(null);
    setErrorMsg("");
    setStatusLine("");
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, flexShrink: 0, padding: "4px 8px",
          background: "var(--bg-panel)", borderBottom: "1px solid var(--border)",
          fontSize: 12, color: "var(--text-muted)",
        }}
      >
        <span style={{ color: "var(--text)" }}>{t("Terminal")}</span>
        {phase === "ready" ? (
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={cwdInput}>
            {cwdInput}
          </span>
        ) : null}
        {statusLine ? <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{statusLine}</span> : null}
        {phase === "ready" || phase === "connecting" ? (
          <button
            onClick={handleDisconnect}
            style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", padding: "2px 8px", cursor: "pointer", fontSize: 12 }}
          >
            {t("Disconnect")}
          </button>
        ) : null}
      </div>

      {phase === "pick" ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 12, padding: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "min(420px, 100%)" }}>
            <label style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("Terminal directory")}</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={cwdInput}
                onChange={(e) => setCwdInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConnect();
                }}
                placeholder="~/my-project"
                spellCheck={false}
                style={{
                  flex: 1, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 4,
                  color: "var(--text)", padding: "6px 8px", fontSize: 13, outline: "none",
                }}
              />
              <button
                onClick={handleConnect}
                style={{
                  background: "var(--accent)", border: "none", borderRadius: 4, color: "#fff",
                  padding: "6px 14px", cursor: "pointer", fontSize: 13,
                }}
              >
                {t("Connect")}
              </button>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["~", "~/.pi-work/workspace", "/tmp"].map((p) => (
                <button
                  key={p}
                  onClick={() => setCwdInput(p)}
                  style={{
                    background: "transparent", border: "1px solid var(--border)", borderRadius: 4,
                    color: "var(--text-muted)", padding: "2px 8px", cursor: "pointer", fontSize: 11,
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          {errorMsg ? <div style={{ fontSize: 12, color: "var(--accent)" }}>{errorMsg}</div> : null}
        </div>
      ) : (
        <div ref={containerRef} style={{ flex: 1, minHeight: 0, padding: 4 }} />
      )}

      {phase === "error" ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 16px", gap: 8, alignItems: "center", background: "var(--bg-panel)", borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{errorMsg}</span>
          <button
            onClick={() => setPhase("pick")}
            style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", padding: "2px 8px", cursor: "pointer", fontSize: 12, flexShrink: 0 }}
          >
            {t("Back")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
