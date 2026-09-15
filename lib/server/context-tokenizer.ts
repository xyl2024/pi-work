// ============================================================================
// Server-side local tokenizer for context composition
//
// The "estimate, no truth" half of ADR-0005. Every provider reports only a
// total prompt size, so the *split* of the context window is computed here with
// one general-purpose encoding and anchored to the provider total elsewhere
// (`lib/shared/context-composition`).
//
// Why this file exists as its own module:
//
//  - `gpt-tokenizer` ships the BPE ranks as a ~2.4MB ESM blob. It must never
//    reach the browser bundle (AGENTS.md forbids `better-sqlite3`-class server
//    deps in client code), so it is imported **dynamically** and only from
//    `lib/server/**`. Client modules, hooks and `lib/shared` never see it —
//    the pure module takes a `countTokens` function as a parameter instead.
//  - Exactly one encoding is used (`o200k_base`), never one per provider: a
//    precision difference that only applies to some sessions would read as
//    "the rest of them are wrong" (see ADR-0005's rejected options).
//  - The import is memoized: the ranks load once per server process, and every
//    later read reuses the same counter without re-parsing 2.4MB.
// ============================================================================

import { createLogger } from "./logger";

const log = createLogger("context-tokenizer");

/** Counts tokens in a string. This is the shape injected into
 *  `computeContextComposition` — nothing else may reach the tokenizer. */
export type TokenCounter = (text: string) => number;

// Memoized import promise. `null` means "not loaded (or the last load failed
// and a retry is allowed)".
let counterPromise: Promise<TokenCounter> | null = null;

function loadCounter(): Promise<TokenCounter> {
  return import("gpt-tokenizer/encoding/o200k_base").then((module) => {
    const { countTokens } = module;
    log.info("context tokenizer loaded", { encoding: "o200k_base" });
    return (text: string) => countTokens(text);
  });
}

/**
 * The process-wide `o200k_base` counter, loaded on first use and reused after
 * that. Concurrent callers share one in-flight import.
 *
 * A failed load is not cached: a later `message_end` can retry, which keeps a
 * transient bundle/runtime hiccup from permanently disabling composition for
 * the life of the process.
 */
export async function getContextTokenCounter(): Promise<TokenCounter> {
  if (!counterPromise) {
    counterPromise = loadCounter().catch((error) => {
      counterPromise = null;
      log.warn("context tokenizer load failed", { error: String(error) });
      throw error;
    });
  }
  return counterPromise;
}
