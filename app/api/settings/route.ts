import { NextResponse } from "next/server";
import { readConfig, writeConfig } from "@/lib/server/config";
import { applyNetworkProxy, checkProxyUrl } from "@/lib/server/network-proxy";
import {
  FILE_VIEWER_LIMITS,
  FILE_VIEWER_KINDS,
} from "@/lib/shared/file-viewer-limits";
import { UI_SOUND_EVENT_IDS } from "@/lib/shared/config-types";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import { isSettingsOwnedKey } from "@/lib/shared/settings-keys";
import { createLogger, elapsedMs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/settings");

/**
 * Strict validator for the `file_viewer.max_size_mb` sub-tree. Returns
 * {ok: false, error} on the first invalid value (with the field path in
 * the message), {ok: true} if every per-kind entry is either absent
 * (parser will fall back to default) or a valid integer in [min, max].
 * Runs at the PUT boundary so the SettingsModal can't persist garbage
 * even if its own client-side validation regresses; the lib/config.ts
 * parser is independently fail-open so a hand-edited YAML never breaks
 * the file route.
 */
function validateFileViewerMaxSizeMb(
  raw: unknown,
): { ok: true } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true };
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "file_viewer.max_size_mb must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  for (const kind of FILE_VIEWER_KINDS) {
    const val = obj[kind];
    if (val === undefined) continue;
    if (
      typeof val !== "number" ||
      !Number.isFinite(val) ||
      !Number.isInteger(val) ||
      val < FILE_VIEWER_LIMITS[kind].min ||
      val > FILE_VIEWER_LIMITS[kind].max
    ) {
      const { min, max } = FILE_VIEWER_LIMITS[kind];
      return {
        ok: false,
        error: `file_viewer.max_size_mb.${kind} must be an integer between ${min} and ${max} (MB)`,
      };
    }
  }
  return { ok: true };
}

function validateFileViewer(
  raw: unknown,
): { ok: true } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true };
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "file_viewer must be an object" };
  }
  return validateFileViewerMaxSizeMb(
    (raw as Record<string, unknown>).max_size_mb,
  );
}

function validateWebAccess(raw: unknown): { ok: true } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "web_access must be an object" };
  const obj = raw as Record<string, unknown>;
  if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") return { ok: false, error: "web_access.enabled must be a boolean" };
  if (obj.tavily !== undefined && (!obj.tavily || typeof obj.tavily !== "object" || Array.isArray(obj.tavily))) return { ok: false, error: "web_access.tavily must be an object" };
  const tavily = (obj.tavily ?? {}) as Record<string, unknown>;
  if (tavily.api_key !== undefined && typeof tavily.api_key !== "string") return { ok: false, error: "web_access.tavily.api_key must be a string" };
  if (tavily.clear_api_key !== undefined && typeof tavily.clear_api_key !== "boolean") return { ok: false, error: "web_access.tavily.clear_api_key must be a boolean" };
  return { ok: true };
}

function validateNetworkProxy(
  raw: unknown,
): { ok: true } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "network_proxy must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
    return { ok: false, error: "network_proxy.enabled must be a boolean" };
  }
  if (obj.no_proxy !== undefined && typeof obj.no_proxy !== "string") {
    return { ok: false, error: "network_proxy.no_proxy must be a string" };
  }
  const urlCheck = checkProxyUrl(obj.url);
  if (!urlCheck.ok) return { ok: false, error: urlCheck.error };
  // Enabling the proxy without an address would silently leave traffic
  // direct, which reads as "the setting did nothing" — reject it instead.
  if (obj.enabled === true && !urlCheck.url) {
    return { ok: false, error: "network_proxy.url is required when the proxy is enabled" };
  }
  return { ok: true };
}

function validateUiSounds(
  raw: unknown,
): { ok: true } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true };
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "ui_sounds must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.enabled !== "undefined" && typeof obj.enabled !== "boolean") {
    return { ok: false, error: "ui_sounds.enabled must be a boolean" };
  }
  if (typeof obj.masterVolume !== "undefined") {
    if (
      typeof obj.masterVolume !== "number" ||
      !Number.isFinite(obj.masterVolume) ||
      obj.masterVolume < 0 ||
      obj.masterVolume > 1
    ) {
      return { ok: false, error: "ui_sounds.masterVolume must be a number in [0, 1]" };
    }
  }
  const events = obj.events;
  if (events === undefined || events === null) return { ok: true };
  if (!events || typeof events !== "object") {
    return { ok: false, error: "ui_sounds.events must be an object" };
  }
  const eventObj = events as Record<string, unknown>;
  for (const key of Object.keys(eventObj)) {
    if (!(UI_SOUND_EVENT_IDS as readonly string[]).includes(key)) {
      return { ok: false, error: `ui_sounds.events has unknown event "${key}"` };
    }
    const value = eventObj[key];
    if (value !== null && typeof value !== "string") {
      return { ok: false, error: `ui_sounds.events.${key} must be a string or null` };
    }
  }
  return { ok: true };
}

