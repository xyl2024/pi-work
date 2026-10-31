"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/hooks/useI18n";
import { useMarkdownComponents } from "@/components/chat/message-view/utils";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { shortenPath } from "@/lib/client/paths";
import { groupSkillFiles, stripFrontmatter } from "@/lib/shared/skill-files";
import { skillGroup, type SkillDetailData } from "@/lib/shared/skills";
import { fetchSkillDetail } from "@/lib/client/skills-io";
import { skillsPanel, toggleSkillInvocation, useSkillsPanel } from "@/lib/client/skills-panel";
import { SkillFileRow } from "./SkillFileRow";
import { PanelBackButton } from "../PanelBackButton";
import { HumanCallBadge } from "./HumanCallBadge";

export function SkillDetailPage({ filePath }: { filePath: string }) {
  const { t } = useI18n();
  const { view } = useSkillsPanel();
  const { skills, toggleBusy } = view;
  const skill = skills.find((candidate) => candidate.filePath === filePath) ?? null;

  const [detail, setDetail] = useState<SkillDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [toggleError, setToggleError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setLoading(true);
    setLoadError(null);
    setExpandedFiles(new Set());
    setToggleError(null);
    fetchSkillDetail(filePath)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const fileGroups = useMemo(
    () => (detail ? groupSkillFiles(detail.files) : []),
    [detail],
  );
  const totalFiles = detail?.files.filter((file) => !file.isDirectory).length ?? 0;
  const skillBody = detail ? stripFrontmatter(detail.content) : null;
  const markdownComponents = useMarkdownComponents(false);

  const toggleFile = useCallback((relativePath: string) => {
    setExpandedFiles((previous) => {
      const next = new Set(previous);
      if (next.has(relativePath)) next.delete(relativePath);
      else next.add(relativePath);
      return next;
    });
  }, []);

  const frontmatterLocked = skill?.frontmatterDisabled === true;
  const toggleLoading = toggleBusy.includes(filePath);

  const handleToggle = useCallback(
    async (nextEnabled: boolean) => {
      setToggleError(null);
      const result = await toggleSkillInvocation(filePath, !nextEnabled);
      if (!result.ok && result.error) setToggleError(result.error);
    },
    [filePath],
  );

  const toggleNode = skill ? (
    <ToggleSwitch
      on={!skill.disableModelInvocation}
      disabled={toggleLoading || frontmatterLocked}
      onChange={(next) => void handleToggle(next)}
      label={skill.disableModelInvocation ? t("Enable") : t("Disable")}
    />
  ) : null;

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
        <PanelBackButton panel={skillsPanel} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "var(--font-mono)",
            color: "var(--text)",
          }}
          title={skill?.name ?? filePath}
        >
          {skill?.name ?? filePath}
        </span>
        {skill && frontmatterLocked && <HumanCallBadge />}
        {toggleNode && !frontmatterLocked && toggleNode}
      </div>

      <div
        data-scroll-side
        style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 12px 18px" }}
      >
        {skill && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 0 10px" }}>
            <span
              style={{
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 3,
                flexShrink: 0,
                background:
                  skillGroup(skill) === "project"
                    ? "rgba(99,102,241,0.12)"
                    : "rgba(120,120,120,0.12)",
                color:
                  skillGroup(skill) === "project"
                    ? "rgba(99,102,241,0.8)"
                    : "var(--text-dim)",
              }}
            >
              {t(skillGroup(skill))}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-dim)",
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={skill.filePath}
            >
              {shortenPath(skill.filePath)}
            </span>
          </div>
        )}

        {frontmatterLocked && (
          <div
            style={{
              marginBottom: 12,
              fontSize: 12,
              lineHeight: 1.5,
              color: "var(--text-muted)",
              background: "var(--bg-selected)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "8px 10px",
            }}
          >
            {t(
              "This skill sets disable-model-invocation: true in its frontmatter, so pi never lists it in the system prompt. It can still be invoked explicitly via /skill:name.",
            )}
          </div>
        )}

        {toggleError && (
          <div style={{ marginBottom: 12, fontSize: 12, color: "var(--error)", wordBreak: "break-word" }}>
            {toggleError}
          </div>
        )}

        {loading ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("Loading...")}</div>
        ) : loadError ? (
          <div style={{ fontSize: 12, color: "var(--error)", wordBreak: "break-word" }}>{loadError}</div>
        ) : (
          <>
            {skillBody != null && (
              <div
                className="markdown-body"
                style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text)" }}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {skillBody}
                </ReactMarkdown>
              </div>
            )}

            <section style={{ marginTop: 20 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text-dim)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  {t("Source files")}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{totalFiles}</span>
              </div>

              {fileGroups.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("No files")}</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {fileGroups.map((group) => (
                    <div
                      key={group.key}
                      style={{ display: "flex", flexDirection: "column", gap: 4 }}
                    >
                      <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 500 }}>
                        {group.label}
                      </span>
                      <div
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          overflow: "hidden",
                          background: "var(--bg)",
                        }}
                      >
                        {group.files.map((file) => (
                          <SkillFileRow
                            key={file.relativePath}
                            file={file}
                            skillFilePath={filePath}
                            expanded={expandedFiles.has(file.relativePath)}
                            onToggle={() => toggleFile(file.relativePath)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
