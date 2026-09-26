"use client";

import { useI18n } from "@/hooks/useI18n";
import { SettingsSection } from "../SettingsSection";
import { Check } from "../controls";
import type { PiWorkConfig } from "@/lib/shared/config-types";

/**
 * Section: Pi documentation.
 *
 * Toggles PiWorkConfig.load_pi_docs — whether pi's built-in "Pi
 * documentation" block (the lines pointing the model at the pi SDK README /
 * docs, "read only when the user asks about pi itself…") is loaded into the
 * system prompt of newly-started sessions. pi core always injects this block
 * when it generates a prompt; rpc-manager strips it for sessions started
 * after this toggle is switched off.
 */
export function PiDocumentationSection({
  config,
  apply,
}: {
  config: PiWorkConfig;
  apply: (computeNext: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean>;
}) {
  const { t } = useI18n();

  return (
    <SettingsSection id="pi-documentation">
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px" }}>{t("Pi documentation")}</h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px", lineHeight: 1.5 }}>
        {config.load_pi_docs
          ? t("Loaded — new sessions include pi's built-in Pi documentation hints. Takes effect on new sessions.")
          : t("Disabled — new sessions will not include pi's built-in Pi documentation hints. Takes effect on new sessions.")}
      </p>
      <Check
        label={t("Load Pi documentation")}
        checked={config.load_pi_docs}
        onChange={() => void apply((prev) => ({ ...prev, load_pi_docs: !prev.load_pi_docs }))}
      />
    </SettingsSection>
  );
}
