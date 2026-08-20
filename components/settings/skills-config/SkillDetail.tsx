"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { sourceLabel, shortenPath, FILE_GROUP_LABELS } from "./utils";
import type { Skill, SkillDetailData, SkillDetailFile } from "./types";
import { SubFileRow } from "./SubFileRow";

/**
 * Right-pane detail view for one skill. Owns:
 *   • the per-skill detail fetch (content + files manifest) on mount / skill change
 *   • the expansion-set for sub-file rows
 *   • grouping of `detail.files` into known top-level directories
 *     (scripts / references / assets, in that order, then "Other files")
 *
 * Stateless across selections — every prop change mounts a fresh component
 * (the parent uses `key={selectedSkill.filePath}` to force a remount).
 */
export function SkillDetail({
  skill,
  cwd,
}: {
  skill: Skill;
  cwd: string;
}) {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const label = sourceLabel(skill);

  // ── Detail data fetching ──
  const [detail, setDetail] = useState<SkillDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
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

    // Sort dirs so known groups come first, then alphabetical
    const knownOrder = ["scripts", "references", "assets"];
    dirs.sort((a, b) => {
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span
          style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}
        >
          {t("Name")}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 14,
            color: "var(--text)",
          }}
        >
          {skill.name}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span
          style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}
        >
          {t("Description")}
        </span>
        <span
          style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}
        >
          {skill.description}
        </span>
      </div>

      {/* ── SKILL.md content preview ── */}
      {detailLoading && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t("Loading...")}
        </div>
      )}
      {detailError && (
        <div style={{ fontSize: 12, color: "#f87171" }}>{detailError}</div>
      )}
      {skillContent != null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span
            style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}
          >
            SKILL.md
          </span>
          <SyntaxHighlighter
            language="markdown"
            style={isDark ? vscDarkPlus : vs}
            customStyle={{
              height: 280,
              overflow: "auto",
              margin: 0,
              padding: 12,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              fontSize: 12,
              lineHeight: 1.55,
              fontFamily: "var(--font-mono)",
            }}
            codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
          >
            {skillContent}
          </SyntaxHighlighter>
        </div>
      )}

      {/* ── Sub-file sections ── */}
      {fileGroups.map((group) => (
        <div key={group.dirName} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span
            style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}
          >
            {group.label}
          </span>
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              overflow: "hidden",
              background: "var(--bg-panel)",
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
  );
}
