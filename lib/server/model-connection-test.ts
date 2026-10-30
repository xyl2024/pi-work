import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ModelConnectionTestResult } from "@/lib/shared/model-connection-test";

const PROMPT = "Reply with exactly: OK";
const LIMIT = 256_000;

export function redactConnectionDiagnostics(value: unknown, secrets: string[] = []): string {
  const json = JSON.stringify(value, (key, item: unknown) => {
    if (/authorization|cookie|api[-_]?key|(?:^|[-_])(?:token|key|credential)$|access[-_]?token|refresh[-_]?token|secret|password|signature/i.test(key)) {
      return "[REDACTED]";
    }
    if (typeof item !== "string") return item;
    let text = item;
    for (const secret of secrets) {
      if (secret) text = text.split(secret).join("[REDACTED]");
    }
    return text
      .replace(/Bearer\s+[^\s"',;]+/gi, "Bearer [REDACTED]")
      .replace(/([?&](?:key|api_key|token|signature)=)[^&\s"']*/gi, "$1[REDACTED]");
  }, 2);
  return json ?? "null";
}

export async function testModelConnection(
  provider: string, modelId: string, callerSignal: AbortSignal,
): Promise<ModelConnectionTestResult> {
  const start = performance.now();
  const startedAt = new Date().toISOString();
  const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(60_000)]);
  const secrets: string[] = [];
  const details: Record<string, unknown> = {
    request: { provider, modelId, prompt: PROMPT, maxTokens: 128, timeoutMs: 60_000, maxRetries: 0 },
    responses: [],
    providerEvents: [],
  };
  let eventBytes = 0;
  let truncated = false;
  let firstEventMs: number | undefined;
  let ok = false;
  let error: string | undefined;
  try {
    const runtime = await ModelRuntime.create({ signal });
    const model = runtime.getModel(provider, modelId);
    if (!model) throw new Error("Model not found in saved configuration");
    const auth = await runtime.getAuth(model, { signal });
    if (auth?.auth.apiKey) secrets.push(auth.auth.apiKey);
    if (auth?.auth.headers) secrets.push(...Object.values(auth.auth.headers).filter((v): v is string => typeof v === "string"));
    if (model.headers) secrets.push(...Object.values(model.headers));
    details.model = model;
    details.auth = { source: auth?.source, baseUrl: auth?.auth.baseUrl };
    signal.throwIfAborted();
    const responses: unknown[] = [];
    const events: unknown[] = [];
    details.responses = responses;
    details.providerEvents = events;
    const stream = runtime.streamSimple(model, {
      messages: [{ role: "user", content: PROMPT, timestamp: Date.now() }],
    }, {
      signal, timeoutMs: 60_000, maxRetries: 0, maxTokens: 128,
      transformHeaders(headers) {
        for (const [key, value] of Object.entries(headers)) {
          if (typeof value === "string" && /authorization|cookie|key|token|secret/i.test(key)) secrets.push(value);
        }
        return headers;
      },
      onPayload(payload) { details.payload = payload; },
      onResponse(response) { responses.push({ ...response, receivedMs: Math.round(performance.now() - start) }); },
      onProviderStreamEvent(event) {
        firstEventMs ??= Math.round(performance.now() - start);
        const size = JSON.stringify(event)?.length ?? 0;
        if (eventBytes + size <= LIMIT / 2) {
          events.push(event);
          eventBytes += size;
        } else truncated = true;
      },
    });
    for await (const event of stream) {
      if (event.type === "text_delta" || event.type === "thinking_delta") {
        firstEventMs ??= Math.round(performance.now() - start);
      }
    }
    const message = await stream.result();
    details.message = message;
    ok = message.stopReason !== "error" && message.stopReason !== "aborted";
    if (!ok) error = message.errorMessage || message.stopReason;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    details.error = e instanceof Error ? { name: e.name, message: e.message, stack: e.stack, cause: String(e.cause ?? "") } : String(e);
  }
  let diagnostics = redactConnectionDiagnostics(details, secrets);
  if (diagnostics.length > LIMIT) {
    diagnostics = diagnostics.slice(0, LIMIT);
    truncated = true;
  }
  return {
    ok, startedAt, durationMs: Math.round(performance.now() - start), firstEventMs,
    error: error ? JSON.parse(redactConnectionDiagnostics(error, secrets)) as string : undefined,
    diagnostics, truncated,
  };
}
