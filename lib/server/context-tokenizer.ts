import { createLogger } from "./logger";

const log = createLogger("context-tokenizer");

export type TokenCounter = (text: string) => number;

let counterPromise: Promise<TokenCounter> | null = null;

function loadCounter(): Promise<TokenCounter> {
  return import("gpt-tokenizer/encoding/o200k_base").then((module) => {
    const { countTokens } = module;
    log.info("context tokenizer loaded", { encoding: "o200k_base" });
    return (text: string) => countTokens(text);
  });
}

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
