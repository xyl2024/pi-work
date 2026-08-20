"use client";

import { useState, useEffect } from "react";

/**
 * Cycling animated placeholder shown inside the chat textarea. Picks a
 * random phrase from `phrases`, types and deletes it one character at a
 * time, and blinks a caret alongside the partial text. Re-keying the
 * component (via `<Typewriter key={contentSignature} …>`) is the parent's
 * way to force a state reset when the phrases list changes underneath
 * us — without a remount, a same-length edit could leave `text` holding
 * leftover characters from the previous phrase.
 */
export function Typewriter({ phrases }: { phrases: string[] }) {
  const [phraseIdx, setPhraseIdx] = useState(() => Math.floor(Math.random() * phrases.length));
  const [text, setText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [caretOn, setCaretOn] = useState(true);

  useEffect(() => {
    const blink = setInterval(() => setCaretOn((v) => !v), 530);
    return () => clearInterval(blink);
  }, []);

  useEffect(() => {
    // Defensive reset when the phrases source changes underneath us:
    // the user can reconfigure `typewriter_phrases` via SettingsModal,
    // which mutates the parent's `phrases` reference on save. If the
    // new list is shorter than our current `phraseIdx`, the next
    // `current.slice(...)` would throw on an undefined entry. We reset
    // to a fresh random idx and clear any partial text from the
    // previous phrase.
    if (phraseIdx >= phrases.length) {
      setPhraseIdx(Math.floor(Math.random() * phrases.length));
      setText("");
      setDeleting(false);
      return;
    }
    const current = phrases[phraseIdx];
    let timeout: ReturnType<typeof setTimeout>;
    if (!deleting && text === current) {
      timeout = setTimeout(() => setDeleting(true), 1800);
    } else if (deleting && text === "") {
      setDeleting(false);
      setPhraseIdx((i) => {
        if (phrases.length <= 1) return i;
        let next = Math.floor(Math.random() * phrases.length);
        while (next === i) next = Math.floor(Math.random() * phrases.length);
        return next;
      });
    } else {
      const next = deleting ? current.slice(0, text.length - 1) : current.slice(0, text.length + 1);
      timeout = setTimeout(() => setText(next), deleting ? 28 : 55);
    }
    return () => clearTimeout(timeout);
  }, [text, deleting, phraseIdx, phrases]);

  return (
    <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
      {text}
      <span style={{ opacity: caretOn ? 1 : 0, color: "var(--accent)", marginLeft: 1 }}>▍</span>
    </span>
  );
}
