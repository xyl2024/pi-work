"use client";

import { useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { shortenPath } from "@/lib/client/paths";
import { groupSkills } from "@/lib/shared/skills";
import {
  openSkillsAdd,
  openSkillsDetail,
  reloadSkills,
  toggleSkillInvocation,
  useSkillsStore,
} from "@/lib/client/skills-store";
import { SkillCard } from "./SkillCard";

export function SkillsRootPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { cwd, skills, loading, loaded, loadError, toggleBusy } = useSkillsStore();

  const groups = groupSkills(skills);

  const handleToggle = useCallback(
    async (filePath: string, disableModelInvocation: boolean) => {
      const result = await toggleSkillInvocation(filePath, disableModelInvocation);
      if (!result.ok && result.error) toast.show({ kind: "error", message: result.error });
    },
    [toast],
  );

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 12px 8px",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>
          {t("Skills")}
        </span>
        {cwd && (
          <code
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 11,
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={cwd}
          >
            {shortenPath(cwd)}
          </code>
        )}
        <button
          type="button"
          onClick={openSkillsAdd}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t("Add Skill")}
        </button>
      </div>

      <div
        data-scroll-side
        style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 12px 18px" }}
      >
        {cwd === null ? (
          <Muted>{t("No skills found")}</Muted>
        ) : loadError ? (
          <div style={{ padding: "10px 2px" }}>
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
                borderRadius: 6,
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
          <Muted>{t("No skills found")}</Muted>
        ) : (
          groups.map(({ group, skills: groupSkills }) => (
            <section key={group} style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 2px 8px" }}>
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
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                  gap: 10,
                }}
              >
                {groupSkills.map((skill) => (
                  <SkillCard
                    key={skill.filePath}
                    skill={skill}
                    toggleLoading={toggleBusy.includes(skill.filePath)}
                    onOpen={() => openSkillsDetail(skill.filePath)}
                    onToggle={(disableModelInvocation) => void handleToggle(skill.filePath, disableModelInvocation)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "10px 2px", fontSize: 12, color: "var(--text-dim)" }}>{children}</div>;
}
