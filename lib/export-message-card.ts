"use client";

import { toPng } from "html-to-image";

/** Options type as used by `toPng` — html-to-image doesn't re-export `Options`. */
type ExportOptions = Parameters<typeof toPng>[1];

/** Output resolution multiplier for the exported PNG (2x = crisp on retina). */
const EXPORT_PIXEL_RATIO = 2;

/**
 * Class name placed on the message footer row (copy/export buttons, usage,
 * timestamp) inside `MessageView`. The export filter drops this row so the
 * exported card shows only the message content, never the UI chrome.
 */
export const MESSAGE_ACTION_ROW_CLASS = "message-action-row";

/** 1px border drawn around the exported card (both sides). */
const CARD_BORDER_WIDTH = 2;

/**
 * Vertical + horizontal totals of a CSS padding shorthand ("1px" / "1px 2px" /
 * "1px 2px 3px" / "1px 2px 3px 4px"). Used to grow the export viewport so the
 * card padding doesn't clip content or re-flow it.
 */
function paddingTotals(padding: string): { vertical: number; horizontal: number } {
  const parts = padding.trim().split(/\s+/).map((p) => parseFloat(p) || 0);
  if (parts.length === 0) return { vertical: 0, horizontal: 0 };
  if (parts.length === 1) return { vertical: parts[0] * 2, horizontal: parts[0] * 2 };
  if (parts.length === 2) return { vertical: parts[0] * 2, horizontal: parts[1] * 2 };
  if (parts.length === 3) return { vertical: parts[0] + parts[2], horizontal: parts[1] * 2 };
  return { vertical: parts[0] + parts[2], horizontal: parts[1] + parts[3] };
}

/**
 * Render `source` (a rendered message) as a standalone PNG card and trigger
 * a download.
 *
 * html-to-image clones the node internally, then `applyStyle` overrides the
 * clone's computed style with `options.width/height/style/backgroundColor` —
 * so instead of cloning into a detached holder, we pass the live node and
 * drive everything through the options:
 *   - `height: scrollHeight` captures the FULL message, not just the part
 *     visible in the scroll viewport;
 *   - `width: clientWidth` matches the clone's width exactly (the clone has
 *     no scrollbar, so a width that includes one would leave a gap);
 *   - `overflow: visible` un-clips the scroll container on the clone;
 *   - the card look (panel background + border) uses resolved color values,
 *     because the clone renders inside an SVG data-URL image where CSS
 *     custom properties (var(--…)) no longer resolve;
 *   - `filter` drops the `message-action-row` footer (buttons / usage) so
 *     exported cards stay content-only.
 *
 * @param padding Inline padding for the exported card. The chat view's
 *   message root has none (the modal's body already carries its own), so
 *   callers pass one to keep the card from hugging its border.
 */
export async function exportMessageAsPng(
  source: HTMLElement,
  padding = "0",
): Promise<void> {
  const rootCss = getComputedStyle(document.documentElement);
  const bg = rootCss.getPropertyValue("--bg-panel").trim() || "#ffffff";
  const borderColor = rootCss.getPropertyValue("--border").trim();
  // The clone gets `padding` (and the border) via options.style; those live
  // inside the border box, so the viewport must grow by the same amounts or
  // the padded content would overflow it (clipped bottom / re-flowed text).
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
    // Webfont embedding can be rejected in some setups; retry once without
    // it before giving up (text still renders via system fonts).
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
