"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AnimatedPopover } from "../ui/AnimatedPopover";
import { ICONS } from "../ui/icons";
import { FilePickerView } from "./composer-picker/FilePickerView";
import { SkillPickerView } from "./composer-picker/SkillPickerView";
import { useComposerPicker } from "./composer-picker/useComposerPicker";
import { isInteractiveKeyboardTarget } from "./composer-picker/keyboard-target";
import { resolvePickerKeyAction, type PickerKeyRegion } from "@/lib/client/picker-keyboard";
import { chatInputMetrics, TOOLBAR_ICON_STROKE } from "./chat-input/metrics";
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
  const snapshot = useComposerPicker(picker);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [available, setAvailable] = useState({ maxWidth: MAIN_WIDTH, maxHeight: MAX_HEIGHT });

  const updateAvailable = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportTop = window.visualViewport?.offsetTop ?? 0;
    const maxWidth = Math.max(0, Math.min(viewportWidth - margin * 2, viewportWidth - rect.left - margin));
    const maxHeight = Math.max(0, Math.min(MAX_HEIGHT, rect.top - viewportTop - margin));
    setAvailable((previous) => previous.maxWidth === maxWidth && previous.maxHeight === maxHeight
      ? previous
      : { maxWidth, maxHeight });
  }, []);

  const activateItem = useCallback((index: number) => {
    const result = picker.activate(index);
    if (result?.action === "image") onPickImage();
  }, [onPickImage, picker]);

  const keyboardRegion = useCallback((target: EventTarget | null): PickerKeyRegion => {
    if (target === triggerRef.current) return "trigger";
    if (target instanceof HTMLElement && target.closest("[data-picker-nav-row]")) return "navigation";
    if (isInteractiveKeyboardTarget(target)) return "control";
    return "navigation";
  }, []);

  const focusMainRow = useCallback((index: number) => {
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-picker-main-row="${index}"]`)
      ?.focus();
  }, []);

  useEffect(() => {
    if (!snapshot.open || snapshot.view !== "main") return;
    const frame = requestAnimationFrame(() => focusMainRow(picker.get().activeIndex));
    return () => cancelAnimationFrame(frame);
  }, [focusMainRow, picker, snapshot.open, snapshot.view]);

  useLayoutEffect(() => {
    if (!snapshot.open) return;
    updateAvailable();
    window.addEventListener("resize", updateAvailable);
    window.visualViewport?.addEventListener("resize", updateAvailable);
    return () => {
      window.removeEventListener("resize", updateAvailable);
      window.visualViewport?.removeEventListener("resize", updateAvailable);
    };
  }, [snapshot.open, updateAvailable]);

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
      const action = resolvePickerKeyAction({
        key: event.key,
        region: keyboardRegion(event.target),
        view: snapshot.view,
        composing: event.isComposing,
      });
      if (action === "back") {
        event.preventDefault();
        const result = picker.back();
        if (result.closed) triggerRef.current?.focus();
        return;
      }
      if (snapshot.view !== "main") return;
      if (action === "move-previous" || action === "move-next") {
        event.preventDefault();
        picker.moveActive(action === "move-next" ? 1 : -1, COMPOSER_PICKER_ITEMS.length);
        focusMainRow(picker.get().activeIndex);
        return;
      }
      if (action === "activate") {
        event.preventDefault();
        activateItem(picker.get().activeIndex);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activateItem, focusMainRow, keyboardRegion, picker, snapshot.open, snapshot.view]);

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
          borderRadius: chatInputMetrics.toolbarRadius,
          color: snapshot.open ? "var(--text)" : "var(--text-muted)",
          cursor: "pointer",
          transition: "background var(--dur-base), color var(--dur-base)",
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
        <svg width={chatInputMetrics.toolbarIcon} height={chatInputMetrics.toolbarIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={TOOLBAR_ICON_STROKE} strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      <AnimatedPopover
        open={snapshot.open}
        maxHeight={available.maxHeight}
        inertWhenClosed
        role={snapshot.view === "main" ? "listbox" : "dialog"}
        style={{
          position: "absolute",
          bottom: "calc(100% + 6px)",
          left: 0,
          zIndex: 210,
          width: Math.max(0, Math.min(snapshot.view === "main" ? MAIN_WIDTH : SECONDARY_WIDTH, available.maxWidth)),
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--elevation-prominent)",
        }}
      >
        {snapshot.view === "main" ? (
          <div style={{ display: "flex", flexDirection: "column", padding: "4px" }}>
            {COMPOSER_PICKER_ITEMS.map((item, index) => (
              <PickerRow
                key={item.action}
                index={index}
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

function PickerRow({ index, action, active, opensView, label, onActivate, onHover }: {
  index: number;
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
      data-picker-nav-row
      data-picker-main-row={index}
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onActivate}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        width: "100%", padding: "9px 10px",
        background: active ? "var(--bg-selected)" : "none",
        border: "none", borderRadius: "var(--radius-sm)",
        color: active ? "var(--text)" : "var(--text-muted)",
        cursor: "pointer", textAlign: "left", fontSize: 12,
        transition: "background var(--dur-base), color var(--dur-base)",
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
