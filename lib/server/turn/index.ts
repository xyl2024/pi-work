/**
 * The turn module: one seam for "deliver a prompt to an agent session and wait
 * until it has really finished" (see
 * `docs/adr/0004-turn-execution-has-one-seam-and-waits-for-agent-settled.md`).
 *
 * This barrel is the module's public surface:
 *  - `./outcome`      — the pure terminal-state judgement;
 *  - `./orchestrate`  — `runTurn` / `watchSettled`, the active orchestration
 *    over a session factory dependency.
 */
export * from "./outcome";
export * from "./orchestrate";
