/**
 * Risk Engine — contrôles pré/post-trade.
 * Ne connaît pas Trading / Liquidity : publie RiskDecision sur le bus.
 */

import { BaseEngine, type EngineContext } from "@aotc/core";
import {
  TOPICS,
  createEnvelope,
  OrderRequestedSchema,
  type OrderRequested,
  type RiskDecision,
} from "@aotc/contracts";

export class RiskEngine extends BaseEngine {
  readonly name = "risk";
  private unsub: (() => Promise<void>) | null = null;

  protected async onStart(ctx: EngineContext): Promise<void> {
    const sub = await ctx.bus.subscribe(
      TOPICS.ORDERS_REQUESTED,
      async (envelope) => {
        const order = OrderRequestedSchema.parse(envelope.payload);
        const decision = await this.evaluatePreTrade(order);
        await ctx.bus.publish(
          TOPICS.RISK_DECISION,
          createEnvelope({
            type: "RiskDecision",
            correlation_id: envelope.correlation_id,
            causation_id: envelope.message_id,
            environment: envelope.environment,
            payload: decision,
            tenant: { sgi_id: order.sgi_id },
          }),
        );
      },
      { consumer_group: "risk", consumer_name: ctx.replica_id },
    );
    this.unsub = sub.unsubscribe;
  }

  protected async onStop(): Promise<void> {
    if (this.unsub) await this.unsub();
  }

  /** Squelette MVP : approuve si qty > 0 (contrôles réels Lot 1+). */
  async evaluatePreTrade(order: OrderRequested): Promise<RiskDecision> {
    const ok = order.qty > 0;
    return {
      client_order_id: order.client_order_id,
      approved: ok,
      reasons: ok ? [] : ["invalid_qty"],
      checks: {
        kyc_ok: true,
        market_open: true,
        asset_tradable: true,
        funds_or_holdings_ok: true,
        within_limits: true,
      },
    };
  }
}
