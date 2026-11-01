"use client";

import { useSyncExternalStore } from "react";
import type { ComposerPicker } from "@/lib/client/composer-picker";

export function useComposerPicker(picker: ComposerPicker) {
  return useSyncExternalStore(picker.subscribe, picker.get, picker.get);
}
