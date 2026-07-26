/**
 * Market Data Service — publication ticks / candles.
 * Source `exchange_official` vs `aotc_computed` (pas de hardcode BRVM dans le domaine).
 */

import { BaseEngine, type EngineContext } from "@aotc/core";
import { TOPICS, createEnvelope, type PriceTick } from "@aotc/contracts";

export class MarketDataEngine extends BaseEngine {
  readonly name = "marketdata";

  protected async onStart(_ctx: EngineContext): Promise<void> {}
  protected async onStop(): Promise<void> {}

  async publishTick(tick: PriceTick, correlationId: string): Promise<void> {
    if (!this.ctx) throw new Error("MarketDataEngine not started");
    await this.ctx.bus.publish(
      TOPICS.MARKETDATA_TICK,
      createEnvelope({
        type: "PriceTick",
        correlation_id: correlationId,
        environment: this.ctx.environment,
        payload: tick,
      }),
    );
  }
}
