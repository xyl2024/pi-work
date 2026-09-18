import { describe, expect, it } from "vitest";
import {
  IGNORED_SESSION_EVENTS,
  REDUCED_SESSION_EVENTS,
  SESSION_EVENT_TYPES,
} from "@/lib/shared/session-events";

// Pure unit tests for the session-event protocol (#58). The module is types +
// constants only, so this file checks the one runtime property the compile
// time checks cannot: that the two disposition lists and the enumerable type
// list agree with each other. If any of them drifts, the client would claim to
// have an opinion about an event it does not know, or silently ignore one it
// never decided about.

const reducedTypes = Object.keys(REDUCED_SESSION_EVENTS);
const ignoredTypes = Object.keys(IGNORED_SESSION_EVENTS);
const allTypes: readonly string[] = SESSION_EVENT_TYPES;

describe("session event protocol", () => {
  it("lists every protocol type exactly once", () => {
    expect(new Set(allTypes).size).toBe(allTypes.length);
    expect(allTypes.length).toBeGreaterThan(0);
  });

  it("partitions the protocol into reduced and deliberately-ignored", () => {
    expect(new Set([...reducedTypes, ...ignoredTypes])).toEqual(new Set(allTypes));
  });

  it("keeps the two lists disjoint", () => {
    const overlap = reducedTypes.filter((type) => ignoredTypes.includes(type));
    expect(overlap).toEqual([]);
  });

  it("does not put an extra member in the deliberately-ignored list", () => {
    expect(ignoredTypes.filter((type) => !allTypes.includes(type))).toEqual([]);
  });

  it("does not put a reduced branch outside the protocol", () => {
    expect(reducedTypes.filter((type) => !allTypes.includes(type))).toEqual([]);
  });

  it("gives every deliberately-ignored event a written reason", () => {
    expect(ignoredTypes.length).toBeGreaterThan(0);
    for (const type of ignoredTypes) {
      expect(IGNORED_SESSION_EVENTS[type as keyof typeof IGNORED_SESSION_EVENTS].trim().length)
        .toBeGreaterThan(0);
    }
  });

  it("gives every reduced branch a note", () => {
    expect(reducedTypes.length).toBeGreaterThan(0);
    for (const type of reducedTypes) {
      expect(REDUCED_SESSION_EVENTS[type as keyof typeof REDUCED_SESSION_EVENTS].trim().length)
        .toBeGreaterThan(0);
    }
  });
});
