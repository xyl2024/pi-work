const chains = new Map<string, Promise<unknown>>();

export function runSerial<T>(key: string, task: () => T | Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  chains.set(key, next);

  const release = () => {
    if (chains.get(key) === next) chains.delete(key);
  };
  void next.then(release, release);

  return next;
}

export function pendingChainCount(): number {
  return chains.size;
}
