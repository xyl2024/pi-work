"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { useTransientFlag } from "@/hooks/useTransientFlag";
import { setSettings } from "@/hooks/settingsStore";
import type { SettingsPageDataCache } from "@/lib/client/settings-page-cache";
import type {
  DangerousCommandVerdict,
  DangerousRuleSetSnapshot,
} from "@/lib/shared/dangerous-commands";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import {
  DANGEROUS_RULE_TIMEOUT_MAX_MS,
  DANGEROUS_RULE_TIMEOUT_MIN_MS,
  addDangerousRule,
  dangerousRulesDraft,
  dangerousRulesDraftProblem,
  dangerousRulesRequestBody,
  isDangerousRulesDraftDirty,
  moveDangerousRule,
  removeDangerousRule,
  updateDangerousRule,
  type DangerousRulesDraft,
} from "@/lib/shared/dangerous-commands-draft";
import { Field, PrimaryButton, SETTINGS_RADIUS, TextInput, inputStyle } from "../controls";
import { SaveButton, UnsavedHint } from "../staged-save";
import { useSettingsPageData } from "../use-page-data";
import type { DirtyReporter } from "../use-unsaved-changes";
import { DangerousRuleEditor } from "../dangerous-commands/DangerousRuleEditor";
import { RuleList, RuleRow } from "../dangerous-commands/DangerousRuleList";
import { dangerousRuleProblemText } from "@/lib/client/dangerous-commands-problem-text";

async function loadRuleSet(): Promise<DangerousRuleSetSnapshot> {
  const response = await fetch("/api/dangerous-commands", { cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as DangerousRuleSetSnapshot & {
    error?: string;
  };
  if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

async function testCommand(command: string): Promise<DangerousCommandVerdict> {
  const response = await fetch("/api/dangerous-commands/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });
  const data = (await response.json().catch(() => ({}))) as DangerousCommandVerdict & {
    error?: string;
  };
  if (!response.ok || data.error || typeof data.kind !== "string") {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  return data;
}

function VerdictView({ verdict }: { verdict: DangerousCommandVerdict }) {
  const { t } = useI18n();

  if (verdict.kind === "self_protected") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
          padding: "9px 11px",
          border: "1px solid var(--error)",
          borderRadius: SETTINGS_RADIUS,
          background: "var(--bg)",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--error)" }}>
          {t("Hard-blocked — cannot be configured here")}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {t(
            "Self-protection refuses commands that would take this server down. It is not a rule, so it is neither listed nor editable on this page.",
          )}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
          {verdict.reason}
        </span>
      </div>
    );
  }

  if (verdict.kind === "matched") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          padding: "9px 11px",
          border: "1px solid var(--border)",
          borderRadius: SETTINGS_RADIUS,
          background: "var(--bg)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
            {t("Asks for confirmation")}
          </span>
          <span
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 999,
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
            }}
          >
            {verdict.source === "user" ? t("Your rule") : t("Built-in rule")}
          </span>
        </div>
        <code style={{ fontSize: 11, color: "var(--text)", fontFamily: "var(--font-mono)" }}>
          {verdict.ruleName}
        </code>
        <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {t(
            "The command is not blocked: it waits for your answer (allow once, allow similar, or deny) until the confirmation times out.",
          )}
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "9px 11px",
        border: "1px solid var(--border)",
        borderRadius: SETTINGS_RADIUS,
        background: "var(--bg)",
        fontSize: 11,
        color: "var(--text-muted)",
        lineHeight: 1.5,
      }}
    >
      {t("No match — the command would run without a confirmation.")}
    </div>
  );
}

