// Small pure text helpers shared by the panels' footers and editors. Client
// layer (no fs / Node), but free of React and DOM too, so it is unit-testable
// the same way the rest of `lib/client` is.

/**
 * Word count for a document body, counted the way the notes and plans footers
 * both report it: every CJK character is one word, runs of latin letters /
 * digits are one word each. Mixed text is the normal case for this app, so the
 * convention matters more than the exact number.
 */
export function countWords(content: string): number {
  if (!content.trim()) return 0;
  const cjk = content.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0;
  const latin = content
    .replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return cjk + latin;
}
