"use client";

import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { SOUND_IDS, playNamedSound } from "@/lib/client/ui-sounds";
import { DEFAULT_UI_SOUND_EVENTS } from "@/lib/shared/ui-sounds-defaults";
import {
  UI_SOUND_EVENT_IDS,
  type PiWorkConfig,
  type UiSoundEventId,
} from "@/lib/shared/config-types";

/**
 * Section: UI sounds.
 *
 * - Master toggle + master volume slider (immediate-apply, same shape as
 *   typewriter_effect / append_system).
 * - Per-event sound picker. The first dropdown entry is "None" (empty string),
 *   which the parser keeps as "do not play for this event".
 * - "Restore defaults" button rewrites the per-event map only; the user's
 *   master volume and master switch are kept.
 * - Clicking the small speaker button next to a built-in name plays it for
 *   preview without committing to the setting.
 *
 * Lives in `components/settings/sections/` next to the typewriter-effect
 * toggle; both share the same "immediate-apply" mechanism (`apply()` prop
 * from `use-immediate-apply.ts`).
 */

const EVENT_LABEL_KEYS: Record<UiSoundEventId, string> = {
  toast_success: "Event: toast success",
  toast_error: "Event: toast error",
  toast_info: "Event: toast info",
  agent_success: "Event: agent success",
  agent_failure: "Event: agent failure",
  inbox_new: "Event: inbox new message",
  rss_new: "Event: RSS new article",
};

export function SoundSettingsSection({
  config,
  apply,
}: {
  config: PiWorkConfig;
  apply: (computeNext: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const sounds = config.ui_sounds;

  const updateSounds = (patch: Partial<typeof sounds>) => {
    void apply((prev) => ({
      ...prev,
      ui_sounds: {
        enabled: sounds.enabled,
        masterVolume: sounds.masterVolume,
        events: { ...prev.ui_sounds.events },
        ...patch,
      },
    }));
  };

  const setEventSound = (eventId: UiSoundEventId, value: string) => {
    void apply((prev) => {
      const events: Partial<Record<UiSoundEventId, string>> = { ...prev.ui_sounds.events };
      if (value === "") {
        delete events[eventId];
      } else {
        events[eventId] = value;
      }
      return {
        ...prev,
        ui_sounds: { ...prev.ui_sounds, events },
      };
    });
  };

  const restoreDefaults = () => {
    void apply((prev) => {
      const events: Partial<Record<UiSoundEventId, string>> = {};
      for (const [eventId, soundId] of Object.entries(DEFAULT_UI_SOUND_EVENTS)) {
        if (soundId) events[eventId as UiSoundEventId] = soundId;
      }
      return {
        ...prev,
        ui_sounds: { ...prev.ui_sounds, events },
      };
    }).then((ok) => {
      if (ok) toast.show({ kind: "success", message: t("Sound defaults restored") });
    });
  };

  return (
    <div data-settings-section="settings-section-ui-sounds" style={{ marginBottom: 24, marginTop: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px 0" }}>
        {t("UI Sounds")}
      </h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
        {t("Pick one of the eight built-in recipes for each event, or choose None to stay silent. A master volume scales every event.")}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 16 }}>
        {/* Master toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "var(--text)" }}>
            {t("Sounds enabled")}
          </span>
          <button
            onClick={() => updateSounds({ enabled: !sounds.enabled })}
            aria-label={t("UI Sounds")}
            style={{
              width: 40, height: 22, borderRadius: 11,
              background: sounds.enabled ? "var(--accent)" : "var(--bg-hover)",
              border: "none", cursor: "pointer", position: "relative",
              transition: "background 0.2s",
            }}
          >
            <span style={{
              position: "absolute", top: 2,
              left: sounds.enabled ? 20 : 2,
              width: 18, height: 18, borderRadius: 9,
              background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              transition: "left 0.2s",
            }} />
          </button>
        </div>

        {/* Master volume */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "var(--text)", minWidth: 100 }}>
            {t("Master volume")}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(sounds.masterVolume * 100)}
            onChange={(event) =>
              updateSounds({ masterVolume: Number(event.target.value) / 100 })
            }
            style={{ flex: 1, accentColor: "var(--accent)" }}
          />
          <span style={{ fontSize: 12, color: "var(--text-muted)", width: 38, textAlign: "right" }}>
            {Math.round(sounds.masterVolume * 100)}%
          </span>
        </div>
      </div>

      {/* Per-event sound picker */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {UI_SOUND_EVENT_IDS.map((eventId) => {
          const current = sounds.events[eventId] ?? "";
          return (
            <div
              key={eventId}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr minmax(180px, 220px)",
                gap: 12,
                alignItems: "center",
              }}
            >
              <label htmlFor={`sound-event-${eventId}`} style={{ fontSize: 13, color: "var(--text)" }}>
                {t(EVENT_LABEL_KEYS[eventId])}
              </label>
              <select
                id={`sound-event-${eventId}`}
                value={current}
                onChange={(event) => setEventSound(eventId, event.target.value)}
                style={{
                  background: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "6px 8px",
                  fontSize: 13,
                }}
              >
                <option value="">{t("No sound")}</option>
                {SOUND_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(id)}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      {/* Restore defaults + preview */}
      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={restoreDefaults}
          style={{
            background: "var(--bg)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "6px 12px",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {t("Restore sound defaults")}
        </button>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t("Preview:")}
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SOUND_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => playNamedSound(id)}
              style={{
                background: "var(--bg)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "4px 10px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <span style={{ marginRight: 6 }}>♪</span>
              {t(id)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}