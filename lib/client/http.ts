// Shared JSON fetch helper for the client-side API wrappers.
//
// Every `lib/client/*` wrapper turns a non-2xx response into an Error carrying
// the server's `{ error }` message when there is one, so panels can surface it
// unchanged. Extracted so each feature's thin client does not re-implement it.

/** Parse a JSON response, throwing the server's error message on failure. */
export async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      /* ignore body */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}
