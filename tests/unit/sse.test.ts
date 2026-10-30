import { describe, expect, it } from "vitest";
import { splitSseEvents } from "@/lib/shared/sse";

describe("splitSseEvents", () => {
  it("returns every complete frame in one chunk", () => {
    const chunk = 'data: {"type":"log","line":"a"}\n\ndata: {"type":"done"}\n\n';
    expect(splitSseEvents(chunk)).toEqual({
      events: ['{"type":"log","line":"a"}', '{"type":"done"}'],
      rest: "",
    });
  });

  it("keeps a trailing partial frame for the next chunk", () => {
    const chunk = 'data: {"type":"log"}\n\ndata: {"type":"do';
    expect(splitSseEvents(chunk)).toEqual({
      events: ['{"type":"log"}'],
      rest: 'data: {"type":"do',
    });
  });

  it("reassembles a frame split across two chunks", () => {
    const first = splitSseEvents('data: {"type":"do');
    expect(first.events).toEqual([]);
    const second = splitSseEvents(`${first.rest}ne"}\n\n`);
    expect(second).toEqual({ events: ['{"type":"done"}'], rest: "" });
  });

  it("treats CRLF separators the same as LF", () => {
    const chunk = 'data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n';
    expect(splitSseEvents(chunk)).toEqual({ events: ['{"a":1}', '{"b":2}'], rest: "" });
  });

  it("drops comment and non-data lines", () => {
    const chunk = ': keepalive\nevent: message\ndata: {"a":1}\n\n';
    expect(splitSseEvents(chunk)).toEqual({ events: ['{"a":1}'], rest: "" });
  });

  it("joins multiple data lines with a newline", () => {
    expect(splitSseEvents("data: one\ndata: two\n\n")).toEqual({
      events: ["one\ntwo"],
      rest: "",
    });
  });

  it("accepts a data field with no space after the colon", () => {
    expect(splitSseEvents("data:{}\n\n")).toEqual({ events: ["{}"], rest: "" });
  });

  it("ignores a frame that carries no data", () => {
    expect(splitSseEvents("event: ping\n\n")).toEqual({ events: [], rest: "" });
  });
});
