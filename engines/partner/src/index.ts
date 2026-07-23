/**
 * Partner Management Engine — agrégation stats SGI.
 */

import { BaseEngine, type EngineContext } from "@aotc/core";
import {
  TOPICS,
  TradeExecutedSchema,
  type PartnerStatsUpdated,
} from "@aotc/contracts";

export class PartnerEngine extends BaseEngine {
  readonly name = "partner";
  private unsub: (() => Promise<void>) | null = null;
  private volumeBySgi = new Map<string, number>();

  protected async onStart(ctx: EngineContext): Promise<void> {
    const sub = await ctx.bus.subscribe(
      TOPICS.TRADING_TRADE,
      async (envelope) => {
        const trade = TradeExecutedSchema.parse(envelope.payload);
        const notional = trade.qty * trade.price;
        this.add(trade.buyer_sgi_id, notional);
        this.add(trade.seller_sgi_id, notional);
      },
      { consumer_group: "partner", consumer_name: ctx.replica_id },
    );
    this.unsub = sub.unsubscribe;
  }

  protected async onStop(): Promise<void> {
    if (this.unsub) await this.unsub();
  }

  private add(sgiId: string, notional: number): void {
    this.volumeBySgi.set(sgiId, (this.volumeBySgi.get(sgiId) ?? 0) + notional);
  }

  snapshot(sgiId: string, period: string): PartnerStatsUpdated {
    return {
      sgi_id: sgiId,
      period,
      volume_brought: this.volumeBySgi.get(sgiId) ?? 0,
      revenue_generated: 0,
      commissions: 0,
      market_share_bps: 0,
      performance: { fill_rate: 0, avg_execution_ms: 0 },
      updated_at: new Date().toISOString(),
    };
  }
}
