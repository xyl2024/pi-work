// The models-config data shapes now live in `lib/shared/models-config.ts` so
// the pure draft logic (`lib/shared/models-config-draft.ts`) can depend on them
// without importing from a component directory. This shim keeps the existing
// `./types` imports in the models-config components working.
export * from "@/lib/shared/models-config";
