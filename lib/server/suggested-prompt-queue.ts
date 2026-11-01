export interface SuggestionQueue {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  active(): number;
  pending(): number;
}

export function createSuggestionQueue(limit: number): SuggestionQueue {
  const max = Math.max(1, limit);
  const inFlight = new Map<string, Promise<unknown>>();
  const waiting: Array<() => void> = [];
  let activeCount = 0;

  const acquire = (): Promise<void> => {
    if (activeCount < max) {
      activeCount += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => waiting.push(resolve));
  };

  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else activeCount -= 1;
  };

  const run = <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const existing = inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = (async () => {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    })();

    inFlight.set(key, promise);
    const clear = () => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    };
    promise.then(clear, clear);
    return promise;
  };

  return {
    run,
    active: () => activeCount,
    pending: () => waiting.length,
  };
}

export const suggestedPromptQueue = createSuggestionQueue(2);
