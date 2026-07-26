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

export type PreTradeContext = {
  kyc_ok: boolean;
  market_open: boolean;
  asset_tradable: boolean;
  cash_available: number; // minor XOF
  holdings_available: number;
  max_order_qty?: number;
};

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

  /**
   * Sans contexte : approuve si qty > 0 (compat Lot 1).
   * Avec contexte : contrôles KYC / marché / fonds / titres / limites.
   */
  async evaluatePreTrade(
    order: OrderRequested,
    context?: PreTradeContext,
  ): Promise<RiskDecision> {
    if (!context) {
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

    const reasons: string[] = [];
    const kyc_ok = context.kyc_ok;
    const market_open = context.market_open;
    const asset_tradable = context.asset_tradable;
    let funds_or_holdings_ok = true;
    let within_limits = true;

    if (order.qty <= 0) reasons.push("invalid_qty");
    if (!kyc_ok) reasons.push("kyc_required");
    if (!market_open) reasons.push("market_closed");
    if (!asset_tradable) reasons.push("asset_not_tradable");

    if (order.side === "buy") {
      // price_limit ou estimation fournie par l'appelant (ex. cotation sandbox)
      const px = order.price_limit;
      if (px === undefined || px <= 0) {
        funds_or_holdings_ok = false;
        reasons.push("price_required");
      } else if (context.cash_available < order.qty * px) {
        funds_or_holdings_ok = false;
        reasons.push("insufficient_funds");
      }
    } else if (context.holdings_available < order.qty) {
      funds_or_holdings_ok = false;
      reasons.push("insufficient_holdings");
    }

    if (
      context.max_order_qty !== undefined &&
      order.qty > context.max_order_qty
    ) {
      within_limits = false;
      reasons.push("qty_limit_exceeded");
    }

    const approved =
      reasons.length === 0 &&
      kyc_ok &&
      market_open &&
      asset_tradable &&
      funds_or_holdings_ok &&
      within_limits;

    return {
      client_order_id: order.client_order_id,
      approved,
      reasons,
      checks: {
        kyc_ok,
        market_open,
        asset_tradable,
        funds_or_holdings_ok,
        within_limits,
      },
    };
  }
}