export async function GET() {
  const startedAt = Date.now();
  try {
    const config = readConfig();
    log.info("settings read", { durationMs: elapsedMs(startedAt) });
    return NextResponse.json({
      ...config,
      web_access: {
        ...config.web_access,
        tavily: { has_api_key: Boolean(config.web_access.tavily.api_key) },
      },
    });
  } catch (error) {
    log.error("settings read failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const startedAt = Date.now();
  try {
    const rawBody = (await req.json()) as Record<string, unknown>;

    // The body is a *patch*: only the keys this route owns (the shared
    // SETTINGS_OWNED_KEYS list) are considered. Anything else
    // (cwd_aliases / cwd_icons / disabled_skills …) is ignored without an
    // error, so an old client submitting a whole config snapshot is a
    // harmless no-op for the keys another feature owns. Method stays PUT so
    // upgrading clients never see a 405.
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawBody)) {
      if (isSettingsOwnedKey(key)) body[key] = value;
    }
    if (body.file_viewer !== undefined) {
      const fileViewerCheck = validateFileViewer(body.file_viewer);
      if (!fileViewerCheck.ok) {
        log.warn("settings rejected: invalid file_viewer", {
          error: fileViewerCheck.error,
          durationMs: elapsedMs(startedAt),
        });
        return NextResponse.json({ error: fileViewerCheck.error }, { status: 400 });
      }
    }

    if (body.web_access !== undefined) {
      const webAccessCheck = validateWebAccess(body.web_access);
      if (!webAccessCheck.ok) return NextResponse.json({ error: webAccessCheck.error }, { status: 400 });
    }

    if (body.ui_sounds !== undefined) {
      const uiSoundsCheck = validateUiSounds(body.ui_sounds);
      if (!uiSoundsCheck.ok) {
        log.warn("settings rejected: invalid ui_sounds", {
          error: uiSoundsCheck.error,
          durationMs: elapsedMs(startedAt),
        });
        return NextResponse.json({ error: uiSoundsCheck.error }, { status: 400 });
      }
    }

    if (body.network_proxy !== undefined) {
      const networkProxyCheck = validateNetworkProxy(body.network_proxy);
      if (!networkProxyCheck.ok) {
        log.warn("settings rejected: invalid network_proxy", {
          error: networkProxyCheck.error,
          durationMs: elapsedMs(startedAt),
        });
        return NextResponse.json({ error: networkProxyCheck.error }, { status: 400 });
      }
    }

    // Start from what is on disk and overlay only the owned keys present in
    // the patch; the write face is therefore exactly SETTINGS_OWNED_KEYS.
    const onDisk = readConfig();

    // Tavily key keeps its masked-read / explicit-clear semantics.
    const incomingWeb = body.web_access as
      | (Partial<PiWorkConfig["web_access"]> & {
          tavily?: { api_key?: unknown; clear_api_key?: unknown };
        })
      | undefined;
    let nextWebAccess = onDisk.web_access;
    if (incomingWeb !== undefined) {
      nextWebAccess = {
        ...onDisk.web_access,
        ...(incomingWeb.enabled === undefined ? {} : { enabled: incomingWeb.enabled }),
        tavily: { ...onDisk.web_access.tavily },
      };
      const incomingTavily = incomingWeb.tavily;
      if (incomingTavily?.clear_api_key === true) delete nextWebAccess.tavily.api_key;
      else if (typeof incomingTavily?.api_key === "string" && incomingTavily.api_key.trim()) {
        nextWebAccess.tavily.api_key = incomingTavily.api_key.trim();
      }
    }

    const isObject = (v: unknown): v is Record<string, unknown> =>
      Boolean(v) && typeof v === "object" && !Array.isArray(v);

    const next: PiWorkConfig = {
      ...onDisk,
      ...(isObject(body.right_side_bar)
        ? { right_side_bar: body.right_side_bar as unknown as PiWorkConfig["right_side_bar"] }
        : {}),
      ...(isObject(body.append_system)
        ? { append_system: body.append_system as unknown as PiWorkConfig["append_system"] }
        : {}),
      ...(typeof body.load_pi_docs === "boolean" ? { load_pi_docs: body.load_pi_docs } : {}),
      ...(isObject(body.file_viewer)
        ? { file_viewer: body.file_viewer as unknown as PiWorkConfig["file_viewer"] }
        : {}),
      ...(isObject(body.ui_sounds) ? { ui_sounds: body.ui_sounds as unknown as PiWorkConfig["ui_sounds"] } : {}),
      ...(isObject(body.subagent) ? { subagent: body.subagent as unknown as PiWorkConfig["subagent"] } : {}),
      ...(isObject(body.network_proxy)
        ? { network_proxy: body.network_proxy as unknown as PiWorkConfig["network_proxy"] }
        : {}),
      web_access: nextWebAccess,
    };

    writeConfig(next);
    // Hot-apply: the dispatcher is process-wide, so a saved setting changes
    // the next outbound request without restarting the server.
    applyNetworkProxy(next.network_proxy);
    log.info("settings written", { durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("settings write failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
