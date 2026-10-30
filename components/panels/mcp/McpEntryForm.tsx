"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { CollapsiblePanel } from "@/components/ui/CollapsiblePanel";
import { Field, SecondaryButton, SegmentedControl, Select, TextArea, TextInput } from "@/components/settings/controls";
import { isMcpOverride, MCP_EXPOSURES, MCP_SERVER_NAME, mcpUncoveredFields } from "@/lib/shared/mcp-panel";
import type { McpDraftEntry } from "@/lib/shared/mcp-draft";
import {
  exposureOf,
  formatKeyValueLines,
  joinLines,
  parseKeyValueLines,
  parseTimeout,
  splitLines,
  timeoutTextOf,
  transportOf,
} from "./utils";

const STDIO_ONLY_KEYS = ["command", "args", "env", "cwd"];
const HTTP_ONLY_KEYS = ["url", "headers", "oauth"];

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function jsonErrorOf(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function McpEntryForm({
  entry,
  onNameChange,
  onConfigChange,
  onRawJsonChange,
}: {
  entry: McpDraftEntry;
  onNameChange: (name: string) => void;
  onConfigChange: (config: Record<string, unknown>) => void;
  onRawJsonChange: (text: string) => void;
}) {
  const { t } = useI18n();
  const [rawMode, setRawMode] = useState(false);
  const config = entry.config;
  const isOverride = config !== null && entry.scope === "project" && isMcpOverride(config);
  const uncovered = config ? mcpUncoveredFields(config) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label={t("mcp.name")} hint={t("mcp.nameHint")}>
        <TextInput
          value={entry.name}
          onChange={onNameChange}
          mono
          placeholder="filesystem"
          invalid={entry.name.length > 0 && !MCP_SERVER_NAME.test(entry.name)}
        />
      </Field>

      {entry.loadError && (
        <div
          style={{
            fontSize: 12,
            color: "var(--error)",
            background: "color-mix(in srgb, var(--error) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--error) 30%, transparent)",
            borderRadius: 6,
            padding: "8px 10px",
            lineHeight: 1.5,
          }}
        >
          {t("mcp.invalidEntryHint", { error: entry.loadError })}
        </div>
      )}

      {config === null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--error)", lineHeight: 1.5 }}>
            {(() => {
              const syntaxError = jsonErrorOf(entry.rawJson);
              return syntaxError ? t("mcp.rawParseError", { error: syntaxError }) : t("mcp.rawNotObject");
            })()}
          </div>
          <RawJsonEditor value={entry.rawJson} onChange={onRawJsonChange} />
        </div>
      ) : rawMode ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <RawJsonEditor value={entry.rawJson} onChange={onRawJsonChange} />
          <span style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>{t("mcp.rawJsonHint")}</span>
          <div>
            <SecondaryButton onClick={() => setRawMode(false)}>{t("mcp.backToForm")}</SecondaryButton>
          </div>
        </div>
      ) : (
        <>
          {isOverride ? (
            <OverrideFields config={config} onChange={onConfigChange} />
          ) : (
            <McpFormFields config={config} onChange={onConfigChange} />
          )}

          {uncovered.length > 0 && (
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {t("mcp.uncoveredFields", { count: uncovered.length, keys: uncovered.join(", ") })}
            </div>
          )}
          <div>
            <SecondaryButton onClick={() => setRawMode(true)}>{t("mcp.editRawJson")}</SecondaryButton>
          </div>
        </>
      )}
    </div>
  );
}

function RawJsonEditor({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const invalid = jsonErrorOf(value) !== null;
  return (
    <TextArea
      value={value}
      onChange={onChange}
      mono
      invalid={invalid}
      style={{ minHeight: 260, fontSize: 12.5 }}
    />
  );
}

function OverrideFields({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const { t } = useI18n();
  const setKey = (key: string, value: unknown) => {
    const next: Record<string, unknown> = { ...config };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.55,
          color: "var(--text-muted)",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "8px 10px",
        }}
      >
        {t("mcp.overrideEntryHint")}
      </div>
      <Field label={t("mcp.exposure")} hint={t("mcp.exposureHint")}>
        <Select required value={exposureOf(config)} onChange={(value) => setKey("exposure", value)} options={MCP_EXPOSURES} />
      </Field>
    </div>
  );
}

