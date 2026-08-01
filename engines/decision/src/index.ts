/**
 * Decision Engine — RÈGLE #6.
 * Défaut Lot 2 : RuleBasedDecisionEngine (NoOp toujours exporté).
 */

import {
  BaseEngine,
  NoOpDecisionEngine,
  type DecisionEnginePort,
  type DecisionSignal,
  type EngineContext,
} from "@aotc/core";
import { TOPICS, createEnvelope, DecisionSignalSchema } from "@aotc/contracts";
import { RuleBasedDecisionEngine } from "./rules.js";

export class DecisionEngine extends BaseEngine {
  readonly name = "decision";
  private readonly port: DecisionEnginePort;
  private unsubs: Array<() => Promise<void>> = [];
  private lastSignals: DecisionSignal[] = [];

  constructor(port: DecisionEnginePort = new RuleBasedDecisionEngine()) {
    super();
    this.port = port;
  }

  protected async onStart(ctx: EngineContext): Promise<void> {
    const topics = [
      TOPICS.TRADING_TRADE,
      TOPICS.ORDERS_ACCEPTED,
      TOPICS.LIQUIDITY_DECISION,
      TOPICS.MONITORING_ALERT,
    ];
    for (const topic of topics) {
      const sub = await ctx.bus.subscribe(
        topic,
        async (envelope) => {
          await this.port.observe(envelope.type, envelope.payload);
        },
        { consumer_group: "decision", consumer_name: ctx.replica_id },
      );
      this.unsubs.push(sub.unsubscribe);
    }
  }

  protected async onStop(): Promise<void> {
    for (const u of this.unsubs) await u();
    this.unsubs = [];
  }

  async evaluate(context: Record<string, unknown> = {}): Promise<DecisionSignal[]> {
    const signals = await this.port.evaluate(context);
    this.lastSignals = signals;
    if (!this.ctx || signals.length === 0) return signals;

    for (const signal of signals) {
      const payload = DecisionSignalSchema.parse({
        ...signal,
        produced_at: signal.produced_at ?? new Date().toISOString(),
      });
      await this.ctx.bus.publish(
        TOPICS.DECISION_SIGNAL,
        createEnvelope({
          type: "DecisionSignal",
          correlation_id: crypto.randomUUID(),
          environment: this.ctx.environment,
          payload,
        }),
      );
    }
    return signals;
  }

  signals(): DecisionSignal[] {
    return [...this.lastSignals];
  }
}

export { NoOpDecisionEngine, RuleBasedDecisionEngine };
