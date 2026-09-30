"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { Field, SegmentedControl, Select, TextArea, TextInput } from "../controls";
import { MCP_EXPOSURES, MCP_SERVER_NAME } from "@/lib/shared/mcp-panel";
import type { McpDraftEntry } from "@/lib/shared/mcp-draft";
import {
  exposureOf,
  formatKeyValueLines,
  isEnabled,
  joinLines,
  parseKeyValueLines,
  parseTimeout,
  splitLines,
  timeoutTextOf,
  transportOf,
} from "./utils";

/**
 * One entry's editor. Two views over the same entry text:
 *
 *   • Form — the fields a server normally needs (transport, command/url, args,
 *     env, headers, timeout, exposure, enabled). Array- and map-shaped fields
 *     are textareas; their text lives in `McpFormFields` so typing stays
 *     natural, and each edit pushes the parsed value up.
 *   • Raw JSON — the entry's own object, for everything the form does not model
 *     (`oauth`, `toolExposure`) and for repairing an entry pi rejects. An entry
 *     that is not a JSON object at all has no form, only this.
 *
 * `config === null` means the text is not a JSON object: the form is unusable
 * until the raw view fixes it, and the panel refuses to save it.
 */

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
  const [mode, setMode] = useState<"form" | "json">("form");
  // Remounting the field group re-reads the config after the raw editor was
  // used, so the form never keeps a draft that is no longer what will be saved.
  const [formEpoch, setFormEpoch] = useState(0);
  const config = entry.config;

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

      <SegmentedControl
        value={mode}
        ariaLabel={t("mcp.rawJson")}
        onChange={(next) => {
          setMode(next === "json" ? "json" : "form");
          if (next === "form") setFormEpoch((epoch) => epoch + 1);
        }}
        options={[
          { value: "form", label: t("mcp.formMode") },
          { value: "json", label: t("mcp.rawJson") },
        ]}
      />

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
      ) : mode === "json" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <RawJsonEditor value={entry.rawJson} onChange={onRawJsonChange} />
          <span style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>{t("mcp.rawJsonHint")}</span>
        </div>
      ) : (
        <McpFormFields key={formEpoch} config={config} onChange={onConfigChange} />
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

function McpFormFields({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const { t } = useI18n();
  const transport = transportOf(config) === "http" ? "http" : "stdio";
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

  // `type` is redundant once one of command / url is present (pi resolves the
  // transport from them), and the abandoned side's keys would otherwise linger.
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
        <>
          <Field label={t("mcp.command")}>
            <TextInput
              value={typeof config.command === "string" ? config.command : ""}
              onChange={(value) => setKeys({ command: value })}
              mono
              placeholder="npx"
            />
          </Field>
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
        <>
          <Field label={t("mcp.url")}>
            <TextInput
              value={typeof config.url === "string" ? config.url : ""}
              onChange={(value) => setKeys({ url: value })}
              mono
              placeholder="https://example.com/mcp"
            />
          </Field>
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
        </>
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

      <Field label={t("mcp.enabled")}>
        <ToggleSwitch
          on={isEnabled(config)}
          onChange={(next) => setKeys({ enabled: next })}
          label={t("mcp.enabled")}
        />
      </Field>
    </div>
  );
}
