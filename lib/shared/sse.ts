/**
 * Minimal SSE frame splitter for the hand-rolled streaming endpoints
 * (`POST /api/skills/install` today).
 *
 * `EventSource` only speaks GET, so these routes are read by hand off
 * `response.body`. The chunk-boundary rules are therefore pinned here, by
 * `tests/unit`, instead of being left to whatever the on-screen log happens to
 * show: a frame may be split across two reads, several frames may arrive in
 * one read, and the tail of a read is usually a partial frame that has to be
 * carried into the next one.
 *
 * Pure — no fs / path / SDK / DOM — so both the client io layer and a unit
 * test can drive it.
 */

/**
 * Split `buffer` into the `data:` payloads of every *complete* event it holds,
 * plus the trailing partial frame to prepend to the next chunk.
 *
 * Follows the shape the routes emit: events are separated by a blank line,
 * `\r\n` and `\n` are equivalent, several `data:` lines in one event are
 * joined with `\n`, and one optional space after the colon is dropped. Frames
 * with no `data:` line (comments, `event:`/`id:`-only frames) are ignored.
 */
export function splitSseEvents(buffer: string): { events: string[]; rest: string } {
  const frames = buffer.replace(/\r\n/g, "\n").split("\n\n");
  // The last piece is whatever came after the final blank line — almost always
  // a partial frame, and always the caller's to carry forward.
  const rest = frames.pop() ?? "";
  const events: string[] = [];
  for (const frame of frames) {
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const value = line.slice(5);
      dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
    }
    if (dataLines.length > 0) events.push(dataLines.join("\n"));
  }
  return { events, rest };
}
