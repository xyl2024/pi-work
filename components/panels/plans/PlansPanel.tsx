"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { RefreshIconButton } from "@/components/ui/RefreshIconButton";
import { copyText } from "@/lib/client/clipboard";
import {
  createPlan,
  deletePlan,
  fetchPlans,
  PlanConflictError,
  updatePlan,
} from "@/lib/client/plans";
import {
  hideCompletedPlans,
  toDateKey,
  type Plan,
  type PlanSectionId,
  type PlansResponse,
} from "@/lib/shared/plans";
import { PlanRow, type PlanConflictState, type PlanSaveStatus } from "./PlanRow";

interface PlansPanelProps {
  /** Bumped on every open; re-opening the tab refetches. */
  openCount: number;
}

/** Which note editor is open, and the `mtime` its content was loaded at. */
interface EditorTarget {
  path: string;
  mtime: string;
}

/** A 409 waiting for the user's 「覆盖 / 重载到新位置」 answer. */
type PendingConflict = PlanConflictState & { path: string };

const AUTOSAVE_MS = 600;

/**
 * Plans panel view — the Markdown files under `<dataRoot>/user-plans/`,
 * grouped into 收件箱 / 过期 / 今天 / 即将到来, plus the resident create input
 * that turns a title typed + Enter into one new plan file.
 *
 * Rows carry the whole editing loop: expand to write a note (600 ms debounce,
 * Ctrl/Cmd+S to save now), a round checkbox for 完成, and hover actions to copy
 * the file path or delete the file. It reads the filesystem on open, on window
 * re-focus and on the manual refresh button; there is no polling and no watcher
 * (ADR-0006). The local date is computed here, in the browser, and sent to the
 * server.
 *
 * Every write carries the `mtime` the panel last saw. When that no longer
 * matches — an agent or another editor touched the file — the server answers
 * 409 and the row shows 「覆盖 / 重载到新位置」 instead of silently overwriting.
 */
