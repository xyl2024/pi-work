"use client";

import { useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ArrowLeftIcon, SearchIcon } from "@/components/ui/icons";
import { filterComposerSkills } from "@/lib/client/composer-picker";
import { useComposerPicker } from "./useComposerPicker";
import { isInteractiveKeyboardTarget } from "./keyboard-target";
import { resolvePickerKeyAction, type PickerKeyRegion } from "@/lib/client/picker-keyboard";
import type { ComposerPickerViewProps } from "./types";

export function SkillPickerView({
  picker,
  close,
  slashResources,
  onSelectSkill,
  onOpenSkillsPanel,
}: ComposerPickerViewProps) {
  const { t } = useI18n();
  const snapshot = useComposerPicker(picker);
  const query = snapshot.skillQuery;
  const skills = useMemo(() => filterComposerSkills(slashResources, query), [slashResources, query]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeIndex = Math.min(snapshot.activeIndex, Math.max(0, skills.length - 1));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const row = listRef.current?.querySelector(`[data-skill-index="${activeIndex}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const selectSkill = () => {
    const skill = picker.selectSkill(slashResources);
    if (!skill) return;
    onSelectSkill(skill);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    const isRow = target instanceof HTMLElement && target.closest("[data-picker-nav-row]") !== null;
    const region: PickerKeyRegion = isRow
      ? "navigation"
      : target instanceof HTMLInputElement
        ? "navigation"
        : isInteractiveKeyboardTarget(target)
          ? "control"
          : "navigation";
    const action = resolvePickerKeyAction({
      key: event.key,
      region,
      view: "skill",
      composing: event.nativeEvent.isComposing,
    });
    if (action === "native" || action === "back") return;
    event.preventDefault();
    if (action === "move-previous" || action === "move-next") {
      picker.moveActive(action === "move-next" ? 1 : -1, skills.length);
      if (isRow) {
        listRef.current
          ?.querySelector<HTMLElement>(`[data-skill-index="${picker.get().activeIndex}"]`)
          ?.focus();
      }
      return;
    }
    if (action === "activate") selectSkill();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", padding: "4px" }} onKeyDown={handleKeyDown}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 4px 8px" }}>
        <BackButton onClick={() => picker.back()} label={t("Back")} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{t("Choose skill")}</span>
      </div>

      <div style={{ position: "relative", padding: "0 4px 6px" }}>
        <SearchIcon
          width={11}
          height={11}
          style={{
            position: "absolute",
            left: 13,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--text-dim)",
            pointerEvents: "none",
          }}
        />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => picker.setSkillQuery(event.target.value)}
          placeholder={t("Search skills...")}
          aria-label={t("Search skills...")}
          spellCheck={false}
          style={{
            width: "100%",
            padding: "6px 10px 6px 28px",
            fontSize: 12,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg)",
            color: "var(--text)",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />
      </div>

      {slashResources.length === 0 ? (
        <div style={{ padding: "14px 8px 10px", textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("No skills found")}</div>
          <button
            type="button"
            onClick={() => {
              close();
              onOpenSkillsPanel?.();
            }}
            style={{
              marginTop: 8,
              padding: "4px 12px",
              fontSize: 12,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {t("Manage skills")}
          </button>
        </div>
      ) : skills.length === 0 ? (
        <div style={{ padding: "16px 8px", fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
          {t("No matches")}
        </div>
      ) : (
        <div
          ref={listRef}
          role="listbox"
          aria-label={t("Choose skill")}
          style={{ display: "flex", flexDirection: "column", maxHeight: 240, overflowY: "auto", paddingBottom: 2 }}
        >
          {skills.map((skill, index) => (
            <button
              key={skill.path || skill.name}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              data-picker-nav-row
              data-skill-index={index}
              onMouseEnter={() => picker.setActiveIndex(index, skills.length)}
              onFocus={() => picker.setActiveIndex(index, skills.length)}
              onClick={() => {
                picker.setActiveIndex(index, skills.length);
                selectSkill();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                width: "100%",
                padding: "7px 8px",
                background: index === activeIndex ? "var(--bg-selected)" : "none",
                border: "none",
                borderRadius: 7,
                color: index === activeIndex ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.12s, color 0.12s",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 20,
                  height: 20,
                  flexShrink: 0,
                  borderRadius: 5,
                  background: "var(--bg-hover)",
                  color: "var(--accent)",
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                }}
              >
                {skill.name.slice(0, 1)}
              </span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {skill.name}
                </span>
                {skill.description && (
                  <span style={{ fontSize: 11, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {skill.description}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        padding: 0,
        background: "none",
        border: "none",
        borderRadius: 5,
        color: "var(--text-muted)",
        cursor: "pointer",
      }}
    >
      <ArrowLeftIcon size={14} strokeWidth={1.8} />
    </button>
  );
}
