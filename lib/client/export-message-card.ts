"use client";

import { toPng } from "html-to-image";

type ExportOptions = Parameters<typeof toPng>[1];

const EXPORT_PIXEL_RATIO = 2;

export const MESSAGE_ACTION_ROW_CLASS = "message-action-row";

const CARD_BORDER_WIDTH = 2;

function paddingTotals(padding: string): { vertical: number; horizontal: number } {
  const parts = padding.trim().split(/\s+/).map((p) => parseFloat(p) || 0);
  if (parts.length === 0) return { vertical: 0, horizontal: 0 };
  if (parts.length === 1) return { vertical: parts[0] * 2, horizontal: parts[0] * 2 };
  if (parts.length === 2) return { vertical: parts[0] * 2, horizontal: parts[1] * 2 };
  if (parts.length === 3) return { vertical: parts[0] + parts[2], horizontal: parts[1] * 2 };
  return { vertical: parts[0] + parts[2], horizontal: parts[1] + parts[3] };
}

export async function exportMessageAsPng(
  source: HTMLElement,
  padding = "0",
): Promise<void> {
  const rootCss = getComputedStyle(document.documentElement);
  const bg = rootCss.getPropertyValue("--bg-panel").trim() || "#ffffff";
  const borderColor = rootCss.getPropertyValue("--border").trim();
  const pad = paddingTotals(padding);
  const borderWidth = borderColor ? CARD_BORDER_WIDTH : 0;

  const options: ExportOptions = {
    width: source.clientWidth + pad.horizontal + borderWidth,
    height: source.scrollHeight + pad.vertical + borderWidth,
    pixelRatio: EXPORT_PIXEL_RATIO,
    backgroundColor: bg,
    filter: (node) =>
      !(node.classList && node.classList.contains(MESSAGE_ACTION_ROW_CLASS)),
    style: {
      overflow: "visible",
      margin: "0",
      padding,
      border: borderColor ? `1px solid ${borderColor}` : "none",
      borderRadius: "12px",
    },
  };

  let dataUrl: string;
  try {
    dataUrl = await toPng(source, options);
  } catch (err) {
    console.warn("png export retrying without font embedding:", err);
    dataUrl = await toPng(source, { ...options, skipFonts: true });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `message-card-${stamp}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
