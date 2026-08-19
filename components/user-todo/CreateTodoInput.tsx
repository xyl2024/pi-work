"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/Toast";
import type { Tag } from "@/hooks/useTodos";
import { detectActiveTagToken, MAX_TAG_LENGTH, parseCreateInput } from "./utils";
import { TagPickerPopover } from "./TagPickerPopover";

export function CreateTodoInput({
  onCreate,
  tagSuggestions,
}: {
  onCreate: (input: { title: string; tags?: string[] }) => Promise<boolean>;
  tagSuggestions: Tag[];
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [selectionStart, setSelectionStart] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dropdownDismissed, setDropdownDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Detect an in-progress `#xxx` token at the cursor. Null when the cursor
  // isn't inside a tag trigger (e.g. cursor sits after a space, or no `#`).
  const activeToken = useMemo(
    () => detectActiveTagToken(value, selectionStart),
    [value, selectionStart],
  );

  // Suggestions + optional "Create" row. Sorted case-insensitively; the
  // create row is only shown when the query is non-empty and doesn't already
  // match an existing tag case-insensitively.
  const dropdownItems = useMemo<
    Array<{ kind: "existing"; tag: string; color?: string } | { kind: "create"; tag: string }>
  >(() => {
    if (!activeToken) return [];
    const q = activeToken.query.toLowerCase();
    const existing = tagSuggestions
      .filter((tg) => tg.name.toLowerCase().startsWith(q))
      .map((tag) => ({ kind: "existing" as const, tag: tag.name, color: tag.color }));
    if (activeToken.query.length === 0) return existing;
    const hasExact = existing.some((it) => it.tag.toLowerCase() === q);
    if (hasExact) return existing;
    return [...existing, { kind: "create" as const, tag: activeToken.query }];
  }, [activeToken, tagSuggestions]);

  // When the token opens (or its contents change) snap the highlight back to
  // the first row so ArrowDown feels predictable.
  useEffect(() => {
    setActiveIndex(0);
  }, [activeToken?.start, activeToken?.query, dropdownItems.length]);

  // Escape dismissing the dropdown applies to the current token only — once
  // the cursor leaves the token (e.g. user types a space), re-arming lets the
  // next `#` reopen the popover without ceremony.
  useEffect(() => {
    if (!activeToken) setDropdownDismissed(false);
  }, [activeToken]);

  const dropdownOpen = activeToken !== null && !dropdownDismissed && dropdownItems.length > 0;

  const commitTag = (tag: string) => {
    if (!activeToken) return;
    if (tag.length > MAX_TAG_LENGTH) {
      toast.show({ kind: "error", message: t("Tag is too long") });
      return;
    }
    // Replace the `#xxx` token with `#<tag> ` (trailing space jumps the cursor
    // out of the tag zone so further typing lands in the title).
    const next = value.slice(0, activeToken.start) + `#${tag} ` + value.slice(activeToken.end);
    const newCursor = activeToken.start + 1 + tag.length + 1;
    setValue(next);
    setSelectionStart(newCursor);
    setActiveIndex(0);
    setDropdownDismissed(false);
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursor, newCursor);
      }
    });
  };

  const submit = async () => {
    if (submitting) return;
    const parsed = parseCreateInput(value);
    if (parsed.title.length === 0) {
      toast.show({ kind: "error", message: t("Title cannot be empty") });
      return;
    }
    for (const tg of parsed.tags) {
      if (tg.length > MAX_TAG_LENGTH) {
        toast.show({ kind: "error", message: t("Tag is too long") });
        return;
      }
    }
    setSubmitting(true);
    try {
      const ok = await onCreate(parsed);
      // Only clear on success — failed creates leave the value for retry.
      if (ok) {
        setValue("");
        setSelectionStart(0);
      }
    } finally {
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "0 6px",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        position: "relative",
      }}
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSelectionStart(e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) => {
          setSelectionStart(e.currentTarget.selectionStart ?? 0);
        }}
        onClick={(e) => {
          setSelectionStart(e.currentTarget.selectionStart ?? 0);
        }}
        onKeyUp={(e) => {
          setSelectionStart(e.currentTarget.selectionStart ?? 0);
        }}
        placeholder={t("# to add tags")}
        aria-label={t("# to add tags")}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (dropdownOpen) {
              const item = dropdownItems[activeIndex];
              if (item) commitTag(item.tag);
            } else {
              void submit();
            }
          } else if (e.key === "Escape") {
            if (dropdownOpen) {
              e.preventDefault();
              setDropdownDismissed(true);
            } else if (value.length > 0) {
              e.preventDefault();
              setValue("");
              setSelectionStart(0);
            }
          } else if (e.key === "ArrowDown" && dropdownOpen) {
            e.preventDefault();
            setActiveIndex((i) => (i + 1) % dropdownItems.length);
          } else if (e.key === "ArrowUp" && dropdownOpen) {
            e.preventDefault();
            setActiveIndex((i) => (i - 1 + dropdownItems.length) % dropdownItems.length);
          } else if (e.key === "Tab" && dropdownOpen) {
            e.preventDefault();
            const item = dropdownItems[activeIndex];
            if (item) commitTag(item.tag);
          }
        }}
        style={{
          flex: 1,
          minWidth: 0,
          padding: "3px 0",
          fontSize: 11,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--text)",
          fontFamily: "inherit",
        }}
      />
      {dropdownOpen && (
        <TagPickerPopover
          items={dropdownItems}
          activeIndex={activeIndex}
          onHover={setActiveIndex}
          onSelect={(i) => {
            const item = dropdownItems[i];
            if (item) commitTag(item.tag);
          }}
          onMouseDownOutside={() => setDropdownDismissed(true)}
        />
      )}
    </div>
  );
}