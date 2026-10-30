"use client";

import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "@/components/ui/Tooltip";

export function CatalogSourcesHelp() {
  const { t } = useI18n();

  const content = (
    <div style={{ maxWidth: 260, display: "flex", flexDirection: "column", gap: 7, fontSize: 11, lineHeight: 1.45, overflowWrap: "anywhere" }}>
      <div style={{ fontWeight: 700 }}>{t("About model catalog sources")}</div>
      <div>{t("Pi's pi-ai SDK builds the static catalog with generate-models.ts. It combines external catalogs with Pi-maintained provider-specific overrides, then generates the bundled model metadata files.")}</div>
      <div style={{ fontWeight: 600 }}>{t("Build-time sources")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div>• {t("Base model metadata")}: <code>https://models.dev/api.json</code></div>
        <div>• {t("OpenRouter model list")}: <code>https://openrouter.ai/api/v1/models</code></div>
        <div>• {t("NVIDIA NIM model list")}: <code>https://integrate.api.nvidia.com/v1/models</code></div>
        <div>• {t("Vercel AI Gateway model list")}: <code>https://ai-gateway.vercel.sh/v1/models</code></div>
      </div>
      <div>{t("Generated files")}: <code>src/providers/data/*.json</code> → <code>src/providers/*.models.ts</code> → <code>src/models.generated.ts</code></div>
      <div>{t("At runtime, pi-coding-agent loads the bundled static catalog. An optional refresh can fetch newer entries from pi.dev and cache them in ~/.pi/agent/models-store.json.")}</div>
    </div>
  );

  return (
    <Tooltip content={content} side="bottom" align="end" delayDuration={300} interactive>
      <button
        type="button"
        aria-label={t("About model catalog sources")}
        style={{ width: 22, height: 22, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--text-dim)", borderRadius: "50%", background: "transparent", color: "var(--text-muted)", cursor: "help", fontSize: 13, fontWeight: 700, lineHeight: 1, flexShrink: 0 }}
      >
        ?
      </button>
    </Tooltip>
  );
}
