"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Tooltip } from "@/components/ui/Tooltip";

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
