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
    return NextResponse.json(config);
  } catch (error) {
    log.error("settings read failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const startedAt = Date.now();
  try {
    const rawBody = (await req.json()) as Record<string, unknown>;

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

    const onDisk = readConfig();

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
      ...(isObject(body.network_proxy)
        ? { network_proxy: body.network_proxy as unknown as PiWorkConfig["network_proxy"] }
        : {}),
    };

    writeConfig(next);
    applyNetworkProxy(next.network_proxy);
    log.info("settings written", { durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("settings write failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
