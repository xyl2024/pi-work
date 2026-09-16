"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { RefreshIconButton } from "@/components/ui/RefreshIconButton";
import { createPlan, fetchPlans } from "@/lib/client/plans";
import {
  toDateKey,
  type Plan,
  type PlansResponse,
  type PlanSectionId,
} from "@/lib/shared/plans";

interface PlansPanelProps {
  /** Bumped on every open; re-opening the tab refetches. */
  openCount: number;
}

/**
 * Plans panel view — the Markdown files under `<dataRoot>/user-plans/`,
 * grouped into 收件箱 / 过期 / 今天 / 即将到来, plus the resident create input
 * that turns a title typed + Enter into one new plan file.
 *
 * It reads the filesystem on open, on window re-focus and on the manual
 * refresh button; there is no polling and no watcher (ADR-0006). The local
 * date is computed here, in the browser, and sent to the server.
 */
export function PlansPanel({ openCount }: PlansPanelProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [data, setData] = useState<PlansResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Latch for the in-flight create: `creating` is a state update, so two
  // Enter presses in the same tick would both read `false` and create twice.
  const creatingRef = useRef(false);
  // The input is disabled while a create is in flight and a disabled control
  // cannot take focus, so the caret is restored once the re-enable has been
  // committed — by the effect below, not by the request handler.
  const refocusPending = useRef(false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      setData(await fetchPlans(toDateKey(new Date()), refresh));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch whenever the view is opened, including a re-open of an already
  // mounted tab (openCount changes; the body may have stayed alive while the
  // panel was collapsed).
  useEffect(() => {
    if (openCount > 0) void load();
  }, [openCount, load]);

  // Opening the view also hands the keyboard to the entry input: recording a
  // plan is the panel's one action, and this is the same openCount-as-focus
  // handoff the BTW panel uses for `/btw`. It is what makes the palette's
  // "New plan" entry land the caret in the box.
  useEffect(() => {
    if (openCount > 0) inputRef.current?.focus();
  }, [openCount]);

  // …and when the window regains focus, which is the usual way to notice an
  // external editor's or the agent's change.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const submit = useCallback(async () => {
    const value = title.trim();
    if (!value || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      // The default anchor is the browser's today; the server never picks a
      // date for us.
      await createPlan({ title: value, anchor: { kind: "day", date: toDateKey(new Date()) } });
      setTitle("");
      await load();
    } catch (err) {
      toast.show({
        kind: "error",
        message: t("Failed to create plan"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      creatingRef.current = false;
      // Keep the flow going: clear the box, keep the caret, record another.
      refocusPending.current = true;
      setCreating(false);
    }
  }, [title, load, toast, t]);

  useEffect(() => {
    if (creating || !refocusPending.current) return;
    refocusPending.current = false;
    inputRef.current?.focus();
  }, [creating]);

  const sections = data?.sections ?? [];
  // The overdue section hides completed-only plans, so a lone done past plan
  // must still fall through to the empty state instead of a blank panel.
  const hasPlans = sections.some((section) =>
    section.id === "overdue"
      ? section.plans.some((plan) => !plan.done)
      : section.plans.length > 0,
  );
  const total = sections.reduce((n, section) => n + section.plans.length, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 34,
          padding: "0 4px 0 12px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{t("Plans")}</span>
        {data !== null && (
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{total}</span>
        )}
        <span style={{ flex: 1 }} />
        <RefreshIconButton onClick={() => void load(true)} disabled={loading} />
      </div>

      <div style={{ padding: "8px 10px", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 28,
            padding: "0 8px",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            borderRadius: 6,
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--text-dim)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            style={{ flexShrink: 0 }}
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <input
            ref={inputRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              // Enter creates, the box stays put for the next one; Escape
              // abandons what was typed. `isComposing` lets the Enter that
              // commits an IME candidate (Chinese input) through untouched —
              // the same guard the chat input uses.
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              } else if (event.key === "Escape") {
                setTitle("");
              }
            }}
            placeholder={t("Record a plan for today; press Enter")}
            aria-label={t("New plan")}
            disabled={creating}
            style={{
              flex: 1,
              minWidth: 0,
              height: "100%",
              fontSize: 12,
              color: "var(--text)",
              background: "transparent",
              border: "none",
              outline: "none",
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 10px 24px" }}>
        {error !== null ? (
          <div style={{ padding: "8px 4px", fontSize: 12, color: "var(--error)" }}>
            <div>{t("Failed to load plans")}</div>
            <div style={{ marginTop: 4, color: "var(--text-dim)", wordBreak: "break-word" }}>{error}</div>
            <button
              type="button"
              onClick={() => void load(true)}
              style={{
                marginTop: 8,
                padding: "3px 10px",
                fontSize: 11,
                color: "var(--text)",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border)",
                borderRadius: 5,
                cursor: "pointer",
              }}
            >
              {t("Retry")}
            </button>
          </div>
        ) : data === null ? (
          <div style={{ padding: "8px 4px", fontSize: 12, color: "var(--text-dim)" }}>
            {t("Loading")}
          </div>
        ) : !hasPlans ? (
          <div
            style={{
              padding: "32px 12px",
              textAlign: "center",
              fontSize: 12,
              color: "var(--text-dim)",
            }}
          >
            {t("No plans yet")}
          </div>
        ) : (
          sections.map((section) =>
            section.id === "overdue" ? (
              <OverdueSection
                key={section.id}
                plans={section.plans}
                open={overdueOpen}
                onToggle={() => setOverdueOpen((value) => !value)}
              />
            ) : (
              <LabeledSection key={section.id} id={section.id} plans={section.plans} />
            ),
          )
        )}
      </div>
    </div>
  );
}

function LabeledSection({
  id,
  plans,
}: {
  id: Exclude<PlanSectionId, "overdue">;
  plans: Plan[];
}) {
  const { t } = useI18n();
  if (plans.length === 0) return null;

  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          padding: "4px 4px",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-muted)",
          letterSpacing: "0.02em",
        }}
      >
        {t(SECTION_LABEL_KEY[id])}
      </div>
      {plans.map((plan) => (
        <PlanRow key={plan.path} plan={plan} showDate={id === "upcoming"} />
      ))}
    </div>
  );
}

