/**
 * RuleBasedDecisionEngine — signaux déterministes (volume / spreads / liquidité).
 * N'importe aucun autre moteur ni client DB.
 */

import type {
  DecisionEnginePort,
  DecisionSignal,
} from "@aotc/core";

const HIGH_VOLUME_THRESHOLD = 200;

export class RuleBasedDecisionEngine implements DecisionEnginePort {
  private volumeByAsset = new Map<string, number>();

  async observe(eventType: string, payload: unknown): Promise<void> {
    if (eventType !== "TradeExecuted") return;
    const p = payload as { asset_id?: string; qty?: number };
    if (!p.asset_id || typeof p.qty !== "number") return;
    const prev = this.volumeByAsset.get(p.asset_id) ?? 0;
    this.volumeByAsset.set(p.asset_id, prev + p.qty);
  }

  async evaluate(context: Record<string, unknown> = {}): Promise<DecisionSignal[]> {
    const produced_at = new Date().toISOString();
    const signals: DecisionSignal[] = [];

    let topAsset: string | undefined;
    let topVol = 0;
    for (const [asset_id, vol] of this.volumeByAsset) {
      if (vol > topVol) {
        topVol = vol;
        topAsset = asset_id;
      }
    }

    if (topAsset && topVol >= HIGH_VOLUME_THRESHOLD) {
      signals.push({
        signal_id: crypto.randomUUID(),
        kind: "anomaly",
        subject: { asset_id: topAsset },
        score: Math.min(1, topVol / (HIGH_VOLUME_THRESHOLD * 5)),
        payload: {
          reason: "high_volume",
          volume: topVol,
          threshold: HIGH_VOLUME_THRESHOLD,
          ...context,
        },
        produced_at,
        actionable: true,
      });
    }

    signals.push({
      signal_id: crypto.randomUUID(),
      kind: "spread_optimization",
      subject: topAsset ? { asset_id: topAsset } : undefined,
      score: 0.6,
      payload: {
        suggestion: "tighten_spread_on_liquid_names",
        observed_volume: topVol,
        ...context,
      },
      produced_at,
      actionable: false,
    });

    signals.push({
      signal_id: crypto.randomUUID(),
      kind: "liquidity_forecast",
      subject: topAsset ? { asset_id: topAsset } : undefined,
      score: 0.55,
      payload: {
        horizon: "intraday",
        outlook: topVol >= HIGH_VOLUME_THRESHOLD ? "ample" : "stable",
        volume_observed: topVol,
        ...context,
      },
      produced_at,
      actionable: false,
    });

    return signals;
  }

  clear(): void {
    this.volumeByAsset.clear();
  }
}
