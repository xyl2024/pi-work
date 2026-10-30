import { useCwdIcon } from "@/hooks/cwdIconStore";
import { emojiOf } from "@/lib/shared/cwd-icon";
import { CwdIcon } from "./FileIcons";
import { CWD_ICON_MAP } from "./cwd-icon-map";

export function CwdProjectIcon({
  cwd,
  size = 14,
}: {
  cwd: string | null;
  size?: number;
}) {
  const value = useCwdIcon(cwd);

  if (value) {
    const emoji = emojiOf(value);
    if (emoji) {
      return (
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            lineHeight: 1,
            fontSize: size,
            flexShrink: 0,
          }}
        >
          {emoji}
        </span>
      );
    }
    const Icon = CWD_ICON_MAP[value];
    if (Icon) {
      return <Icon size={size} strokeWidth={2} aria-hidden />;
    }
  }
  return <CwdIcon size={size} />;
}