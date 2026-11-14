"use client";

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { SearchIcon } from "@/components/ui/icons";
import { filterSkills, groupSkills } from "@/lib/shared/skills";
import {
  openSkillsForm,
  reloadSkills,
  selectSkill,
  setSkillsQuery,
  useSkillsPanel,
} from "@/lib/client/skills-panel";

export function SkillsList() {
  const { t } = useI18n();
  const { view } = useSkillsPanel();
  const { cwd, skills, loading, loaded, loadError, query, selectedFilePath, install } = view;

  const groups = useMemo(() => groupSkills(filterSkills(skills, query)), [skills, query]);
  const searching = query.trim() !== "";
  const installingPackage = install.phase === "running" ? install.request?.package ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 16px 8px", flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{t("Skills")}</span>
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
          {skills.length > 0 ? t("{n} skills", { n: skills.length }) : ""}
        </span>
        <button
          type="button"
          onClick={() => void openSkillsForm()}
          aria-label={t("Add Skill")}
          title={t("Add Skill")}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            padding: 0,
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <PlusGlyph />
        </button>
      </div>

      <div style={{ padding: "0 16px 8px", flexShrink: 0 }}>
        <div style={{ position: "relative" }}>
          <SearchIcon
            width={11}
            height={11}
            style={{
              position: "absolute",
              left: 9,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-dim)",
              pointerEvents: "none",
            }}
          />
          <input
            value={query}
            onChange={(event) => setSkillsQuery(event.target.value)}
            placeholder={t("Search skills...")}
            spellCheck={false}
            style={{
              width: "100%",
              padding: "5px 10px 5px 26px",
              fontSize: 12,
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg)",
              color: "var(--text)",
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>

      <div data-scroll-side style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 8px 18px" }}>
        {installingPackage !== null && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 8px",
              marginBottom: 6,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              fontSize: 12,
              color: "var(--text-muted)",
            }}
            title={installingPackage}
          >
            <span
              style={{
                flexShrink: 0,
                width: 10,
                height: 10,
                borderRadius: "50%",
                border: "2px solid var(--accent)",
                borderTopColor: "transparent",
                animation: "spin 1s linear infinite",
              }}
            />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: "var(--font-mono)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {installingPackage}
            </span>
            <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-dim)" }}>
              {t("Installing...")}
            </span>
          </div>
        )}

        {cwd === null ? (
          <Muted>{t("No skills found")}</Muted>
        ) : loadError ? (
          <div style={{ padding: "10px 8px" }}>
            <div style={{ fontSize: 12, color: "var(--error)", wordBreak: "break-word" }}>
              {t("Failed to load")}
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-dim)", wordBreak: "break-word" }}>
              {loadError}
            </div>
            <button
              type="button"
              onClick={reloadSkills}
              style={{
                marginTop: 10,
                padding: "4px 12px",
                fontSize: 12,
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              {t("Retry")}
            </button>
          </div>
        ) : !loaded ? (
          <Muted>{loading ? t("Loading...") : ""}</Muted>
        ) : groups.length === 0 ? (
          <Muted>{searching ? t("No matches") : t("No skills found")}</Muted>
        ) : (
          groups.map(({ group, skills: groupSkills }) => (
            <section key={group} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 8px 6px" }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text-dim)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  {t(group)}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{groupSkills.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {groupSkills.map((skill) => {
                  const selected = skill.filePath === selectedFilePath;
                  return (
                    <button
                      key={skill.filePath}
                      type="button"
                      onClick={() => selectSkill(skill.filePath)}
                      aria-pressed={selected}
                      title={skill.description || skill.name}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        minWidth: 0,
                        padding: "7px 9px",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        background: selected ? "var(--bg-selected)" : "none",
                        color: "var(--text)",
                        cursor: "pointer",
                        textAlign: "left",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12.5,
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: skill.disableModelInvocation ? "var(--text-dim)" : "var(--text)",
                        }}
                      >
                        {skill.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function PlusGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-dim)" }}>{children}</div>;
}
