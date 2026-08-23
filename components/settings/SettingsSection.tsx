"use client";

import type { ReactNode } from "react";

/**
 * Wrapper for a single settings "section" inside `SettingsModal`.
 *
 * Centralizes two responsibilities so each section component doesn't
 * re-implement them:
 *
 * 1. **`data-settings-section` attribute** — `SettingsModal` walks these
 *    attributes with `IntersectionObserver` to drive the right-rail
 *    nav highlight, and uses them as scroll targets when the user picks
 *    a section from the rail. The convention is
 *    `settings-section-<slug>` (the slug is what shows in the rail).
 *
 * 2. **Vertical spacing** — most sections are separated from their
 *    neighbor by a single 24px gap; sections that follow an open
 *    description block use a 24px top + 24px bottom. `bottomGap`
 *    defaults to `true`; pass `false` to suppress the bottom margin
 *    (used by `settings-section-inbox-test` which sits at the end of
 *    the modal and shouldn't leave trailing whitespace).
 *
 * Usage:
 *   <SettingsSection id="appearance">
 *     <h3>{t("Appearance")}</h3>
 *     …
 *   </SettingsSection>
 */
export function SettingsSection({
  id,
  topGap = false,
  bottomGap = true,
  children,
}: {
  id: string;
  /** Add a 24px top margin to separate from the previous section. */
  topGap?: boolean;
  /** Add a 24px bottom margin. Default true. */
  bottomGap?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-settings-section={`settings-section-${id}`}
      style={{
        marginTop: topGap ? 24 : 0,
        marginBottom: bottomGap ? 24 : 0,
      }}
    >
      {children}
    </div>
  );
}
