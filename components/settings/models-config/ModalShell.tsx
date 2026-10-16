"use client";

import type { ReactNode } from "react";

/**
 * Overlay + centered card that hosts a models-config dialog body in a modal.
 *
 * The bodies (`AddProviderPickerBody`, `AddModelNameStepBody`,
 * `ModelCatalogPickerBody`) render layout only — no backdrop, no fixed
 * positioning, no width of their own. A modal caller wraps one in this shell;
 * a caller that wants a full-width page (e.g. a future panel page stack)
 * renders the body directly. The stacking convention for these layered
 * dialogs lives here, not in the bodies.
 */
export function ModalShell({
  onClose,
  width,
  height,
  maxHeight,
  zIndex = 1300,
  children,
}: {
  onClose: () => void;
  width: number;
  height?: string;
  maxHeight?: string;
  zIndex?: number;
  children: ReactNode;
}) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width, maxWidth: "calc(100vw - 32px)", height, maxHeight, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.22)", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}
