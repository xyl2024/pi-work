import { describe, expect, it } from "vitest";
import { opensNewContext, resolveNewTabUrl } from "@/lib/shared/external-link";

const BASE = "http://localhost:30141/";

/** A plain left-click on an anchor with this href / target / download flag. */
function resolve(overrides: Partial<Parameters<typeof resolveNewTabUrl>[0]> = {}) {
  return resolveNewTabUrl({ href: "https://example.com/docs", baseUrl: BASE, ...overrides });
}

describe("opensNewContext", () => {
  it("is true for _blank and for named frames", () => {
    expect(opensNewContext("_blank")).toBe(true);
    expect(opensNewContext("_BLANK")).toBe(true);
    expect(opensNewContext("preview")).toBe(true);
  });

  it("is false for the current frame, ancestors and a missing target", () => {
    expect(opensNewContext("_self")).toBe(false);
    expect(opensNewContext("_parent")).toBe(false);
    expect(opensNewContext("_top")).toBe(false);
    expect(opensNewContext("")).toBe(false);
    expect(opensNewContext(undefined)).toBe(false);
    expect(opensNewContext(null)).toBe(false);
  });
});

describe("resolveNewTabUrl", () => {
  it("sends an external http(s) link to a new tab", () => {
    expect(resolve()).toBe("https://example.com/docs");
    expect(resolve({ href: "http://example.com/a?b=1#c" })).toBe("http://example.com/a?b=1#c");
  });

  it("sends a protocol-relative link to a new tab", () => {
    expect(resolve({ href: "//example.com/x" })).toBe("http://example.com/x");
  });

  it("keeps same-origin links in the current tab (in-app routes)", () => {
    expect(resolve({ href: "/login" })).toBeNull();
    expect(resolve({ href: "files?path=a" })).toBeNull();
    expect(resolve({ href: "http://localhost:30141/sessions" })).toBeNull();
  });

  it("leaves fragments in the page", () => {
    expect(resolve({ href: "#pi-login-form" })).toBeNull();
    expect(resolve({ href: "   #top  " })).toBeNull();
  });

  it("leaves non-web schemes to the browser", () => {
    expect(resolve({ href: "mailto:someone@example.com" })).toBeNull();
    expect(resolve({ href: "tel:+123" })).toBeNull();
    expect(resolve({ href: "javascript:alert(1)" })).toBeNull();
    expect(resolve({ href: "data:text/html,<p>hi</p>" })).toBeNull();
  });

  it("does not open twice when the anchor already targets a new context", () => {
    expect(resolve({ target: "_blank" })).toBeNull();
    expect(resolve({ target: "preview" })).toBeNull();
  });

  it("still redirects when the target stays in the frame hierarchy", () => {
    expect(resolve({ target: "_self" })).toBe("https://example.com/docs");
    expect(resolve({ target: "_top" })).toBe("https://example.com/docs");
  });

  it("keeps download anchors downloading", () => {
    expect(resolve({ download: true })).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(resolve({ href: "  https://example.com/a  " })).toBe("https://example.com/a");
  });

  it("ignores anchors with nothing to open", () => {
    expect(resolve({ href: "" })).toBeNull();
    expect(resolve({ href: "   " })).toBeNull();
    expect(resolve({ href: null })).toBeNull();
    expect(resolve({ href: undefined })).toBeNull();
  });

  it("ignores an unusable base url", () => {
    expect(resolve({ baseUrl: "not a url" })).toBeNull();
  });
});