function McpFormFields({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const { t } = useI18n();
  const transport = transportOf(config) === "http" ? "http" : "stdio";
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [argsText, setArgsText] = useState(() =>
    joinLines(Array.isArray(config.args) ? config.args.filter((arg): arg is string => typeof arg === "string") : []),
  );
  const [envText, setEnvText] = useState(() => formatKeyValueLines(stringRecord(config.env)));
  const [headersText, setHeadersText] = useState(() => formatKeyValueLines(stringRecord(config.headers)));
  const [cwdText, setCwdText] = useState(() => (typeof config.cwd === "string" ? config.cwd : ""));
  const [timeoutText, setTimeoutText] = useState(() => timeoutTextOf(config));

  const setKeys = (patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...config };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    onChange(next);
  };

  const switchTransport = (next: "stdio" | "http") => {
    const out: Record<string, unknown> = { ...config };
    delete out.type;
    if (next === "stdio") {
      for (const key of HTTP_ONLY_KEYS) delete out[key];
      if (typeof out.command !== "string") out.command = "";
    } else {
      for (const key of STDIO_ONLY_KEYS) delete out[key];
      if (typeof out.url !== "string") out.url = "";
    }
    onChange(out);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label={t("mcp.transport")}>
        <SegmentedControl
          value={transport}
          ariaLabel={t("mcp.transport")}
          onChange={(next) => switchTransport(next === "http" ? "http" : "stdio")}
          options={[
            { value: "stdio", label: t("mcp.transportStdio") },
            { value: "http", label: t("mcp.transportHttp") },
          ]}
        />
      </Field>

      {transport === "stdio" ? (
        <Field label={t("mcp.command")}>
          <TextInput
            value={typeof config.command === "string" ? config.command : ""}
            onChange={(value) => setKeys({ command: value })}
            mono
            placeholder="npx"
          />
        </Field>
      ) : (
        <Field label={t("mcp.url")}>
          <TextInput
            value={typeof config.url === "string" ? config.url : ""}
            onChange={(value) => setKeys({ url: value })}
            mono
            placeholder="https://example.com/mcp"
          />
        </Field>
      )}

      <div>
        <SecondaryButton onClick={() => setAdvancedOpen((open) => !open)}>
          {advancedOpen ? t("mcp.advancedHide") : t("mcp.advancedShow")}
        </SecondaryButton>
      </div>

      <CollapsiblePanel open={advancedOpen}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 14 }}>
          {transport === "stdio" ? (
            <>
              <Field label={t("mcp.args")} hint={t("mcp.argsHint")}>
                <TextArea
                  value={argsText}
                  onChange={(value) => {
                    setArgsText(value);
                    setKeys({ args: splitLines(value) });
                  }}
                  mono
                  style={{ minHeight: 90 }}
                />
              </Field>
              <Field label={t("mcp.env")} hint={t("mcp.envHint")}>
                <TextArea
                  value={envText}
                  onChange={(value) => {
                    setEnvText(value);
                    setKeys({ env: parseKeyValueLines(value) });
                  }}
                  mono
                  style={{ minHeight: 90 }}
                />
              </Field>
              <Field label={t("mcp.cwd")} hint={t("mcp.cwdHint")}>
                <TextInput
                  value={cwdText}
                  onChange={(value) => {
                    setCwdText(value);
                    setKeys({ cwd: value.trim().length === 0 ? undefined : value });
                  }}
                  mono
                />
              </Field>
            </>
          ) : (
            <Field label={t("mcp.headers")} hint={t("mcp.headersHint")}>
              <TextArea
                value={headersText}
                onChange={(value) => {
                  setHeadersText(value);
                  setKeys({ headers: parseKeyValueLines(value) });
                }}
                mono
                style={{ minHeight: 90 }}
              />
            </Field>
          )}

          <Field label={t("mcp.timeout")} hint={t("mcp.timeoutHint")}>
            <TextInput
              value={timeoutText}
              onChange={(value) => {
                setTimeoutText(value);
                const parsed = parseTimeout(value);
                if (value.trim().length === 0) setKeys({ timeout: undefined });
                else if (parsed !== null) setKeys({ timeout: parsed });
              }}
              invalid={timeoutText.trim().length > 0 && parseTimeout(timeoutText) === null}
              placeholder="60"
            />
          </Field>

          <Field label={t("mcp.exposure")} hint={t("mcp.exposureHint")}>
            <Select required value={exposureOf(config)} onChange={(value) => setKeys({ exposure: value })} options={MCP_EXPOSURES} />
          </Field>

          <Field label={t("mcp.description")} hint={t("mcp.descriptionHint")}>
            <TextInput
              value={typeof config.description === "string" ? config.description : ""}
              onChange={(value) => setKeys({ description: value.trim().length === 0 ? undefined : value })}
            />
          </Field>
        </div>
      </CollapsiblePanel>
    </div>
  );
}