export function PlansPanel({ openCount }: PlansPanelProps) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<PlansResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [draft, setDraft] = useState("");
  const [saveStatus, setSaveStatus] = useState<PlanSaveStatus>("saved");
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Latch for the in-flight create: `creating` is a state update, so two
  // Enter presses in the same tick would both read `false` and create twice.
  const creatingRef = useRef(false);
  // The input is disabled while a create is in flight and a disabled control
  // cannot take focus, so the caret is restored once the re-enable has been
  // committed — by the effect below, not by the request handler.
  const refocusPending = useRef(false);

  // The editing loop reads and writes through refs: the debounce timer, the
  // unmount flush and the save callbacks must all see the *current* draft and
  // target, not the ones captured when they were created.
  const editorRef = useRef<EditorTarget | null>(null);
  const draftRef = useRef("");
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conflictRef = useRef<PendingConflict | null>(null);
  // Latest `flushNote` closure, for the retry-after-save and unmount flushes.
  const flushRef = useRef<(notify?: boolean) => Promise<void>>(async () => {});
  const retrySaveRef = useRef(false);

  const setEditorTarget = useCallback((next: EditorTarget | null) => {
    editorRef.current = next;
    setEditing(next);
  }, []);

  const setPendingConflict = useCallback((next: PendingConflict | null) => {
    conflictRef.current = next;
    setConflict(next);
  }, []);

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

  /** Re-read the list without the spinner, for conflict resolution. */
  const reload = useCallback(async (): Promise<PlansResponse | null> => {
    try {
      const fresh = await fetchPlans(toDateKey(new Date()), true);
      setData(fresh);
      setError(null);
      return fresh;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
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

  /** Replace one plan in the list with the version the server just returned. */
  const applyPlan = useCallback((plan: Plan) => {
    setData((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            sections: prev.sections.map((section) => ({
              ...section,
              plans: section.plans.map((item) => (item.path === plan.path ? plan : item)),
            })),
          },
    );
  }, []);

  const openEditor = useCallback(
    (plan: Plan) => {
      draftRef.current = plan.note;
      setDraft(plan.note);
      dirtyRef.current = false;
      setSaveStatus("saved");
      setEditorTarget({ path: plan.path, mtime: plan.mtime });
    },
    [setEditorTarget],
  );

  const closeEditor = useCallback(() => {
    setEditorTarget(null);
    draftRef.current = "";
    setDraft("");
    dirtyRef.current = false;
    setSaveStatus("saved");
  }, [setEditorTarget]);

  /**
   * Write the open note if it is dirty. A pending conflict blocks the write
   * until the user answers it, so a debounce that raced an external edit cannot
   * spin against the server.
   */
  const flushNote = useCallback(
    async (notify = false) => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const target = editorRef.current;
      if (target === null || !dirtyRef.current) return;
      if (conflictRef.current !== null) return;
      if (savingRef.current) {
        // A save is already in flight; run again once it settles so nothing
        // typed during the round trip is left unwritten.
        retrySaveRef.current = true;
        return;
      }
      savingRef.current = true;
      setSaveStatus("saving");
      try {
        const plan = await updatePlan({
          path: target.path,
          note: draftRef.current,
          expectedMtime: target.mtime,
        });
        applyPlan(plan);
        // Only touch the shared editor state if the user is still on this row
        // — switching rows mid-save hands the draft to the new one.
        if (editorRef.current?.path === target.path) {
          dirtyRef.current = false;
          setEditorTarget({ path: plan.path, mtime: plan.mtime });
          setSaveStatus("saved");
        }
        if (notify) toast.show({ kind: "success", message: t("Plan saved") });
      } catch (err) {
        if (err instanceof PlanConflictError) {
          setPendingConflict({
            path: target.path,
            code: err.code,
            movedTo: err.movedTo,
            retry: { kind: "note" },
          });
          if (editorRef.current?.path === target.path) setSaveStatus("unsaved");
        } else {
          if (editorRef.current?.path === target.path) setSaveStatus("error");
          toast.show({
            kind: "error",
            message: t("Failed to save plan"),
            description: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        savingRef.current = false;
        if (retrySaveRef.current) {
          retrySaveRef.current = false;
          void flushRef.current();
        }
      }
    },
    [applyPlan, flushRef, setEditorTarget, setPendingConflict, t, toast],
  );

  // Keep the unmount flush pointing at the latest closure without re-running
  // it: a cleanup that flushes on every state change would save mid-typing.
  useEffect(() => {
    flushRef.current = flushNote;
  }, [flushNote]);
  useEffect(
    () => () => {
      void flushRef.current();
    },
    [],
  );

  const handleNoteChange = useCallback(
    (value: string) => {
      draftRef.current = value;
      setDraft(value);
      dirtyRef.current = true;
      setSaveStatus("unsaved");
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flushNote();
      }, AUTOSAVE_MS);
    },
    [flushNote],
  );

  const toggleExpand = useCallback(
    (plan: Plan) => {
      if (editorRef.current?.path === plan.path) {
        void flushNote();
        closeEditor();
        setPendingConflict(null);
        return;
      }
      // Switching rows saves the one being left first.
      void flushNote();
      setPendingConflict(null);
      openEditor(plan);
    },
    [closeEditor, flushNote, openEditor, setPendingConflict],
  );

  const toggleDone = useCallback(
    async (plan: Plan) => {
      const desired = !plan.done;
      try {
        const updated = await updatePlan({
          path: plan.path,
          done: desired,
          expectedMtime: plan.mtime,
        });
        applyPlan(updated);
        if (editorRef.current?.path === plan.path) {
          setEditorTarget({ path: updated.path, mtime: updated.mtime });
        }
      } catch (err) {
        if (err instanceof PlanConflictError) {
          // Show the conflict where the user is looking, and remember that
          // 「覆盖」 must redo the toggle, not save a note.
          if (editorRef.current?.path !== plan.path) openEditor(plan);
          setPendingConflict({
            path: plan.path,
            code: err.code,
            movedTo: err.movedTo,
            retry: { kind: "done", done: desired },
          });
          return;
        }
        toast.show({
          kind: "error",
          message: t("Failed to update plan"),
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [applyPlan, openEditor, setEditorTarget, setPendingConflict, t, toast],
  );

  /** Put the completion state the user asked for on the file as it is now. */
  const saveDone = useCallback(
    async (path: string, done: boolean, mtime: string | undefined, force = false) => {
      const updated = await updatePlan({ path, done, expectedMtime: mtime, force });
      applyPlan(updated);
      if (editorRef.current?.path === updated.path) {
        setEditorTarget({ path: updated.path, mtime: updated.mtime });
      }
    },
    [applyPlan, setEditorTarget],
  );

  const resolveConflict = useCallback(
    async (choice: "overwrite" | "reload") => {
      const pending = conflictRef.current;
      if (pending === null) return;

      if (choice === "overwrite") {
        try {
          if (pending.retry.kind === "done") {
            // `force` skips the guard, so no mtime is needed — and none of the
            // list's (stale) data has to be trusted.
            await saveDone(pending.path, pending.retry.done, undefined, true);
          } else {
            const updated = await updatePlan({
              path: pending.path,
              note: draftRef.current,
              force: true,
            });
            dirtyRef.current = false;
            applyPlan(updated);
            if (editorRef.current?.path === updated.path) {
              setEditorTarget({ path: updated.path, mtime: updated.mtime });
              setSaveStatus("saved");
            }
          }
          setPendingConflict(null);
          // A 「覆盖」 of a completion toggle can still leave a dirty note behind.
          void flushNote();
        } catch (err) {
          toast.show({
            kind: "error",
            message: t("Failed to save plan"),
            description: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      // 「重载」: re-read the list and follow the file — then re-apply what the
      // user was doing, so nothing they did is dropped. For a content change
      // (same path, fresher bytes) the disk version is the truth and the draft
      // is replaced by what is actually in the file.
      const fresh = await reload();
      const target = pending.code === "missing" ? pending.movedTo : pending.path;
      const found = target === null ? undefined : findPlan(fresh, target);
      if (!found) {
        // Gone for good (or the reload failed): keep the notice up, so 「覆盖」
        // is still there to recreate the file where it used to be.
        toast.show({ kind: "error", message: t("The plan no longer exists") });
        return;
      }
      const noteWasDirty = dirtyRef.current;
      setPendingConflict(null);

      // 1. The refused action, applied to the file as it is now.
      if (pending.retry.kind === "done") {
        try {
          await saveDone(found.path, pending.retry.done, found.mtime);
        } catch (err) {
          toast.show({
            kind: "error",
            message: t("Failed to update plan"),
            description: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (pending.code === "modified") {
        openEditor(found);
      }

      // 2. A moved plan takes the open editor with it. Only a note the user
      //    actually typed is written to the new path — the editor merely
      //    pointing at a plan is not a reason to rewrite it elsewhere.
      if (pending.code === "missing" && editorRef.current?.path === pending.path) {
        setEditorTarget({ path: found.path, mtime: found.mtime });
        if (noteWasDirty) {
          dirtyRef.current = true;
          await flushNote();
        }
      }
    },
    [
      applyPlan,
      flushNote,
      openEditor,
      reload,
      saveDone,
      setEditorTarget,
      setPendingConflict,
      t,
      toast,
    ],
  );

  const dismissConflict = useCallback(() => {
    setPendingConflict(null);
    setSaveStatus(dirtyRef.current ? "unsaved" : "saved");
  }, [setPendingConflict]);

  const copyPath = useCallback(
    async (plan: Plan) => {
      try {
        await copyText(plan.absPath);
        toast.show({ kind: "success", message: t("Path copied"), description: plan.absPath });
      } catch {
        toast.show({ kind: "error", message: t("Copy path failed"), description: plan.absPath });
      }
    },
    [t, toast],
  );

  const removePlan = useCallback(
    async (plan: Plan) => {
      const ok = await confirm({
        title: t("Delete plan?"),
        description: `${plan.title}\n${plan.absPath}\n\n${t("This deletes the plan file permanently.")}`,
        confirmLabel: t("Delete"),
        destructive: true,
      });
      if (!ok) return;
      try {
        await deletePlan(plan.path);
        if (editorRef.current?.path === plan.path) closeEditor();
        if (conflictRef.current?.path === plan.path) setPendingConflict(null);
        toast.show({ kind: "success", message: t("Plan deleted") });
        await load();
      } catch (err) {
        toast.show({
          kind: "error",
          message: t("Failed to delete plan"),
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [closeEditor, confirm, load, setPendingConflict, t, toast],
  );

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

  const sections = useMemo(
    () => hideCompletedPlans(data?.sections ?? [], hideDone),
    [data, hideDone],
  );
  // The overdue section hides completed-only plans, so a lone done past plan
  // must still fall through to the empty state instead of a blank panel.
  const hasVisible = sections.some((section) =>
    section.id === "overdue"
      ? section.plans.some((plan) => !plan.done)
      : section.plans.length > 0,
  );
  const total = data?.sections.reduce((n, section) => n + section.plans.length, 0) ?? 0;
  const visibleCount = sections.reduce((n, section) => n + section.plans.length, 0);

  const renderRow = useCallback(
    (plan: Plan, showDate: boolean) => (
      <PlanRow
        key={plan.path}
        plan={plan}
        showDate={showDate}
        expanded={editing?.path === plan.path}
        draft={draft}
        saveStatus={saveStatus}
        conflict={conflict?.path === plan.path ? conflict : null}
        onToggleExpand={() => toggleExpand(plan)}
        onToggleDone={() => void toggleDone(plan)}
        onNoteChange={handleNoteChange}
        onSaveNote={() => void flushNote(true)}
        onResolveConflict={(choice) => void resolveConflict(choice)}
        onDismissConflict={dismissConflict}
        onCopyPath={() => void copyPath(plan)}
        onDelete={() => void removePlan(plan)}
      />
    ),
    [
      conflict,
      copyPath,
      dismissConflict,
      draft,
      editing,
      flushNote,
      handleNoteChange,
      removePlan,
      resolveConflict,
      saveStatus,
      toggleDone,
      toggleExpand,
    ],
  );

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
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{visibleCount}</span>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setHideDone((value) => !value)}
          aria-pressed={hideDone}
          style={{
            flexShrink: 0,
            padding: "2px 7px",
            fontSize: 10.5,
            color: hideDone ? "var(--text)" : "var(--text-muted)",
            background: hideDone ? "var(--bg-selected)" : "transparent",
            border: "1px solid var(--border)",
            borderRadius: 5,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {t(hideDone ? "Show completed" : "Hide completed")}
        </button>
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
        ) : !hasVisible ? (
          <div
            style={{
              padding: "32px 12px",
              textAlign: "center",
              fontSize: 12,
              color: "var(--text-dim)",
            }}
          >
            {total > 0 ? t("All plans are completed") : t("No plans yet")}
          </div>
        ) : (
          sections.map((section) =>
            section.id === "overdue" ? (
              <OverdueSection
                key={section.id}
                plans={section.plans}
                open={overdueOpen}
                onToggle={() => setOverdueOpen((value) => !value)}
                renderRow={renderRow}
              />
            ) : (
              <LabeledSection key={section.id} id={section.id} plans={section.plans} renderRow={renderRow} />
            ),
          )
        )}
      </div>
    </div>
  );
}

/** Look a plan up in a list payload by its plan-relative path. */
function findPlan(data: PlansResponse | null, path: string): Plan | undefined {
  return data?.sections.flatMap((section) => section.plans).find((plan) => plan.path === path);
}

type RenderRow = (plan: Plan, showDate: boolean) => React.ReactNode;

function LabeledSection({
  id,
  plans,
  renderRow,
}: {
  id: Exclude<PlanSectionId, "overdue">;
  plans: Plan[];
  renderRow: RenderRow;
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
      {plans.map((plan) => renderRow(plan, id === "upcoming"))}
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
  renderRow,
}: {
  plans: Plan[];
  open: boolean;
  onToggle: () => void;
  renderRow: RenderRow;
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
      {open && openPlans.map((plan) => renderRow(plan, true))}
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