function CommandTester() {
  const { t } = useI18n();
  const [command, setCommand] = useState("");
  const [verdict, setVerdict] = useState<DangerousCommandVerdict | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const run = async () => {
    const id = ++latestRequest.current;
    setError(null);
    if (command.trim() === "") {
      setTesting(false);
      setVerdict({ kind: "none" });
      return;
    }
    setTesting(true);
    try {
      const next = await testCommand(command);
      if (id !== latestRequest.current) return;
      setVerdict(next);
    } catch (reason) {
      if (id !== latestRequest.current) return;
      setVerdict(null);
      setError(reason instanceof Error && reason.message ? reason.message : String(reason));
    } finally {
      if (id === latestRequest.current) setTesting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {t("Try a command")}
        </h3>
        <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {t(
            "Checks a command against the rules in force right now — the same check a real tool call goes through. Nothing is executed.",
          )}
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
        style={{ display: "flex", gap: 8, alignItems: "center" }}
      >
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="pkill node"
          aria-label={t("Command to test")}
          spellCheck={false}
          autoComplete="off"
          style={{
            ...inputStyle,
            flex: 1,
            minWidth: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}
        />
        <PrimaryButton type="submit" disabled={testing}>
          {testing ? t("Testing…") : t("Test")}
        </PrimaryButton>
      </form>

      {error ? (
        <div style={{ fontSize: 11, color: "var(--error)" }}>
          {t("Failed to test the command")}: {error}
        </div>
      ) : null}
      {verdict ? <VerdictView verdict={verdict} /> : null}
    </div>
  );
}

export function DangerousCommandsSection({
  config,
  pageCache,
  onDirtyChange,
}: {
  config: PiWorkConfig;
  pageCache: SettingsPageDataCache;
  onDirtyChange?: DirtyReporter;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const { data, loading, error, mutate } = useSettingsPageData(
    pageCache,
    "dangerous-commands",
    loadRuleSet,
  );

  const savedRules = config.dangerous_patterns.rules;
  const savedTimeoutMs = config.dangerous_patterns.timeout_ms;
  const [draft, setDraft] = useState<DangerousRulesDraft | null>(null);
  const [timeoutText, setTimeoutText] = useState(() => String(savedTimeoutMs));
  const [editor, setEditor] = useState<null | { mode: "new" } | { mode: "edit"; uid: string }>(null);
  const [saving, setSaving] = useState(false);
  const [savedOk, flashSavedOk] = useTransientFlag();

  const current = draft ?? dangerousRulesDraft(savedRules, savedTimeoutMs);
  const editingRule =
    editor?.mode === "edit" ? current.rules.find((entry) => entry.uid === editor.uid) : undefined;
  const editingRowIndex =
    editor?.mode === "edit" ? current.rules.findIndex((entry) => entry.uid === editor.uid) : -1;
  const builtinNames = (data?.builtins ?? []).map((rule) => rule.name);
  const dirty = isDangerousRulesDraftDirty(current, savedRules, savedTimeoutMs);
  const problem = dangerousRulesDraftProblem(current, { builtinNames });
  const timeoutProblem = problem?.kind === "timeout" ? problem : null;
  const rowProblem = problem && problem.kind !== "timeout" ? problem : null;
  const problemText = rowProblem
    ? dangerousRuleProblemText(rowProblem, t, t("Rule {n}", { n: rowProblem.index + 1 }))
    : null;

  const changeTimeout = (value: string) => {
    setTimeoutText(value);
    setDraft({ ...current, timeoutMs: value.trim() === "" ? Number.NaN : Number(value) });
  };

  useEffect(() => {
    if (draft === null) setTimeoutText(String(savedTimeoutMs));
  }, [draft, savedTimeoutMs]);

  useEffect(() => {
    onDirtyChange?.("dangerous-commands", dirty);
  }, [dirty, onDirtyChange]);

  const save = async () => {
    if (saving || problem) return;
    const body = dangerousRulesRequestBody(current);
    setSaving(true);
    try {
      const response = await fetch("/api/dangerous-commands", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `HTTP ${response.status}`);
      }
      setSettings({
        ...config,
        dangerous_patterns: { rules: body.rules, timeout_ms: body.timeoutMs },
      });
      if (data) mutate({ ...data, invalidUserRules: [] });
      setDraft(null);
      flashSavedOk();
      toast.show({ kind: "success", message: t("Settings saved") });
    } catch (e) {
      toast.show({
        kind: "error",
        message: e instanceof Error && e.message ? e.message : t("Failed to save settings"),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
      <section>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            {t("Your rules")}
          </h3>
          <PrimaryButton onClick={() => setEditor({ mode: "new" })}>{t("New rule")}</PrimaryButton>
        </div>

        {current.rules.length > 0 && (
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {t(
              "Order only affects which rule name is shown and remembered when several rules match the same command — it never changes whether a confirmation appears.",
            )}
          </p>
        )}

        <div style={{ marginTop: 8 }}>
          {current.rules.length === 0 ? (
            <div
              style={{
                border: "1px dashed var(--border)",
                borderRadius: SETTINGS_RADIUS,
                padding: "12px 10px",
                fontSize: 11,
                color: "var(--text-dim)",
                lineHeight: 1.5,
              }}
            >
              {t("No custom rules yet. The built-in rules below still apply.")}
            </div>
          ) : (
            <RuleList>
              {current.rules.map((entry, index) => (
                <RuleRow
                  key={entry.uid}
                  rule={entry}
                  first={index === 0}
                  error={rowProblem?.index === index ? problemText : null}
                  actions={{
                    onEdit: () => setEditor({ mode: "edit", uid: entry.uid }),
                    onMoveUp: () => setDraft(moveDangerousRule(current, entry.uid, "up")),
                    onMoveDown: () => setDraft(moveDangerousRule(current, entry.uid, "down")),
                    onDelete: () => setDraft(removeDangerousRule(current, entry.uid)),
                    canMoveUp: index > 0,
                    canMoveDown: index < current.rules.length - 1,
                  }}
                />
              ))}
            </RuleList>
          )}
        </div>
      </section>

      <section>
        <div>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            {t("Confirmation timeout")}
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {t(
              "How long a confirmation waits for your answer before the request times out. Between {min} and {max} ms.",
              { min: DANGEROUS_RULE_TIMEOUT_MIN_MS, max: DANGEROUS_RULE_TIMEOUT_MAX_MS },
            )}
          </p>
        </div>

        <div style={{ marginTop: 8, maxWidth: 220 }}>
          <Field label={t("Confirmation timeout (ms)")}>
            <TextInput
              value={timeoutText}
              onChange={changeTimeout}
              invalid={timeoutProblem !== null}
            />
          </Field>
          {timeoutProblem && (
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--error)", lineHeight: 1.5 }}>
              {dangerousRuleProblemText(timeoutProblem, t).message}
            </div>
          )}
        </div>
      </section>

      <section>
        <div>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            {t("Built-in rules")}
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {t(
              "These apply on this platform and cannot be turned off. Clearing your own rules does not turn them off. A match asks for confirmation — it does not block the command.",
            )}
          </p>
        </div>

        <div style={{ marginTop: 8 }}>
          {loading ? (
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("Loading...")}</div>
          ) : error ? (
            <div style={{ fontSize: 11, color: "var(--error)" }}>{error}</div>
          ) : (
            <RuleList>
              {(data?.builtins ?? []).map((rule, index) => (
                <RuleRow key={`${rule.name}-${index}`} rule={rule} first={index === 0} />
              ))}
            </RuleList>
          )}
        </div>
      </section>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <CommandTester />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 8,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
        }}
      >
        <UnsavedHint show={dirty} />
        <SaveButton
          canSave={dirty && problem === null}
          saving={saving}
          saved={savedOk}
          onClick={() => void save()}
        />
      </div>

      {editor && (editor.mode === "new" || editingRule) && (
        <DangerousRuleEditor
          initial={editingRule}
          builtinNames={builtinNames}
          takenRules={current.rules
            .map((entry, index) => ({ name: entry.name, index }))
            .filter((entry) => entry.index !== editingRowIndex)}
          onClose={() => setEditor(null)}
          onSubmit={(rule) => {
            setDraft(
              editingRule
                ? updateDangerousRule(current, editingRule.uid, rule)
                : addDangerousRule(current, rule).draft,
            );
            setEditor(null);
          }}
        />
      )}
    </div>
  );
}
