/**
 * Pricing Engine — isole le calcul de spread du Matching (Règle #2).
 */

import { BaseEngine, type EngineContext } from "@aotc/core";
import type { QuoteRequested, QuoteProvided } from "@aotc/contracts";

export class PricingEngine extends BaseEngine {
  readonly name = "pricing";

  protected async onStart(_ctx: EngineContext): Promise<void> {
    /* cotation sync exposée via quote() — pub async Lot 1+ */
  }

  protected async onStop(): Promise<void> {}

  async quote(req: QuoteRequested, referencePrice: number, tickSize: number): Promise<QuoteProvided> {
    const spread_bps = 50; // placeholder — Decision Engine pourra optimiser plus tard
    const delta = Math.round((referencePrice * spread_bps) / 10_000);
    let price =
      req.side === "buy" ? referencePrice + delta : referencePrice - delta;
    price = Math.round(price / tickSize) * tickSize;

    return {
      asset_id: req.asset_id,
      instrument_id: req.instrument_id,
      reference_price: referencePrice,
      spread_bps,
      price,
      side: req.side,
      factors: {
        liquidity_factor: 1,
        volatility_factor: 1,
        risk_factor: 1,
        session_factor: 1,
      },
      valid_until: new Date(Date.now() + 5_000).toISOString(),
    };
  }
}
