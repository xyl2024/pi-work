import { describe, expect, it } from "vitest";
import { codegraphPlatformPackage } from "@/lib/shared/codegraph-platform";

describe("codegraphPlatformPackage", () => {
  it("names the bundle package for the platform it is given", () => {
    expect(codegraphPlatformPackage("win32", "x64")).toBe("@colbymchenry/codegraph-win32-x64");
    expect(codegraphPlatformPackage("win32", "arm64")).toBe("@colbymchenry/codegraph-win32-arm64");
    expect(codegraphPlatformPackage("linux", "x64")).toBe("@colbymchenry/codegraph-linux-x64");
    expect(codegraphPlatformPackage("darwin", "arm64")).toBe("@colbymchenry/codegraph-darwin-arm64");
  });
});
