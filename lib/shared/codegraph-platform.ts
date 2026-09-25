/**
 * Which CodeGraph bundle package belongs to which platform.
 *
 * `@colbymchenry/codegraph` is a thin wrapper; the compiled library ships as
 * one package per platform+arch (`@colbymchenry/codegraph-<platform>-<arch>`)
 * and is reached by bare specifier at runtime. Two places have to agree on
 * that name or the app breaks in a way that only shows up on the *other*
 * platform:
 *
 *   - `next.config.ts` externalises it, so the bundle's tree-sitter wasm
 *     loaders never enter the webpack graph;
 *   - `lib/server/codegraph-sdk.ts` requires it at runtime.
 *
 * A hardcoded `…-linux-x64` in the first one and a computed name in the second
 * is exactly how a Windows install ends up bundling the Linux package. So the
 * name is written from one documented pattern, here.
 *
 * The SDK still spells that pattern out inline instead of calling this
 * function: Turbopack folds `process.platform`/`process.arch` into the template
 * literal that builds its require specifier, and a call it cannot fold turns
 * that require into a stub that throws. `tests/unit/codegraph-externals.test.ts`
 * is what keeps the two spellings from drifting apart.
 *
 * The platform is an explicit argument — this module never reads
 * `process.platform` (ADR-0003 rule 3), which is what lets the Windows branch
 * be unit-tested from any host.
 */
export function codegraphPlatformPackage(platform: string, arch: string): string {
  return `@colbymchenry/codegraph-${platform}-${arch}`;
}
