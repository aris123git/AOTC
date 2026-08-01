import { describe, expect, it } from "vitest";
import { InMemoryLeaderElection, InMemoryMessageBus } from "@aotc/message-bus";
import { NoOpDecisionEngine } from "@aotc/core";
import { DecisionEngine, RuleBasedDecisionEngine } from "../src/index.js";

describe("DecisionEngine", () => {
  it("accepte NoOp explicitement (compat Lot 1)", async () => {
    const bus = new InMemoryMessageBus();
    const engine = new DecisionEngine(new NoOpDecisionEngine());
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

  it("RuleBased émet spread + forecast ; anomaly si volume élevé", async () => {
    const rules = new RuleBasedDecisionEngine();
    await rules.observe("TradeExecuted", { asset_id: "ast_snts", qty: 250 });
    const signals = await rules.evaluate({});
    expect(signals.some((s) => s.kind === "spread_optimization")).toBe(true);
    expect(signals.some((s) => s.kind === "liquidity_forecast")).toBe(true);
    expect(signals.some((s) => s.kind === "anomaly")).toBe(true);

    const engine = new DecisionEngine();
    const bus = new InMemoryMessageBus();
    await engine.start({
      bus,
      leadership: new InMemoryLeaderElection(),
      replica_id: "decision-2",
      environment: "sandbox",
    });
    const defaults = await engine.evaluate({});
    expect(defaults.length).toBeGreaterThanOrEqual(2);
    await engine.stop();
  });
});
