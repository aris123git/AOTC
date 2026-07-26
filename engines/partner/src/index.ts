/**
 * Partner Management Engine — agrégation stats SGI.
 */

import { BaseEngine, type EngineContext } from "@aotc/core";
import {
  TOPICS,
  TradeExecutedSchema,
  type PartnerStatsUpdated,
} from "@aotc/contracts";

/** Commission : 10 bps du notionnel, acheteur et vendeur. */
const COMMISSION_BPS = 10;

type SgiStats = {
  volume: number;
  commissions: number;
  fills: number;
  fill_qty: number;
  order_qty: number;
};

export class PartnerEngine extends BaseEngine {
  readonly name = "partner";
  private unsub: (() => Promise<void>) | null = null;
  private bySgi = new Map<string, SgiStats>();

  protected async onStart(ctx: EngineContext): Promise<void> {
    const sub = await ctx.bus.subscribe(
      TOPICS.TRADING_TRADE,
      async (envelope) => {
        const trade = TradeExecutedSchema.parse(envelope.payload);
        const notional = trade.qty * trade.price;
        const commission = Math.floor((notional * COMMISSION_BPS) / 10_000);
        this.addFill(trade.buyer_sgi_id, notional, commission, trade.qty);
        this.addFill(trade.seller_sgi_id, notional, commission, trade.qty);
      },
      { consumer_group: "partner", consumer_name: ctx.replica_id },
    );
    this.unsub = sub.unsubscribe;
  }

  protected async onStop(): Promise<void> {
    if (this.unsub) await this.unsub();
  }

  private ensure(sgiId: string): SgiStats {
    let s = this.bySgi.get(sgiId);
    if (!s) {
      s = { volume: 0, commissions: 0, fills: 0, fill_qty: 0, order_qty: 0 };
      this.bySgi.set(sgiId, s);
    }
    return s;
  }

  private addFill(
    sgiId: string,
    notional: number,
    commission: number,
    qty: number,
  ): void {
    const s = this.ensure(sgiId);
    s.volume += notional;
    s.commissions += commission;
    s.fills += 1;
    s.fill_qty += qty;
  }

  /** Enregistrement basique d'un ordre placé (fill-rate). */
  recordOrder(sgiId: string, qty: number): void {
    const s = this.ensure(sgiId);
    s.order_qty += qty;
  }

  clear(): void {
    this.bySgi.clear();
  }

  snapshot(sgiId: string, period: string): PartnerStatsUpdated {
    const s = this.bySgi.get(sgiId);
    const commissions = s?.commissions ?? 0;
    const fill_rate =
      s && s.order_qty > 0 ? s.fill_qty / s.order_qty : s && s.fills > 0 ? 1 : 0;
    return {
      sgi_id: sgiId,
      period,
      volume_brought: s?.volume ?? 0,
      revenue_generated: commissions,
      commissions,
      market_share_bps: 0,
      performance: {
        fill_rate,
        avg_execution_ms: 0,
      },
      updated_at: new Date().toISOString(),
    };
  }
}
