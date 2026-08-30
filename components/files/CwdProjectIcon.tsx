import { useCwdIcon } from "@/hooks/cwdIconStore";
import { emojiOf } from "@/lib/shared/cwd-icon";
import { CwdIcon } from "./FileIcons";
import { CWD_ICON_MAP } from "./cwd-icon-map";

/**
 * Renders the per-cwd custom icon when one is set for `cwd`: a lucide icon
 * (chosen by the user), an emoji (stored as `emoji:…`), or the default filled
 * folder `CwdIcon`. Lucide colour comes from currentColor via the call site's
 * CSS just like CwdIcon; emoji are rendered as text.
 */
export function CwdProjectIcon({
  cwd,
  size = 14,
}: {
  cwd: string | null;
  size?: number;
}) {
  // Hooks must run unconditionally.
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