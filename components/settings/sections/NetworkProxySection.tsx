"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTransientFlag } from "@/hooks/useTransientFlag";
import { SaveButton, UnsavedHint } from "../staged-save";
import { SecondaryButton, TextInput } from "../controls";
import { SettingsGroup, SettingsNote, SettingsRow } from "../rows";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { ALWAYS_BYPASS_HOSTS, type PiWorkConfig } from "@/lib/shared/config-types";
import type { DirtyReporter } from "../use-unsaved-changes";

interface ProbeResult {
  ok: boolean;
  status?: number;
  durationMs: number;
  error?: string;
}

export function NetworkProxySection({
  config,
  apply,
  onDirtyChange,
}: {
  config: PiWorkConfig;
  apply: (computeNext: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean>;
  onDirtyChange?: DirtyReporter;
}) {
  const { t } = useI18n();
  const saved = config.network_proxy;

  const [url, setUrl] = useState(saved.url);
  const [noProxy, setNoProxy] = useState(saved.no_proxy);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [saveOk, flashSaveOk] = useTransientFlag();

  useEffect(() => {
    setUrl(saved.url);
    setNoProxy(saved.no_proxy);
  }, [saved.url, saved.no_proxy]);

  const draftUrl = url.trim();
  const draftNoProxy = noProxy.trim();
  const dirty = draftUrl !== saved.url || draftNoProxy !== saved.no_proxy;
  const canUseProxy = draftUrl.length > 0;

  useEffect(() => {
    onDirtyChange?.("network-proxy", dirty);
  }, [dirty, onDirtyChange]);

  const persist = (enabled?: boolean) => {
    setSaving(true);
    void apply((prev) => ({
      ...prev,
      network_proxy: {
        enabled: enabled ?? prev.network_proxy.enabled,
        url: draftUrl,
        no_proxy: draftNoProxy,
      },
    }))
      .then((ok) => {
        if (ok) {
          setProbe(null);
          flashSaveOk();
        }
      })
      .finally(() => setSaving(false));
  };

  const runTest = () => {
    setTesting(true);
    setProbe(null);
    void fetch("/api/settings/proxy-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: draftUrl, no_proxy: draftNoProxy }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as ProbeResult & { error?: string };
        if (!response.ok) {
          setProbe({ ok: false, durationMs: 0, error: data.error ?? `HTTP ${response.status}` });
          return;
        }
        setProbe(data);
      })
      .catch((error) => {
        setProbe({ ok: false, durationMs: 0, error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => setTesting(false));
  };

  const probeMessage = probe
    ? probe.ok
      ? t("Proxy reachable — {status} in {ms} ms", {
          status: probe.status ?? "-",
          ms: probe.durationMs,
        })
      : t("Proxy test failed: {error}", { error: probe.error ?? t("unknown error") })
    : null;

  const active = saved.enabled && saved.url.length > 0;

  return (
    <>
      <SettingsGroup
        action={(
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <UnsavedHint show={dirty} />
            <SaveButton
              canSave={dirty}
              saving={saving}
              saved={saveOk}
              onClick={() => persist()}
            />
          </div>
        )}
      >
        <SettingsRow
          title={t("Proxy address")}
          stacked
        >
          <TextInput
            id="network-proxy-url"
            value={url}
            onChange={setUrl}
            placeholder="http://127.0.0.1:7897"
            mono
          />
          {!canUseProxy && (
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {t("Enter a proxy address first — it is required to enable or test the proxy.")}
            </span>
          )}
        </SettingsRow>

        <SettingsRow
          title={t("Bypass list (optional)")}
          description={t("Comma-separated hosts or suffixes. {hosts} are always bypassed.", {
            hosts: ALWAYS_BYPASS_HOSTS.join(", "),
          })}
          stacked
        >
          <TextInput
            value={noProxy}
            onChange={setNoProxy}
            placeholder="10.0.0.0/8,.internal.example.com"
            mono
          />
        </SettingsRow>

        <SettingsRow
          title={t("Use proxy")}
          description={(
            <span style={{ color: active ? "var(--success)" : "var(--text-muted)" }}>
              {active
                ? t("Proxy enabled — {url}", { url: saved.url })
                : t("Proxy disabled")}
            </span>
          )}
        >
          <ToggleSwitch
            on={saved.enabled}
            disabled={!canUseProxy}
            onChange={() => persist(!saved.enabled)}
            label={t("Use proxy")}
          />
        </SettingsRow>

        <SettingsRow title={t("Test connection")}>
          <SecondaryButton onClick={runTest} disabled={!canUseProxy || testing}>
            {testing ? t("Testing…") : t("Test connection")}
          </SecondaryButton>
        </SettingsRow>
      </SettingsGroup>

      {probeMessage && (
        <SettingsNote tone={probe?.ok ? "success" : "error"}>{probeMessage}</SettingsNote>
      )}

      <SettingsNote>
        {t("The connection test sends one request to {url} through the proxy. Only http:// and https:// proxies are supported.", {
          url: "https://www.google.com/generate_204",
        })}
      </SettingsNote>
    </>
  );
}
