import { isIconName } from "./lucide-names";

export const EMOJI_PREFIX = "emoji:";

export function encodeEmojiValue(emoji: string): string {
  return `${EMOJI_PREFIX}${emoji}`;
}

export function isEmojiValue(value: string): boolean {
  return value.startsWith(EMOJI_PREFIX) && value.length > EMOJI_PREFIX.length;
}

export function emojiOf(value: string): string | null {
  return isEmojiValue(value) ? value.slice(EMOJI_PREFIX.length) : null;
}

export function isCwdIconValue(value: string): boolean {
  return isIconName(value) || isEmojiValue(value);
}