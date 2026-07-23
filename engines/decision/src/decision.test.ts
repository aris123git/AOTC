import { describe, expect, it } from "vitest";
import { InMemoryLeaderElection, InMemoryMessageBus } from "@aotc/message-bus";
import { DecisionEngine } from "../src/index.js";

describe("DecisionEngine", () => {
  it("démarre, observe, et n'émet aucun signal (no-op MVP)", async () => {
    const bus = new InMemoryMessageBus();
    const engine = new DecisionEngine();
    await engine.start({
      bus,
      leadership: new InMemoryLeaderElection(),
      replica_id: "decision-1",
      environment: "sandbox",
    });

    const signals = await engine.evaluate({ context: "smoke" });
    expect(signals).toEqual([]);
    expect(await engine.health()).toBe("up");
    await engine.stop();
  });
});
