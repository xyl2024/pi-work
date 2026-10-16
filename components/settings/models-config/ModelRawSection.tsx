"use client";

import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "../../ui/Tooltip";
import { SectionTitle } from "./form-fields";

/**
 * The raw-JSON view of a model: the serialized entry to read or copy, and a
 * textarea to edit it. Purely presentational — the owner decides what `draft`
 * means (the panel keeps it in the store) and translates `error` before passing
 * it in.
 */
export function ModelRawSection({
  summaryJson,
  editing,
  draft,
  error,
  onEnterEdit,
  onDraftChange,
  onCancel,
  onApply,
  onCopy,
}: {
  summaryJson: string;
  editing: boolean;
  draft: string;
  error: string | null;
  onEnterEdit: () => void;
  onDraftChange: (text: string) => void;
  onCancel: () => void;
  onApply: () => void;
  onCopy: () => void;
}) {
  const { t } = useI18n();

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <SectionTitle>{t("Raw metadata")}</SectionTitle>
        <div style={{ display: "flex", gap: 6 }}>
          {!editing && (
            <>
              <Tooltip content={t("Copy raw JSON")}>
                <button
                  type="button"
                  onClick={onCopy}
                  aria-label={t("Copy raw JSON")}
                  style={{ padding: "3px 7px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  {t("Copy")}
                </button>
              </Tooltip>
              <button
                type="button"
                onClick={onEnterEdit}
                style={{ padding: "3px 7px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
              >
                {t("Edit as JSON")}
              </button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            spellCheck={false}
            style={{
              padding: "6px 9px",
              background: "var(--bg)",
              border: `1px solid ${error ? "var(--error)" : "var(--border)"}`,
              borderRadius: 5,
              color: "var(--text)",
              width: "100%",
              boxSizing: "border-box",
              minHeight: 220,
              maxHeight: 420,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              lineHeight: 1.45,
              resize: "vertical",
              whiteSpace: "pre",
            }}
          />
          {error && (
            <div style={{ fontSize: 11, color: "var(--error)", padding: "5px 8px", background: "color-mix(in srgb, var(--error) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--error) 25%, transparent)", borderRadius: 4 }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onCancel}
              style={{ padding: "4px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              onClick={onApply}
              style={{ padding: "4px 12px", background: "var(--accent)", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
            >
              {t("Apply raw JSON")}
            </button>
          </div>
        </div>
      ) : (
        <details>
          <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: 11 }}>{t("Raw metadata")}</summary>
          <pre style={{ margin: "6px 0 0", padding: 8, maxHeight: 280, overflow: "auto", borderRadius: 4, background: "var(--bg)", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {summaryJson}
          </pre>
        </details>
      )}
      <div style={{ marginTop: 6, fontSize: 10, color: "var(--text-dim)", lineHeight: 1.5 }}>
        {t("Raw metadata hint")}
      </div>
    </div>
  );
}
