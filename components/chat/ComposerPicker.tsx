"use client";

import { useCallback, useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AnimatedPopover } from "../ui/AnimatedPopover";
import { ICONS } from "../ui/icons";
import { FilePickerView } from "./composer-picker/FilePickerView";
import { SkillPickerView } from "./composer-picker/SkillPickerView";
import { chatInputMetrics } from "./chat-input/metrics";
import type { SlashResource } from "@/lib/shared/slash-commands";
import {
  COMPOSER_PICKER_ITEMS,
  type ComposerPicker,
  type ComposerPickerAction,
} from "@/lib/client/composer-picker";

const MAIN_WIDTH = 280;
const SECONDARY_WIDTH = 320;
const MAX_HEIGHT = 360;

const LABEL_KEYS: Record<ComposerPickerAction, string> = {
  image: "Upload image",
  skill: "Choose skill",
  file: "Reference file",
};

export function ComposerPicker({
  picker,
  onPickImage,
  cwd = null,
  slashResources = [],
  onSelectSkill = () => undefined,
  onInsertText = () => undefined,
  onOpenSkillsPanel,
}: {
  picker: ComposerPicker;
  onPickImage: () => void;
  cwd?: string | null;
  slashResources?: SlashResource[];
  onSelectSkill?: (resource: SlashResource) => void;
  onInsertText?: (text: string) => void;
  onOpenSkillsPanel?: () => void;
}) {
  const { t } = useI18n();
  const snapshot = picker.useSnapshot();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const activateItem = useCallback((index: number) => {
    const result = picker.activate(index);
    if (result?.action === "image") onPickImage();
  }, [onPickImage, picker]);

  useEffect(() => {
    if (!snapshot.open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      picker.close();
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [picker, snapshot.open]);

  useEffect(() => {
    if (!snapshot.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        const result = picker.back();
        if (result.closed) triggerRef.current?.focus();
        return;
      }
      if (snapshot.view !== "main") return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        picker.moveActive(event.key === "ArrowDown" ? 1 : -1, COMPOSER_PICKER_ITEMS.length);
        return;
      }
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        activateItem(snapshot.activeIndex);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activateItem, picker, snapshot.activeIndex, snapshot.open, snapshot.view]);

  return (
    <div ref={containerRef} style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => picker.toggle()}
        aria-label={t("Add context")}
        aria-haspopup="menu"
        aria-expanded={snapshot.open}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: chatInputMetrics.toolbarButton, height: chatInputMetrics.toolbarButton, padding: 0, flexShrink: 0,
          background: snapshot.open ? "var(--bg-hover)" : "none",
          border: "none",
          borderRadius: "50%",
          color: snapshot.open ? "var(--text)" : "var(--text-muted)",
          cursor: "pointer",
          transition: "background 0.12s, color 0.12s",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = "var(--bg-hover)";
          event.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = snapshot.open ? "var(--bg-hover)" : "none";
          event.currentTarget.style.color = snapshot.open ? "var(--text)" : "var(--text-muted)";
        }}
      >
        <svg width={chatInputMetrics.toolbarIcon} height={chatInputMetrics.toolbarIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      <AnimatedPopover
        open={snapshot.open}
        maxHeight={MAX_HEIGHT}
        role={snapshot.view === "main" ? "listbox" : "dialog"}
        style={{
          position: "absolute",
          bottom: "calc(100% + 6px)",
          left: 0,
          zIndex: 210,
          width: snapshot.view === "main" ? MAIN_WIDTH : SECONDARY_WIDTH,
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "0 -4px 16px rgba(0,0,0,0.10), 0 10px 32px rgba(0,0,0,0.18)",
        }}
      >
        {snapshot.view === "main" ? (
          <div style={{ display: "flex", flexDirection: "column", padding: "4px" }}>
            {COMPOSER_PICKER_ITEMS.map((item, index) => (
              <PickerRow
                key={item.action}
                action={item.action}
                active={index === snapshot.activeIndex}
                opensView={item.opensView}
                label={t(LABEL_KEYS[item.action])}
                onActivate={() => activateItem(index)}
                onHover={() => picker.setActiveIndex(index)}
              />
            ))}
          </div>
        ) : snapshot.view === "skill" ? (
          <SkillPickerView
            picker={picker}
            close={picker.close}
            cwd={cwd}
            slashResources={slashResources}
            onSelectSkill={onSelectSkill}
            onInsertText={onInsertText}
            onOpenSkillsPanel={onOpenSkillsPanel}
          />
        ) : (
          <FilePickerView
            picker={picker}
            close={picker.close}
            cwd={cwd}
            slashResources={slashResources}
            onSelectSkill={onSelectSkill}
            onInsertText={onInsertText}
          />
        )}
      </AnimatedPopover>
    </div>
  );
}

function PickerRow({ action, active, opensView, label, onActivate, onHover }: {
  action: ComposerPickerAction;
  active: boolean;
  opensView: boolean;
  label: string;
  onActivate: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onClick={onActivate}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        width: "100%", padding: "9px 10px",
        background: active ? "var(--bg-selected)" : "none",
        border: "none", borderRadius: 7,
        color: active ? "var(--text)" : "var(--text-muted)",
        cursor: "pointer", textAlign: "left", fontSize: 12,
        transition: "background 0.12s, color 0.12s",
      }}
    >
      <span aria-hidden="true" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 17, flexShrink: 0, color: "var(--accent)" }}>
        {action === "image" ? (
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        ) : action === "skill" ? (
          <ICONS.sparkle size={15} strokeWidth={1.8} />
        ) : (
          <ICONS.folder size={15} strokeWidth={1.8} />
        )}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {opensView && (
        <span aria-hidden="true" style={{ display: "flex", alignItems: "center", color: "var(--text-dim)", flexShrink: 0 }}>
          <ICONS.chevronRight size={12} strokeWidth={1.8} />
        </span>
      )}
    </button>
  );
}
