/**
 * Liquidity Engine — décide *quand* intervenir (pas *avec quels fonds* → Treasury).
 * Communication uniquement via contrats / bus.
 */

import { BaseEngine, type EngineContext } from "@aotc/core";
import {
  TOPICS,
  createEnvelope,
  LiquidityInterventionRequestedSchema,
  type LiquidityDecision,
} from "@aotc/contracts";

export class LiquidityEngine extends BaseEngine {
  readonly name = "liquidity";
  private unsub: (() => Promise<void>) | null = null;
  private mode: "SGI_PARTNER" | "AOTC_PRINCIPAL" = "SGI_PARTNER";

  protected async onStart(ctx: EngineContext): Promise<void> {
    const sub = await ctx.bus.subscribe(
      TOPICS.LIQUIDITY_INTERVENTION_REQUESTED,
      async (envelope) => {
        const req = LiquidityInterventionRequestedSchema.parse(envelope.payload);
        const decision = await this.decide(req.qty);
        await ctx.bus.publish(
          TOPICS.LIQUIDITY_DECISION,
          createEnvelope({
            type: "LiquidityDecision",
            correlation_id: envelope.correlation_id,
            causation_id: envelope.message_id,
            environment: envelope.environment,
            payload: decision,
          }),
        );
      },
      { consumer_group: "liquidity", consumer_name: ctx.replica_id },
    );
    this.unsub = sub.unsubscribe;
  }

  protected async onStop(): Promise<void> {
    if (this.unsub) await this.unsub();
  }

  async decide(qty: number): Promise<LiquidityDecision> {
    return {
      approved: qty > 0,
      reasons: qty > 0 ? [] : ["zero_qty"],
      liquidity_mode: this.mode,
    };
  }
}
