"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useToast } from "@/components/ui/Toast";
import { shortenPath, sourceLabel } from "./skills-config/utils";
import { SkillDetail } from "./skills-config/SkillDetail";
import { AddSkillPanel } from "./skills-config/AddSkillPanel";
import { SkillCard } from "./skills-config/SkillCard";
import type { Skill } from "./skills-config/types";

/**
 * Modal for browsing / installing / inspecting skills.
 *
 * Layout
 * ──────
 *   • Overview — every skill as a card in a grid grouped by `sourceLabel`
 *     (`project` / `global` / `path`). Each card shows the skill's
 *     initial-letter avatar, name, description and an inline enable/disable
 *     toggle. Clicking a card opens its detail page.
 *   • Detail    — `SkillDetail` (SKILL.md + files) for the clicked skill,
 *     with a back button returning to the grid.
 *   • Add       — the "Add Skill" toolbar button swaps the body for
 *     `AddSkillPanel`, also with a back button.
 *
 * The detailed sub-views (SkillCard, SubFileRow, SkillDetail, AddSkillPanel)
 * and the shared types / utilities live alongside under `./skills-config/`.
 * This file holds only the modal chrome and the view-selection state machine.
 */
export function SkillsConfig({
  cwd,
  onClose,
}: {
  cwd: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const { requestClose, backdropStyle, panelStyle } = useModalAnimation({
    isOpen: true,
    onClose,
  });
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [toggleBusy, setToggleBusy] = useState<Set<string>>(new Set());

  const loadSkills = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`)
      .then((r) => r.json())
      .then((d: { skills?: Skill[]; error?: string }) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        setSkills(d.skills ?? []);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [cwd]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const selectedSkill = skills.find((s) => s.filePath === selected) ?? null;

  const setBusy = useCallback((filePath: string, busy: boolean) => {
    setToggleBusy((prev) => {
      const next = new Set(prev);
      if (busy) next.add(filePath);
      else next.delete(filePath);
      return next;
    });
  }, []);

  const toggleSkillInvocation = useCallback(async (filePath: string, disableModelInvocation: boolean) => {
    const response = await fetch("/api/skills", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, filePath, disableModelInvocation }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    setSkills((current) => current.map((skill) =>
      skill.filePath === filePath ? { ...skill, disableModelInvocation } : skill,
    ));
  }, [cwd]);

  // Card toggle — surfaces errors as a toast instead of throwing into the grid.
  const handleCardToggle = useCallback(
    async (filePath: string, disableModelInvocation: boolean) => {
      setBusy(filePath, true);
      try {
        await toggleSkillInvocation(filePath, disableModelInvocation);
      } catch (e) {
        toast.show({ kind: "error", message: String(e) });
      } finally {
        setBusy(filePath, false);
      }
    },
    [toggleSkillInvocation, toast, setBusy],
  );

  const groups = (() => {
    const result: { label: string; skills: Skill[] }[] = [];
    for (const grpLabel of ["pi-work", "project", "global", "path"] as const) {
      const grpSkills = skills.filter((s) => sourceLabel(s) === grpLabel);
      if (grpSkills.length > 0) result.push({ label: grpLabel, skills: grpSkills });
    }
    return result;
  })();

  const BackHeader = ({ label, onClick }: { label: string; onClick: () => void }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 18px 12px",
        flexShrink: 0,
      }}
    >
      <button
        onClick={onClick}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          padding: 0,
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
        {t("Skills")}
      </button>
      <span style={{ color: "var(--text-dim)", fontSize: 12 }}>/</span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </div>
  );

  const scrollBody = (children: React.ReactNode) => (
    <div data-scroll-wide style={{ flex: 1, overflowY: "auto", padding: "0 18px 18px" }}>
      {children}
    </div>
  );

  return (
    <div
      style={backdropStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        style={{
          ...panelStyle,
          width: 860,
          height: "78vh",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 18px",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            <span
              style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}
            >
              {t("Skills")}
            </span>
            <code
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                maxWidth: 320,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {shortenPath(cwd)}
            </code>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => {
                setAddMode(true);
                setSelected(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 12px",
                fontSize: 12.5,
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: addMode ? "var(--bg-selected)" : "none",
                color: addMode ? "var(--accent)" : "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              <svg
                width="13"
                height="13"
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
            <button
              onClick={requestClose}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 20,
                lineHeight: 1,
                padding: "2px 6px",
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        {addMode ? (
          <>
            <BackHeader label={t("Add Skill")} onClick={() => setAddMode(false)} />
            {scrollBody(<AddSkillPanel cwd={cwd} onInstalled={loadSkills} />)}
          </>
        ) : selectedSkill ? (
          <>
            <BackHeader
              label={selectedSkill.name}
              onClick={() => setSelected(null)}
            />
            {scrollBody(
              <SkillDetail
                key={selectedSkill.filePath}
                skill={selectedSkill}
                cwd={cwd}
                onToggleInvocation={(disableModelInvocation) =>
                  toggleSkillInvocation(selectedSkill.filePath, disableModelInvocation)
                }
              />,
            )}
          </>
        ) : (
          <div data-scroll-wide style={{ flex: 1, overflowY: "auto", padding: "2px 18px 18px" }}>
            {loading ? (
              <div style={{ padding: "10px 2px", fontSize: 12, color: "var(--text-muted)" }}>
                {t("Loading...")}
              </div>
            ) : error ? (
              <div style={{ padding: "10px 2px", fontSize: 12, color: "var(--error)" }}>
                {error}
              </div>
            ) : skills.length === 0 ? (
              <div style={{ padding: "10px 2px", fontSize: 12, color: "var(--text-dim)" }}>
                {t("No skills found")}
              </div>
            ) : (
              groups.map(({ label, skills: grpSkills }) => (
                <section key={label} style={{ marginBottom: 24 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "2px 2px 10px",
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
                      {t(label)}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                      {grpSkills.length}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
                      gap: 12,
                    }}
                  >
                    {grpSkills.map((skill) => (
                      <SkillCard
                        key={skill.filePath}
                        skill={skill}
                        toggleLoading={toggleBusy.has(skill.filePath)}
                        onOpen={() => setSelected(skill.filePath)}
                        onToggle={(disableModelInvocation) =>
                          void handleCardToggle(skill.filePath, disableModelInvocation)
                        }
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "10px 18px",
            flexShrink: 0,
          }}
        >
          <button
            onClick={requestClose}
            style={{
              padding: "6px 14px",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {t("Close")}
          </button>
        </div>
      </div>
    </div>
  );
}
