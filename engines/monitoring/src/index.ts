/**
 * Monitoring Engine — surveillance de marché (abus).
 * Consumer async de tous les événements — ne bloque jamais le matching.
 */

import { BaseEngine, type EngineContext } from "@aotc/core";
import {
  TOPICS,
  TradeExecutedSchema,
  type MarketAbuseAlert,
} from "@aotc/contracts";

const UNUSUAL_VOLUME_QTY = 500;

export class MonitoringEngine extends BaseEngine {
  readonly name = "monitoring";
  private unsubs: Array<() => Promise<void>> = [];
  private observed = 0;
  private storedAlerts: MarketAbuseAlert[] = [];

  protected async onStart(ctx: EngineContext): Promise<void> {
    const topics = [
      TOPICS.ORDERS_ACCEPTED,
      TOPICS.TRADING_TRADE,
      TOPICS.TRADING_RESTED,
    ];
    for (const topic of topics) {
      const sub = await ctx.bus.subscribe(
        topic,
        async (envelope) => {
          this.observed += 1;
          if (topic === TOPICS.TRADING_TRADE) {
            const trade = TradeExecutedSchema.safeParse(envelope.payload);
            if (trade.success && trade.data.qty >= UNUSUAL_VOLUME_QTY) {
              this.storedAlerts.push({
                alert_id: crypto.randomUUID(),
                asset_id: trade.data.asset_id,
                sgi_id: trade.data.buyer_sgi_id,
                pattern: "unusual_volume",
                severity: trade.data.qty >= 2_000 ? "high" : "medium",
                evidence: {
                  trade_id: trade.data.trade_id,
                  qty: trade.data.qty,
                  price: trade.data.price,
                  threshold: UNUSUAL_VOLUME_QTY,
                },
                detected_at: new Date().toISOString(),
              });
            }
          }
        },
        { consumer_group: "monitoring", consumer_name: ctx.replica_id },
      );
      this.unsubs.push(sub.unsubscribe);
    }
  }

  protected async onStop(): Promise<void> {
    for (const u of this.unsubs) await u();
    this.unsubs = [];
  }

  observedCount(): number {
    return this.observed;
  }

  alerts(): MarketAbuseAlert[] {
    return [...this.storedAlerts];
  }

  clear(): void {
    this.storedAlerts = [];
    this.observed = 0;
  }
}
