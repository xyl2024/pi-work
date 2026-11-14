"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { SecondaryButton, Select } from "../controls";
import { SettingsGroup, SettingsRow } from "../rows";
import { SOUND_IDS, playNamedSound } from "@/lib/client/ui-sounds";
import { DEFAULT_UI_SOUND_EVENTS } from "@/lib/shared/ui-sounds-defaults";
import {
  UI_SOUND_EVENT_IDS,
  type PiWorkConfig,
  type UiSoundEventId,
} from "@/lib/shared/config-types";

const EVENT_LABEL_KEYS: Record<UiSoundEventId, string> = {
  toast_success: "Event: toast success",
  toast_error: "Event: toast error",
  toast_info: "Event: toast info",
  agent_success: "Event: agent success",
  agent_failure: "Event: agent failure",
  ask_user_questions: "Event: ask user questions",
  permission_request: "Event: permission request",
  celebrate: "Event: celebration",
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

  const [volume, setVolume] = useState(Math.round(sounds.masterVolume * 100));
  useEffect(() => {
    setVolume(Math.round(sounds.masterVolume * 100));
  }, [sounds.masterVolume]);
  const commitVolume = () => {
    const next = volume / 100;
    if (next !== sounds.masterVolume) updateSounds({ masterVolume: next });
  };

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
    <>
      <SettingsGroup>
        <SettingsRow title={t("Sounds enabled")}>
          <ToggleSwitch
            on={sounds.enabled}
            onChange={(next) => updateSounds({ enabled: next })}
            label={t("UI Sounds")}
          />
        </SettingsRow>
        <SettingsRow title={t("Master volume")}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, width: 240 }}>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              onPointerUp={commitVolume}
              onBlur={commitVolume}
              onKeyUp={commitVolume}
              style={{ flex: 1, accentColor: "var(--accent)" }}
            />
            <span style={{ fontSize: 12, color: "var(--text-muted)", width: 38, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {volume}%
            </span>
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("Events")}>
        {UI_SOUND_EVENT_IDS.map((eventId) => {
          const current = sounds.events[eventId] ?? "";
          return (
            <SettingsRow key={eventId} title={t(EVENT_LABEL_KEYS[eventId])}>
              <Select
                id={`sound-event-${eventId}`}
                value={current}
                required
                options={[
                  { value: "", label: t("No sound") },
                  ...SOUND_IDS.map((id) => ({ value: id, label: t(id) })),
                ]}
                onChange={(value) => setEventSound(eventId, value)}
                style={{ width: 200 }}
              />
            </SettingsRow>
          );
        })}
      </SettingsGroup>

      <SettingsGroup title={t("Preview")} action={<SecondaryButton onClick={restoreDefaults}>{t("Restore sound defaults")}</SecondaryButton>}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingTop: 10 }}>
          {SOUND_IDS.map((id) => (
            <SecondaryButton key={id} onClick={() => playNamedSound(id)}>
              <span aria-hidden="true">♪</span>
              {t(id)}
            </SecondaryButton>
          ))}
        </div>
      </SettingsGroup>
    </>
  );
}
