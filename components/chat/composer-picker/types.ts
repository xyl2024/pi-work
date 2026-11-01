import type { ComposerPicker } from "@/lib/client/composer-picker";
import type { SlashResource } from "@/lib/shared/slash-commands";

export interface ComposerPickerViewProps {
  picker: ComposerPicker;
  close: () => void;
  cwd: string | null;
  slashResources: SlashResource[];
  onSelectSkill: (resource: SlashResource) => void;
  onInsertText: (text: string) => void;
}
