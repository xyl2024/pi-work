"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * Text that shows Pi Work's unified `Tooltip` with the full content — but
 * only when the text is actually visually truncated (ellipsis or
 * `-webkit-line-clamp`). Untruncated text renders bare, so short names /
 * descriptions never pop a redundant tooltip.
 *
 * Works for both single-line ellipsis (`overflow:hidden` + `text-overflow`)
 * and multi-line clamp: `scrollWidth` catches the former, `scrollHeight` the
 * latter. Measurement runs after each content change.
 */
export function TruncatedText({
  text,
  style,
  side = "bottom",
  maxWidth = 360,
  always = false,
}: {
  text: string;
  style?: CSSProperties;
  side?: "top" | "right" | "bottom" | "left";
  maxWidth?: number;
  /** Show the tooltip even when the text is not truncated (e.g. for a skill
   *  name, where the tooltip is useful regardless of overflow). */
  always?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setOverflowing(
      el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
    );
  }, [text]);

  const showTooltip = always || overflowing;

  const node = (
    <div ref={ref} style={style}>
      {text}
    </div>
  );

  return showTooltip ? (
    <Tooltip content={text} side={side} maxWidth={maxWidth}>
      {node}
    </Tooltip>
  ) : (
    node
  );
}
