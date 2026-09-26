"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTransientFlag } from "@/hooks/useTransientFlag";
import { SettingsSection } from "../SettingsSection";
import { SaveButton, UnsavedHint } from "../staged-save";
import { SecondaryButton, TextInput } from "../controls";
import { ALWAYS_BYPASS_HOSTS, type PiWorkConfig } from "@/lib/shared/config-types";
import type { DirtyReporter } from "../use-unsaved-changes";

interface ProbeResult {
  ok: boolean;
  status?: number;
  durationMs: number;
  error?: string;
}

/**
 * Section: Network proxy.
 *
 * Interaction notes (this section is deliberately not "everything is
 * immediate-apply"):
 *
 * - `url` / `no_proxy` are drafts. Half-typed `http://127.0.0.1:` must never
 *   reach config.yaml, and a typo must never be applied to the live
 *   dispatcher.
 * - The address field comes *first*: everything else is unusable without it,
 *   and a wall of disabled controls with no visible cause is worse than an
 *   empty field with an explicit hint.
 * - The enable checkbox is clickable as soon as an address exists *anywhere*
 *   (saved or still in the draft) — pressing it persists the draft and flips
 *   the switch in one write. Requiring "Save" first read as a dead control.
 * - "Test connection" always probes the draft, so an address can be verified
 *   before it is written anywhere.
 */
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

  // Re-sync the drafts whenever the persisted value changes (first load, or a
  // write from another tab), so the fields never keep stale text after a save.
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

  /** Persist the draft; optionally flip `enabled` in the same write. */
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
    <SettingsSection id="network-proxy" topGap>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px" }}>
        {t("Network proxy")}
      </h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px", lineHeight: 1.5 }}>
        {t("Route every outbound server request — model calls, RSS, GitHub Trending — through an HTTP proxy. Takes effect immediately, no restart needed.")}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label htmlFor="network-proxy-url" style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t("Proxy address")}
        </label>
        <TextInput
          id="network-proxy-url"
          value={url}
          onChange={setUrl}
          placeholder="http://127.0.0.1:7897"
          mono
        />
        {!canUseProxy && (
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {t("Enter a proxy address first — it is required to enable or test the proxy.")}
          </div>
        )}

        <label style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
          {t("Bypass list (optional)")}
        </label>
        <TextInput
          value={noProxy}
          onChange={setNoProxy}
          placeholder="10.0.0.0/8,.internal.example.com"
          mono
        />
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {t("Comma-separated hosts or suffixes. {hosts} are always bypassed.", {
            hosts: ALWAYS_BYPASS_HOSTS.join(", "),
          })}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text)" }}>
          <input
            type="checkbox"
            checked={saved.enabled}
            disabled={!canUseProxy}
            onChange={() => persist(!saved.enabled)}
          />
          {t("Use proxy")}
        </label>

        <SaveButton
          canSave={dirty}
          saving={saving}
          saved={saveOk}
          onClick={() => persist()}
        />
        <SecondaryButton onClick={runTest} disabled={!canUseProxy || testing}>
          {testing ? t("Testing…") : t("Test connection")}
        </SecondaryButton>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: active ? "var(--success)" : "var(--text-dim)" }}>
          {active
            ? t("Proxy enabled — {url}", { url: saved.url })
            : t("Proxy disabled")}
        </span>
        <UnsavedHint show={dirty} />
      </div>

      {probeMessage && (
        <div
          style={{
            fontSize: 12,
            marginTop: 8,
            color: probe?.ok ? "var(--success)" : "var(--error)",
            lineHeight: 1.5,
          }}
        >
          {probeMessage}
        </div>
      )}

      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 10, lineHeight: 1.5 }}>
        {t("The connection test sends one request to {url} through the proxy. Only http:// and https:// proxies are supported.", {
          url: "https://www.google.com/generate_204",
        })}
      </div>
    </SettingsSection>
  );
}
