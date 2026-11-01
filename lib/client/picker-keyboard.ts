import type { ComposerPickerView } from "./composer-picker";

export type PickerKeyRegion = "navigation" | "trigger" | "control";

export type PickerKeyAction =
  | "move-previous"
  | "move-next"
  | "page-previous"
  | "page-next"
  | "activate"
  | "toggle-selection"
  | "back"
  | "native";

export function resolvePickerKeyAction({
  key,
  region,
  view,
  composing = false,
}: {
  key: string;
  region: PickerKeyRegion;
  view: ComposerPickerView;
  composing?: boolean;
}): PickerKeyAction {
  if (composing) return "native";
  if (key === "Escape") return "back";
  if (region === "control") return "native";
  if (key === "Enter") return "activate";
  if (key === " ") return view === "file" && region === "navigation" ? "toggle-selection" : "native";
  if (key === "ArrowUp") return "move-previous";
  if (key === "ArrowDown") return "move-next";
  if (view === "file" && key === "ArrowLeft") return "page-previous";
  if (view === "file" && key === "ArrowRight") return "page-next";
  return "native";
}
