/**
 * Per-key FIFO chains for background work.
 *
 * Two tasks queued under the same key never overlap: each waits for the
 * previous one on that key to settle. Tasks under different keys are unrelated
 * and run in parallel.
 *
 * Failure is per task: a rejected task rejects *its own* promise and nothing
 * else — the key's queue keeps running, so a caller can let one run fail and
 * have the next one start on time (the failure never poisons the chain).
 *
 * A key holds no state once its chain has drained: the entry is dropped as soon
 * as the last queued task settles, so the next `runSerial` for that key starts a
 * fresh chain (and the map does not grow with every key ever used).
 */
const chains = new Map<string, Promise<unknown>>();

/**
 * Run `task` after everything already queued under `key`, and resolve with the
 * task's own result (a sync `task` may just return its value). The returned
 * promise rejects only if `task` does; the failure is observed here too, so an
 * ignored return value never surfaces as an unhandled rejection.
 */
export function runSerial<T>(key: string, task: () => T | Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  chains.set(key, next);

  // Release the key once this chain drains — unless a newer task has taken it
  // over in the meantime (then that task's own chain owns the entry).
  const release = () => {
    if (chains.get(key) === next) chains.delete(key);
  };
  void next.then(release, release);

  return next;
}

/** How many keys currently have a chain in flight. Exposed for tests / debugging. */
export function pendingChainCount(): number {
  return chains.size;
}
