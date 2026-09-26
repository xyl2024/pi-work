"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/hooks/useI18n";
import { useTextSelection } from "@/hooks/useTextSelection";
import { useMarkdownComponents } from "@/components/chat/message-view/utils";
import { TextSelectionToolbar } from "@/components/chat/text-selection-toolbar";
import { sourceLabel, shortenPath, stripFrontmatter, FILE_GROUP_LABELS } from "./utils";
import type { Skill, SkillDetailData, SkillDetailFile } from "./types";
import { SubFileRow } from "./SubFileRow";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";

/**
 * Detail page for one skill. Owns:
 *   • the per-skill detail fetch (content + files manifest) on mount / skill change
 *   • the expansion-set for sub-file rows
 *   • grouping of `detail.files` into known top-level directories
 *     (scripts / references / assets, in that order, then "Other files")
 *
 * Layout: the header (path / tag / toggle) and the rendered SKILL.md come
 * first; below them sits the "Metadata" section — name / description / path
 * plus a browseable tree of every source file that ships with the skill.
 *
 * Stateless across selections — every prop change mounts a fresh component
 * (the parent uses `key={selectedSkill.filePath}` to force a remount).
 */
export function SkillDetail({
  skill,
  cwd,
  onToggleInvocation,
}: {
  skill: Skill;
  cwd: string;
  onToggleInvocation: (disableModelInvocation: boolean) => Promise<void>;
}) {
  const { t } = useI18n();
  const label = sourceLabel(skill);
  const markdownComponents = useMarkdownComponents(false);
  // Text selection scoped to the detail content, so the user can select an
  // English phrase in the rendered SKILL.md and translate it inline. The
  // floating toolbar is portaled to <body> because the modal panel carries a
  // `transform` + `overflow:hidden`, which would otherwise clip / mis-anchor
  // a position:fixed toolbar rendered inside it.
  const contentRef = useRef<HTMLDivElement>(null);
  const selection = useTextSelection(contentRef);
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => setPortalReady(true), []);
  // SKILL.md frontmatter `disable-model-invocation: true` — pi excludes the
  // skill from the system prompt and Pi Work's toggle cannot override it.
  const frontmatterLocked = skill.frontmatterDisabled === true;

  // ── Detail data fetching ──
  const [detail, setDetail] = useState<SkillDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  useEffect(() => {
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    setExpandedFiles(new Set());
    fetch(
      `/api/skills/detail?filePath=${encodeURIComponent(skill.filePath)}`,
    )
      .then((r) => r.json())
      .then((d: SkillDetailData & { error?: string }) => {
        if (d.error) {
          setDetailError(d.error);
          return;
        }
        setDetail(d);
      })
      .catch((e) => setDetailError(String(e)))
      .finally(() => setDetailLoading(false));
  }, [skill.filePath]);

  const toggleFile = useCallback((relPath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  }, []);

  function displayPath(p: string): string {
    if (label === "project" && p.startsWith(cwd)) {
      const rel = p.slice(cwd.length).replace(/^[/\\]/, "");
      return `./${rel}`;
    }
    return shortenPath(p);
  }

  // ── Group files by top-level directory ──
  const fileGroups = useCallback(() => {
    if (!detail) return [] as { label: string; dirName: string; files: SkillDetailFile[] }[];

    const dirs: { label: string; dirName: string; files: SkillDetailFile[] }[] = [];
    const rootFiles: SkillDetailFile[] = [];

    // The main SKILL.md gets its own first group so its raw source is viewable.
    const skillMd = detail.files.find(
      (f) => !f.isDirectory && f.name === "SKILL.md" && !f.relativePath.includes("/"),
    );
    if (skillMd) dirs.push({ label: "SKILL.md", dirName: "__skillmd", files: [skillMd] });

    // Collect top-level directories
    const topDirs = detail.files.filter((f) => f.isDirectory && !f.relativePath.includes("/"));

    // Collect children for each dir
    for (const dir of topDirs) {
      const prefix = dir.relativePath + "/";
      const children = detail.files.filter(
        (f) => !f.isDirectory && f.relativePath.startsWith(prefix),
      );
      if (children.length > 0) {
        const customLabel = FILE_GROUP_LABELS[dir.name] ?? dir.name;
        dirs.push({ label: customLabel, dirName: dir.name, files: children.sort((a, b) => a.name.localeCompare(b.name)) });
      }
    }

    // Collect root-level files (excluding SKILL.md itself)
    for (const f of detail.files) {
      if (!f.isDirectory && !f.relativePath.includes("/") && f.name !== "SKILL.md") {
        rootFiles.push(f);
      }
    }

    // Sort dirs so known groups come first, then alphabetical (SKILL.md pinned first)
    const knownOrder = ["scripts", "references", "assets"];
    dirs.sort((a, b) => {
      if (a.dirName === "__skillmd") return -1;
      if (b.dirName === "__skillmd") return 1;
      const ai = knownOrder.indexOf(a.dirName);
      const bi = knownOrder.indexOf(b.dirName);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.dirName.localeCompare(b.dirName);
    });

    if (rootFiles.length > 0) {
      dirs.push({
        label: "Other files",
        dirName: "other",
        files: rootFiles.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    return dirs;
  }, [detail])();

  const skillContent = detail?.content ?? null;
  const skillBody = skillContent != null ? stripFrontmatter(skillContent) : null;
  const totalFiles = detail?.files.filter((f) => !f.isDirectory).length ?? 0;

  const sectionTitle = (children: ReactNode) => (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: "var(--text-dim)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );

  const metaRow = (labelText: string, value: ReactNode, mono = false) => (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        padding: "9px 0",
        borderTop: "1px solid var(--border)",
      }}
    >
      <span
        style={{
          width: 96,
          flexShrink: 0,
          fontSize: 12,
          color: "var(--text-muted)",
          paddingTop: 1,
        }}
      >
        {labelText}
      </span>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: mono ? 12.5 : 13,
          lineHeight: 1.6,
          color: "var(--text)",
          fontFamily: mono ? "var(--font-mono)" : undefined,
          wordBreak: "break-word",
        }}
      >
        {value}
      </div>
    </div>
  );

  return (
    <div ref={contentRef} style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {/* Path + tag + toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          style={{
            fontSize: 10,
            padding: "1px 5px",
            borderRadius: 3,
            flexShrink: 0,
            background:
              label === "project"
                ? "rgba(99,102,241,0.12)"
                : "rgba(120,120,120,0.12)",
            color:
              label === "project" ? "rgba(99,102,241,0.8)" : "var(--text-dim)",
          }}
        >
          {t(label)}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-dim)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayPath(skill.filePath)}
        </span>
        <span title={
          frontmatterLocked
            ? t("Locked by SKILL.md frontmatter (disable-model-invocation)")
            : skill.disableModelInvocation ? t("Enable") : t("Disable")
        }>
          <ToggleSwitch
            on={!skill.disableModelInvocation}
            disabled={toggleLoading || frontmatterLocked}
            onChange={(next) => {
              void (async () => {
                if (frontmatterLocked) return;
                setToggleLoading(true);
                setDetailError(null);
                try {
                  await onToggleInvocation(!next);
                } catch (error) {
                  setDetailError(String(error));
                } finally {
                  setToggleLoading(false);
                }
              })();
            }}
            label={skill.disableModelInvocation ? t("Enable") : t("Disable")}
          />
        </span>
      </div>

      {frontmatterLocked && (
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--text-muted)",
            background: "var(--bg-selected)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "8px 10px",
          }}
        >
          {t("This skill sets disable-model-invocation: true in its frontmatter, so pi never lists it in the system prompt. It can still be invoked explicitly via /skill:name.")}
        </div>
      )}

      {/* ── Rendered SKILL.md ── */}
      {detailLoading && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t("Loading...")}
        </div>
      )}
      {detailError && (
        <div style={{ fontSize: 12, color: "var(--error)" }}>{detailError}</div>
      )}
      {skillBody != null && (
        <div
          className="markdown-body"
          style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--text)" }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {skillBody}
          </ReactMarkdown>
        </div>
      )}

      {/* ── Metadata + source files ── */}
      <section>
        {sectionTitle(t("Metadata"))}
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "2px 14px 14px",
            background: "var(--bg-panel)",
          }}
        >
          {metaRow(t("Name"), skill.name, true)}
          {metaRow(t("Description"), skill.description || t("No description"))}

          <div style={{ borderTop: "1px solid var(--border)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 0 8px",
              }}
            >
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {t("Source files")}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                {totalFiles}
              </span>
            </div>

            {detailLoading ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {t("Loading...")}
              </div>
            ) : fileGroups.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                {t("No files")}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {fileGroups.map((group) => (
                  <div
                    key={group.dirName}
                    style={{ display: "flex", flexDirection: "column", gap: 4 }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--text-dim)",
                        fontWeight: 500,
                      }}
                    >
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
                        <SubFileRow
                          key={file.relativePath}
                          file={file}
                          skillFilePath={skill.filePath}
                          expanded={expandedFiles.has(file.relativePath)}
                          onToggle={() => toggleFile(file.relativePath)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Floating selection toolbar (translate / copy) for the rendered
          content. Portaled to <body> so the modal's transform + overflow:hidden
          cannot clip or mis-anchor it; the translate bubble itself is mounted
          once at the app root (AppShell). */}
      {portalReady &&
        createPortal(
          <TextSelectionToolbar
            state={selection}
            onHide={selection.hide}
            actions={["translate", "copy"]}
          />,
          document.body,
        )}
    </div>
  );
}