const SECTION_LABEL_KEY: Record<Exclude<PlanSectionId, "overdue">, string> = {
  inbox: "plans.inbox",
  today: "Today",
  upcoming: "Upcoming",
};

/**
 * Overdue plans live behind one collapsed row. The row counts and lists only
 * the *open* ones — a plan with a past anchor that is already done is history,
 * not a reminder, and would otherwise read "0 open" while showing items.
 */
function OverdueSection({
  plans,
  open,
  onToggle,
}: {
  plans: Plan[];
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const openPlans = plans.filter((plan) => !plan.done);
  if (openPlans.length === 0) return null;

  return (
    <div style={{ marginBottom: 10 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "4px 4px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--text-muted)",
          fontSize: 11,
          fontWeight: 600,
          textAlign: "left",
        }}
      >
        <Chevron open={open} />
        <span>{t("{n} overdue open plans", { n: openPlans.length })}</span>
      </button>
      {open && openPlans.map((plan) => <PlanRow key={plan.path} plan={plan} showDate />)}
    </div>
  );
}

function PlanRow({ plan, showDate }: { plan: Plan; showDate: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 6px",
        borderRadius: 5,
        opacity: plan.done ? 0.5 : 1,
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
      }}
    >
      <span
        aria-hidden
        style={{
          width: 12,
          flexShrink: 0,
          textAlign: "center",
          fontSize: 11,
          color: "var(--success)",
        }}
      >
        {plan.done ? "✓" : ""}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 12.5,
          color: "var(--text)",
        }}
      >
        {plan.title}
      </span>
      {showDate && plan.anchor.kind === "day" && (
        <span
          style={{
            flexShrink: 0,
            fontSize: 10.5,
            fontFamily: "var(--font-mono)",
            color: "var(--text-dim)",
          }}
        >
          {plan.anchor.date.slice(5)}
        </span>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        flexShrink: 0,
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 0.12s",
      }}
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}
