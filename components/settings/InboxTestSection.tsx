"use client";

import { useCallback, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "../ui/Toast";
import { PrimaryButton, SegmentedControl, TextArea, TextInput } from "./controls";

type Level = "info" | "warn" | "error";

const LEVELS: readonly Level[] = ["info", "warn", "error"] as const;

const LEVEL_COLORS: Record<Level, string> = {
  info: "var(--text-muted)",
  warn: "var(--warning)",
  error: "var(--error)",
};

const LEVEL_LABELS: Record<Level, string> = {
  info: "info",
  warn: "warn",
  error: "error",
};

type LastSent =
  | { ok: true; ts: number; source: string; level: Level; title: string }
  | { ok: false; ts: number; error: string }
  | null;

function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function isValidHref(value: string): boolean {
  if (value.length === 0) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function InboxTestSection() {
  const { t } = useI18n();
  const toast = useToast();
  const [source, setSource] = useState("test");
  const [level, setLevel] = useState<Level>("info");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [href, setHref] = useState("");
  const [sending, setSending] = useState(false);
  const [lastSent, setLastSent] = useState<LastSent>(null);

  const hrefValid = useMemo(() => isValidHref(href.trim()), [href]);
  const sourceValid = source.trim().length > 0;
  const titleValid = title.trim().length > 0;
  const canSend = sourceValid && titleValid && hrefValid && !sending;

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    setSending(true);
    const trimmedBody = body.trim();
    const trimmedHref = href.trim();
    try {
      const res = await fetch("/api/inbox/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: source.trim(),
          level,
          title: title.trim(),
          ...(trimmedBody ? { body: trimmedBody } : {}),
          ...(trimmedHref ? { href: trimmedHref } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = data.error ?? `HTTP ${res.status}`;
        setLastSent({ ok: false, ts: Date.now(), error: msg });
        toast.show({ kind: "error", message: msg });
        return;
      }
      setLastSent({
        ok: true,
        ts: Date.now(),
        source: source.trim(),
        level,
        title: title.trim(),
      });
      toast.show({ kind: "success", message: t("Test message sent") });
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : t("Network error");
      setLastSent({ ok: false, ts: Date.now(), error: msg });
      toast.show({ kind: "error", message: msg });
    } finally {
      setSending(false);
    }
  }, [canSend, source, level, title, body, href, t, toast]);

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px 0" }}>
        {t("Inbox Test")}
      </h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px 0", lineHeight: 1.5 }}>
        {t("Push a synthetic message into the Inbox to preview the bell badge, list, and source chip. Real RSS / scheduler pushes are unchanged.")}
      </p>

      {/* Source */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 6px 0" }}>
        {t("Test source")}
      </div>
      <TextInput
        value={source}
        onChange={setSource}
        maxLength={64}
        placeholder="test"
        invalid={!sourceValid}
      />

      {/* Level chips */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "14px 0 6px 0" }}>
        {t("Test level")}
      </div>
      <SegmentedControl
        value={level}
        onChange={(value) => setLevel(value as Level)}
        ariaLabel={t("Test level")}
        options={LEVELS.map((lv) => ({
          value: lv,
          label: (
            <>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: LEVEL_COLORS[lv], flexShrink: 0 }} />
              {LEVEL_LABELS[lv]}
            </>
          ),
        }))}
      />

      {/* Title */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "14px 0 6px 0" }}>
        {t("Test title")}
      </div>
      <TextInput
        value={title}
        onChange={setTitle}
        maxLength={300}
        placeholder={t("Test title placeholder")}
        invalid={!titleValid}
      />

      {/* Body */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "14px 0 6px 0" }}>
        {t("Test body")} <span style={{ color: "var(--text-dim)" }}>({t("Test optional hint")})</span>
      </div>
      <TextArea
        value={body}
        onChange={setBody}
        placeholder={t("Test optional body hint")}
        style={{ minHeight: 72 }}
      />

      {/* Href */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "14px 0 6px 0" }}>
        {t("Test link URL")} <span style={{ color: "var(--text-dim)" }}>({t("Test optional hint")})</span>
      </div>
      <TextInput
        value={href}
        onChange={setHref}
        placeholder="https://example.com"
        invalid={!hrefValid}
      />
      {!hrefValid && (
        <div style={{ fontSize: 11, color: "var(--error)", marginTop: 4 }}>
          {t("Test must be a valid URL")}
        </div>
      )}

      {/* Send */}
      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <PrimaryButton onClick={() => void handleSend()} disabled={!canSend}>
          {sending ? t("Test sending") : t("Test send")}
        </PrimaryButton>
        {lastSent && lastSent.ok && (
          <span style={{ fontSize: 12, color: "var(--success)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            ✓ {formatClock(lastSent.ts)} · {lastSent.source} · {lastSent.level} · “{truncate(lastSent.title, 60)}”
          </span>
        )}
        {lastSent && !lastSent.ok && (
          <span style={{ fontSize: 12, color: "var(--error)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            ✗ {formatClock(lastSent.ts)} · {lastSent.error}
          </span>
        )}
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}