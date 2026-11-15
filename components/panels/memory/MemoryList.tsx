"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  createMemoryCategory,
  selectMemoryFile,
  useMemoryPanel,
} from "@/lib/client/memory-panel";

export function MemoryList() {
  const { t } = useI18n();
  const { view } = useMemoryPanel();
  const { loading, loaded, loadError, disabled, files, selectedFile, createError } = view;
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const startCreate = () => {
    setCreating(true);
    setNewName("");
  };

  const submitCreate = () => {
    const name = newName.trim();
    if (name === "") return;
    setCreating(false);
    void createMemoryCategory(name.endsWith(".md") ? name : `${name}.md`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 16px 8px", flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{t("Memory management")}</span>
        {!creating && (
          <button
            type="button"
            onClick={startCreate}
            disabled={!loaded || disabled}
            style={{
              marginLeft: "auto",
              padding: "2px 10px",
              fontSize: 12,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {t("New category")}
          </button>
        )}
      </div>
      {creating && (
        <div style={{ padding: "0 16px 8px", flexShrink: 0 }}>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
              if (e.key === "Escape") setCreating(false);
            }}
            onBlur={() => setCreating(false)}
            placeholder={t("File name")}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "5px 9px",
              fontSize: 12.5,
              fontFamily: "var(--font-mono)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              outline: "none",
            }}
          />
        </div>
      )}
      {createError && (
        <div style={{ padding: "0 16px 8px", fontSize: 12, color: "var(--error)", wordBreak: "break-word", flexShrink: 0 }}>
          {createError}
        </div>
      )}
      <div data-scroll-side style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 8px 18px" }}>
        {loadError ? (
          <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--error)", wordBreak: "break-word" }}>
            {t("Failed to load memory files")}
          </div>
        ) : !loaded ? (
          <Muted>{loading ? t("Loading...") : ""}</Muted>
        ) : files.length === 0 ? (
          <Muted>{t("No memory files yet.")}</Muted>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {files.map((entry) => {
              const selected = entry.file === selectedFile;
              return (
                <button
                  key={entry.file}
                  type="button"
                  onClick={() => selectMemoryFile(entry.file)}
                  aria-pressed={selected}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "7px 9px",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    background: selected ? "var(--bg-selected)" : "none",
                    color: "var(--text)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontFamily: "var(--font-mono)",
                      fontSize: 12.5,
                    }}
                  >
                    {entry.isIndex && (
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: 10,
                          padding: "1px 5px",
                          borderRadius: "var(--radius-xs)",
                          background: "rgba(120,120,120,0.12)",
                          color: "var(--text-dim)",
                        }}
                      >
                        {t("Index")}
                      </span>
                    )}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.file}
                    </span>
                  </span>
                  {entry.description !== "" && (
                    <span
                      style={{
                        display: "block",
                        marginTop: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 11,
                        color: "var(--text-dim)",
                      }}
                    >
                      {entry.description}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-dim)" }}>{children}</div>;
}
