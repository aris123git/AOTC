/**
 * Pricing Engine — isole le calcul de spread du Matching (Règle #2).
 */

import { BaseEngine, type EngineContext } from "@aotc/core";
import type { QuoteRequested, QuoteProvided } from "@aotc/contracts";

export type QuoteFactors = {
  volatility?: number;
  liquidity?: number;
  risk?: number;
  session?: number;
};

function sessionFactorFromClock(now = new Date()): number {
  const h = now.getUTCHours();
  // Session UEMOA approximative (UTC) : ouverture 0.85, cœur 1.0, fin 1.15
  if (h < 8 || h >= 18) return 1.2;
  if (h < 10) return 0.9;
  if (h >= 16) return 1.1;
  return 1.0;
}

export class PricingEngine extends BaseEngine {
  readonly name = "pricing";

  protected async onStart(_ctx: EngineContext): Promise<void> {
    /* cotation sync exposée via quote() */
  }

  protected async onStop(): Promise<void> {}

  async quote(
    req: QuoteRequested,
    referencePrice: number,
    tickSize: number,
    factors?: QuoteFactors,
  ): Promise<QuoteProvided> {
    const volatility_factor = factors?.volatility ?? 1;
    const liquidity_factor = factors?.liquidity ?? clamp(
      1 + Math.log10(Math.max(1, req.qty)) / 10,
      0.8,
      1.4,
    );
    const risk_factor = factors?.risk ?? 1;
    const session_factor = factors?.session ?? sessionFactorFromClock();

    // Spread dynamique 30–120 bps
    const raw =
      50 *
      volatility_factor *
      liquidity_factor *
      risk_factor *
      session_factor;
    const spread_bps = Math.round(clamp(raw, 30, 120));

    const delta = Math.round((referencePrice * spread_bps) / 10_000);
    let price =
      req.side === "buy" ? referencePrice + delta : referencePrice - delta;
    price = Math.round(price / tickSize) * tickSize;
    if (price < tickSize) price = tickSize;

    return {
      asset_id: req.asset_id,
      instrument_id: req.instrument_id,
      reference_price: referencePrice,
      spread_bps,
      price,
      side: req.side,
      factors: {
        liquidity_factor,
        volatility_factor,
        risk_factor,
        session_factor,
      },
      valid_until: new Date(Date.now() + 5_000).toISOString(),
    };
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
