/**
 * Settlement Engine — instructions RL T+3.
 * Consomme TradeExecuted ; ne connaît pas TradingEngine.
 */

import { BaseEngine, type EngineContext } from "@aotc/core";
import {
  TOPICS,
  createEnvelope,
  TradeExecutedSchema,
  type SettlementInstructed,
} from "@aotc/contracts";

export class SettlementEngine extends BaseEngine {
  readonly name = "settlement";
  private unsub: (() => Promise<void>) | null = null;
  private cycleDays = 3;

  protected async onStart(ctx: EngineContext): Promise<void> {
    const sub = await ctx.bus.subscribe(
      TOPICS.TRADING_TRADE,
      async (envelope) => {
        const trade = TradeExecutedSchema.parse(envelope.payload);
        const settlementDate = addDays(new Date(), this.cycleDays)
          .toISOString()
          .slice(0, 10);
        const instructed: SettlementInstructed = {
          settlement_id: crypto.randomUUID(),
          trade_id: trade.trade_id,
          asset_id: trade.asset_id,
          instrument_id: trade.instrument_id,
          qty: trade.qty,
          amount: trade.qty * trade.price,
          buyer_sgi_id: trade.buyer_sgi_id,
          seller_sgi_id: trade.seller_sgi_id,
          settlement_date: settlementDate,
          status: "instructed",
        };
        await ctx.bus.publish(
          TOPICS.SETTLEMENT_INSTRUCTED,
          createEnvelope({
            type: "SettlementInstructed",
            correlation_id: envelope.correlation_id,
            causation_id: envelope.message_id,
            environment: envelope.environment,
            payload: instructed,
          }),
        );
      },
      { consumer_group: "settlement", consumer_name: ctx.replica_id },
    );
    this.unsub = sub.unsubscribe;
  }

  protected async onStop(): Promise<void> {
    if (this.unsub) await this.unsub();
  }
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
