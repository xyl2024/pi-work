import { isIconName } from "./lucide-names";

/**
 * Encodes a cwd icon value for storage in ~/.pi-work/config.yaml under
 * `cwd_icons`. Lucide names are stored verbatim ("Folder"); emoji are
 * stored prefixed ("emoji:🔥") so the two are unambiguous and validation is
 * cheap. Browser-safe: no Node APIs.
 */
export const EMOJI_PREFIX = "emoji:";

export function encodeEmojiValue(emoji: string): string {
  return `${EMOJI_PREFIX}${emoji}`;
}

export function isEmojiValue(value: string): boolean {
  return value.startsWith(EMOJI_PREFIX) && value.length > EMOJI_PREFIX.length;
}

/** The emoji character for an emoji-stored value, or null. */
export function emojiOf(value: string): string | null {
  return isEmojiValue(value) ? value.slice(EMOJI_PREFIX.length) : null;
}

/** True when `value` is a valid stored cwd icon value (lucide name or emoji). */
export function isCwdIconValue(value: string): boolean {
  return isIconName(value) || isEmojiValue(value);
}