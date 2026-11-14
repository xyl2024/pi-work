import {
  READ_ALOUD_SYNTHESIZE_TIMEOUT_MS,
  isReadAloudErrorCode,
  readAloudErrorCodeForStatus,
  type ReadAloudErrorCode,
} from "@/lib/shared/read-aloud";

export type ReadAloudSynthesisResult =
  | { ok: true; audio: Blob }
  | { ok: false; code: ReadAloudErrorCode };

export interface ReadAloudSynthesisOptions {
  signal?: AbortSignal;
}

async function errorCodeFrom(response: Response): Promise<ReadAloudErrorCode> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (isReadAloudErrorCode(body.error)) return body.error;
  } catch {
    return readAloudErrorCodeForStatus(response.status);
  }
  return readAloudErrorCodeForStatus(response.status);
}

export async function synthesizeReadAloud(
  text: string,
  options: ReadAloudSynthesisOptions = {},
): Promise<ReadAloudSynthesisResult> {
  const timeout = AbortSignal.timeout(READ_ALOUD_SYNTHESIZE_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch("/api/read-aloud/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
  } catch (error) {
    const name =
      typeof error === "object" && error !== null && "name" in error
        ? (error as { name: unknown }).name
        : null;
    if (name === "TimeoutError") return { ok: false, code: "timeout" };
    return { ok: false, code: "network" };
  }

  if (!response.ok) return { ok: false, code: await errorCodeFrom(response) };

  try {
    const audio = await response.blob();
    if (audio.size === 0) return { ok: false, code: "failed" };
    return { ok: true, audio };
  } catch {
    return { ok: false, code: "network" };
  }
}
