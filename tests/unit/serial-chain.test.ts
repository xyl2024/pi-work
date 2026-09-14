import { describe, expect, it } from "vitest";
import { pendingChainCount, runSerial } from "@/lib/server/serial-chain";

/** A promise whose settlement the test decides. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let queued microtasks and already-resolved promises run to their next step. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("runSerial", () => {
  it("runs one key's tasks in order, one at a time", async () => {
    const log: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const task = (name: string) => async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      log.push(`start ${name}`);
      await flush();
      log.push(`end ${name}`);
      inFlight -= 1;
    };

    await Promise.all([
      runSerial("a", task("one")),
      runSerial("a", task("two")),
      runSerial("a", task("three")),
    ]);

    expect(log).toEqual([
      "start one",
      "end one",
      "start two",
      "end two",
      "start three",
      "end three",
    ]);
    expect(maxInFlight).toBe(1);
  });

  it("holds a queued task until the running one settles", async () => {
    const gate = deferred();
    const order: string[] = [];

    const first = runSerial("a", async () => {
      order.push("first:start");
      await gate.promise;
      order.push("first:end");
    });
    const second = runSerial("a", () => {
      order.push("second:start");
    });

    await flush();
    expect(order).toEqual(["first:start"]);

    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("runs different keys in parallel", async () => {
    const gateA = deferred();
    const gateB = deferred();
    const started: string[] = [];

    const a = runSerial("a", async () => {
      started.push("a");
      await gateA.promise;
    });
    const b = runSerial("b", async () => {
      started.push("b");
      await gateB.promise;
    });

    await flush();
    expect(started).toEqual(["a", "b"]);
    expect(pendingChainCount()).toBe(2);

    gateA.resolve();
    gateB.resolve();
    await Promise.all([a, b]);
  });

  it("resolves with the task's own value, sync or async", async () => {
    await expect(runSerial("a", () => 42)).resolves.toBe(42);
    await expect(runSerial("a", async () => "text")).resolves.toBe("text");
  });
});

describe("runSerial failure", () => {
  it("rejects the failed task but keeps running the key's queue", async () => {
    const log: string[] = [];

    const failing = runSerial("a", async () => {
      log.push("first");
      throw new Error("boom");
    });
    const after = runSerial("a", () => {
      log.push("second");
      return "second";
    });

    await expect(failing).rejects.toThrow("boom");
    await expect(after).resolves.toBe("second");
    expect(log).toEqual(["first", "second"]);
  });

  it("keeps order across several failures instead of poisoning the key", async () => {
    const log: string[] = [];

    const first = runSerial("a", () => {
      log.push("first");
      throw new Error("boom one");
    });
    const second = runSerial("a", async () => {
      log.push("second");
      throw new Error("boom two");
    });
    const third = runSerial("a", () => {
      log.push("third");
    });

    await expect(first).rejects.toThrow("boom one");
    await expect(second).rejects.toThrow("boom two");
    await expect(third).resolves.toBeUndefined();
    expect(log).toEqual(["first", "second", "third"]);
  });

  it("does not let one key's failure affect another key", async () => {
    const failing = runSerial("a", () => {
      throw new Error("boom");
    });
    const other = runSerial("b", () => "ok");

    await expect(failing).rejects.toThrow("boom");
    await expect(other).resolves.toBe("ok");
  });

  it("swallows an ignored failure instead of raising an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      // Callers that only care about the queue (not this run's outcome) may
      // drop the returned promise entirely.
      void runSerial("a", () => {
        throw new Error("boom");
      });
      await flush();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toEqual([]);
  });
});

describe("runSerial chain release", () => {
  it("drops the key once its chain has drained", async () => {
    expect(pendingChainCount()).toBe(0);

    const gate = deferred();
    const running = runSerial("a", () => gate.promise);
    expect(pendingChainCount()).toBe(1);

    gate.resolve();
    await running;
    await flush();
    expect(pendingChainCount()).toBe(0);
  });

  it("drops a key whose last task rejected", async () => {
    const failing = runSerial("a", async () => {
      throw new Error("boom");
    });
    expect(pendingChainCount()).toBe(1);

    await expect(failing).rejects.toThrow("boom");
    await flush();
    expect(pendingChainCount()).toBe(0);
  });

  it("keeps counting while a successor is still queued", async () => {
    const firstGate = deferred();
    const secondGate = deferred();
    const first = runSerial("a", () => firstGate.promise);
    const second = runSerial("a", () => secondGate.promise);

    firstGate.resolve();
    await first;
    await flush();
    // The drained first task must not drop the key the second one now owns.
    expect(pendingChainCount()).toBe(1);

    secondGate.resolve();
    await second;
    await flush();
    expect(pendingChainCount()).toBe(0);
  });

  it("starts a fresh chain for a key that has already drained", async () => {
    const log: string[] = [];
    await runSerial("a", () => {
      log.push("first");
    });

    const gate = deferred();
    const second = runSerial("a", () => {
      log.push("second");
      return gate.promise;
    });

    await flush();
    expect(log).toEqual(["first", "second"]);

    gate.resolve();
    await second;
    await flush();
    expect(pendingChainCount()).toBe(0);
  });
});
