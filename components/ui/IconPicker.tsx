"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { escapeLayers } from "@/lib/client/escape-layer";
import {
  iconPickerOptions,
  isIconPickerMove,
  moveIconPickerIndex,
} from "@/lib/shared/model-icon-picker";
import { ProviderGearIcon, ProviderIcon, PROVIDER_ICON_IDS, hasProviderIcon } from "./ProviderIcon";
import styles from "./IconPicker.module.css";

const ICON_PICKER_COLUMNS = 4;
const ICON_PICKER_OPTIONS = iconPickerOptions(PROVIDER_ICON_IDS);
const POPOVER_GAP = 6;
const POPOVER_WIDTH = 336;

function candidateValue(option: { kind: "auto" } | { kind: "icon"; id: string }): string | undefined {
  return option.kind === "icon" ? option.id : undefined;
}

export function IconPicker({
  value,
  onChange,
  autoLabel,
  dialogLabel,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  autoLabel: string;
  dialogLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const initialFocusRef = useRef(true);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const currentIndex = ICON_PICKER_OPTIONS.findIndex((option) => candidateValue(option) === value);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const openPicker = useCallback(() => {
    initialFocusRef.current = true;
    setActiveIndex(currentIndex >= 0 ? currentIndex : 0);
    setOpen(true);
  }, [currentIndex]);

  useEffect(() => {
    if (!open) return;
    const release = escapeLayers.push("icon-picker");
    return () => {
      release();
    };
  }, [open]);

  useEscapeKey(open, (event) => {
    event.preventDefault();
    event.stopPropagation();
    close(true);
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (target && popoverRef.current?.contains(target)) return;
      close(false);
    };
    const onResize = () => close(false);
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8));
    const below = rect.bottom + POPOVER_GAP;
    const expectedHeight = 320;
    const top = below + expectedHeight > window.innerHeight - 8
      ? Math.max(8, rect.top - POPOVER_GAP - expectedHeight)
      : below;
    setPosition({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open || !position || !initialFocusRef.current) return;
    initialFocusRef.current = false;
    cellRefs.current[activeIndex]?.focus();
  }, [open, position, activeIndex]);

  const moveTo = (next: number) => {
    setActiveIndex(next);
    cellRefs.current[next]?.focus();
  };

  const choose = (option: { kind: "auto" } | { kind: "icon"; id: string }) => {
    onChange(candidateValue(option));
    close(true);
  };

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    if (key === "Tab") {
      close(false);
      return;
    }
    if (key === "Enter" || key === " ") return;
    if (!isIconPickerMove(key)) return;
    event.preventDefault();
    moveTo(moveIconPickerIndex(activeIndex, key, ICON_PICKER_OPTIONS.length, ICON_PICKER_COLUMNS));
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={dialogLabel}
        onClick={() => (open ? close(false) : openPicker())}
      >
        <span className={styles.triggerIcon}>
          {value && hasProviderIcon(value)
            ? <ProviderIcon id={value} size={16} />
            : <ProviderGearIcon size={14} />}
        </span>
        <span className={styles.triggerLabel}>{value ?? autoLabel}</span>
      </button>

      {open && position && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={dialogLabel}
          className={styles.popover}
          style={{ top: position.top, left: position.left, width: POPOVER_WIDTH }}
          onKeyDown={onGridKeyDown}
        >
          <div className={styles.grid}>
            {ICON_PICKER_OPTIONS.map((option, index) => {
              const optionValue = candidateValue(option);
              const selected = optionValue === value;
              const active = index === activeIndex;
              return (
                <button
                  key={option.kind === "auto" ? "auto" : option.id}
                  ref={(el) => { cellRefs.current[index] = el; }}
                  type="button"
                  className={styles.cell}
                  data-selected={selected || undefined}
                  data-active={active || undefined}
                  aria-pressed={selected}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => choose(option)}
                >
                  <span className={styles.cellIcon}>
                    {option.kind === "auto"
                      ? <ProviderGearIcon size={18} />
                      : <ProviderIcon id={option.id} size={18} />}
                  </span>
                  <span className={styles.cellLabel}>
                    {option.kind === "auto" ? autoLabel : option.id}
                  </span>
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
