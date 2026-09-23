import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";
import { CODEGRAPH_PLATFORM_PACKAGE } from "@/lib/server/codegraph-sdk";
import { codegraphPlatformPackage } from "@/lib/shared/codegraph-platform";

/**
 * The CodeGraph bundle package has to be named identically in two places that
 * cannot share a call: `next.config.ts` externalises it (so the bundle's
 * tree-sitter wasm loaders never enter the webpack graph), and
 * `lib/server/codegraph-sdk.ts` requires it at runtime. Listing the Linux
 * package on a Windows build means the wrong bundle gets inlined — or, for the
 * runtime require, that Turbopack cannot resolve it at all.
 *
 * These assertions run on whatever platform the suite runs on, so they are the
 * cheap half of the Windows verification: on a Windows host they fail if either
 * side is still pinned to a Linux package name.
 */
describe("CodeGraph platform externalisation", () => {
  it("externalises exactly the package the server requires at runtime", () => {
    const codegraphEntries = (nextConfig.serverExternalPackages ?? []).filter((entry) =>
      entry.startsWith("@colbymchenry/codegraph"),
    );

    expect(codegraphEntries).toEqual([CODEGRAPH_PLATFORM_PACKAGE]);
  });

  it("agrees with the platform name the shared helper builds for this host", () => {
    // The SDK cannot call codegraphPlatformPackage — Turbopack has to fold its
    // require specifier, and a call it cannot fold becomes a throwing stub. So
    // this assertion is what keeps the two spellings honest.
    expect(CODEGRAPH_PLATFORM_PACKAGE).toBe(
      codegraphPlatformPackage(process.platform, process.arch),
    );
  });
});
