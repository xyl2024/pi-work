"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SettingsPageDataCache } from "@/lib/client/settings-page-cache";
import type {
  DangerousCommandVerdict,
  DangerousRuleSetSnapshot,
} from "@/lib/shared/dangerous-commands";
import type { DangerousPatternRule } from "@/lib/shared/config-types";
import { PrimaryButton, SETTINGS_RADIUS, inputStyle } from "../controls";
import { useSettingsPageData } from "../use-page-data";

/** One read of the effective set; the modal's page-data cache keeps it for the modal's lifetime. */
async function loadRuleSet(): Promise<DangerousRuleSetSnapshot> {
  const response = await fetch("/api/dangerous-commands", { cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as DangerousRuleSetSnapshot & {
    error?: string;
  };
  if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

/** "If this command ran, what would happen?" — answered by the server. */
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

const ROW_STYLE = {
  display: "flex",
  alignItems: "baseline",
  gap: 10,
  padding: "7px 10px",
  borderTop: "1px solid var(--border)",
} as const;

/**
 * One built-in rule, read-only: the name the confirmation dialog shows, the
 * pattern as written (monospace, truncated — a long regex must not widen the
 * modal) and whether it ignores case.
 */
function RuleRow({ rule, first }: { rule: DangerousPatternRule; first: boolean }) {
  const { t } = useI18n();
  return (
    <div style={first ? { ...ROW_STYLE, borderTop: "none" } : ROW_STYLE}>
      <span
        title={rule.name}
        style={{
          flexShrink: 0,
          maxWidth: 180,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 12,
          color: "var(--text)",
        }}
      >
        {rule.name}
      </span>
      <code
        title={rule.pattern}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-muted)",
        }}
      >
        {rule.pattern}
      </code>
      <span style={{ flexShrink: 0, fontSize: 10, color: "var(--text-dim)" }}>
        {rule.ignoreCase ? t("Ignore case") : t("Case-sensitive")}
      </span>
    </div>
  );
}

/**
 * The three outcomes, told apart on sight: a hard block is red and says it
 * cannot be configured here, a rule match says a confirmation would appear and
 * which layer the rule came from, no match says the command would just run.
 * Sharing one neutral card between the first two would read as "both blocked".
 */
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

/**
 * "Try a command" — the page-level box, deliberately not inside a rule editor:
 * the question it answers ("would this command be stopped?") depends on the
 * whole rule set in force, plus the self-protection layer no rule describes.
 *
 * The judgement is the server's (`POST /api/dangerous-commands/test` →
 * `evaluateDangerousCommand`), the same call the `tool_call` gate makes, so a
 * command cannot read as fine here and behave differently in a session.
 */
function CommandTester() {
  const { t } = useI18n();
  const [command, setCommand] = useState("");
  const [verdict, setVerdict] = useState<DangerousCommandVerdict | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the latest test may touch the result; an earlier response arriving
  // late must not overwrite a newer answer.
  const latestRequest = useRef(0);

  const run = async () => {
    const id = ++latestRequest.current;
    setError(null);
    // An empty command has nothing to match, so it is answered without a
    // request — and without pretending the server looked at it.
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

/**
 * Settings → Agent → Dangerous commands (ADR-0020).
 *
 * The page makes the confirmation gate visible without turning it into a
 * switch. What it lists is the platform's **built-in** floor, read from
 * `/api/dangerous-commands` — the same effective set the gate assembles, not a
 * client-side copy — so the Windows-only PowerShell rules appear on Windows
 * and stay out of the way everywhere else.
 *
 * Two boundaries the page must state, because both are easy to misread:
 * clearing the user's own rules does not turn the built-ins off, and a match is
 * a confirmation prompt, not a block.
 *
 * Self-protection (the code-level hard block in `lib/server/self-protection.ts`)
 * deliberately does not appear as a list: anything listed on a settings page
 * reads as configurable, and that one is not. It surfaces only in the command
 * tester's result, where it is the answer to "why was this stopped?".
 */
export function DangerousCommandsSection({ pageCache }: { pageCache: SettingsPageDataCache }) {
  const { t } = useI18n();
  const { data, loading, error } = useSettingsPageData(
    pageCache,
    "dangerous-commands",
    loadRuleSet,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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

        {loading ? (
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("Loading...")}</div>
        ) : error ? (
          <div style={{ fontSize: 11, color: "var(--error)" }}>{error}</div>
        ) : (
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: SETTINGS_RADIUS,
              overflow: "hidden",
              background: "var(--bg)",
            }}
          >
            {(data?.builtins ?? []).map((rule, index) => (
              <RuleRow key={`${rule.name}-${index}`} rule={rule} first={index === 0} />
            ))}
          </div>
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <CommandTester />
      </div>
    </div>
  );
}
