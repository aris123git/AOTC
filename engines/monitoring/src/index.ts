/**
 * Monitoring Engine — surveillance de marché (abus).
 * Consumer async de tous les événements — ne bloque jamais le matching.
 */

import { BaseEngine, type EngineContext } from "@aotc/core";
import { TOPICS } from "@aotc/contracts";

export class MonitoringEngine extends BaseEngine {
  readonly name = "monitoring";
  private unsubs: Array<() => Promise<void>> = [];
  private observed = 0;

  protected async onStart(ctx: EngineContext): Promise<void> {
    const topics = [
      TOPICS.ORDERS_ACCEPTED,
      TOPICS.TRADING_TRADE,
      TOPICS.TRADING_RESTED,
    ];
    for (const topic of topics) {
      const sub = await ctx.bus.subscribe(
        topic,
        async () => {
          this.observed += 1;
          // Détection wash/spoofing/layering : Lot ultérieur
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
}
