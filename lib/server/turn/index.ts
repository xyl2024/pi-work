/**
 * The turn module: one seam for "deliver a prompt to an agent session and wait
 * until it has really finished" (see
 * `docs/adr/0004-turn-execution-has-one-seam-and-waits-for-agent-settled.md`).
 *
 * This barrel is the module's public surface. The pure terminal-state
 * judgement lives in `./outcome`; orchestration (`runTurn` / `watchSettled`)
 * joins it here in a later slice.
 */
export * from "./outcome";
