/**
 * Monitoring Engine — surveillance de marché (abus).
 * Consumer async — ne bloque jamais le matching.
 */

import { BaseEngine, type EngineContext } from "@aotc/core";
import {
  TOPICS,
  OrderAcceptedSchema,
  OrderRestedSchema,
  TradeExecutedSchema,
  type MarketAbuseAlert,
} from "@aotc/contracts";

const UNUSUAL_VOLUME_QTY = 500;
const WASH_WINDOW_MS = 60_000;
const SPOOF_WINDOW_MS = 5_000;
const SPOOF_MIN_QTY = 100;
const LAYERING_LEVELS = 3;

type UserSideHit = { side: "buy" | "sell"; at: number };
type RestedTrack = {
  order_id: string;
  asset_id?: string;
  user_id?: string;
  sgi_id?: string;
  qty: number;
  rested_at: number;
};
type LayerKey = string; // user|asset|side

export class MonitoringEngine extends BaseEngine {
  readonly name = "monitoring";
  private unsubs: Array<() => Promise<void>> = [];
  private observed = 0;
  private storedAlerts: MarketAbuseAlert[] = [];

  private orderMeta = new Map<
    string,
    { user_id: string; sgi_id: string; asset_id: string; side: "buy" | "sell" }
  >();
  private recentSides = new Map<string, UserSideHit[]>(); // user|asset
  private rested = new Map<string, RestedTrack>();
  private layerCounts = new Map<LayerKey, Set<string>>(); // levels by price or order_id

  protected async onStart(ctx: EngineContext): Promise<void> {
    const topics = [
      TOPICS.ORDERS_ACCEPTED,
      TOPICS.TRADING_TRADE,
      TOPICS.TRADING_RESTED,
      TOPICS.TRADING_MATCHED,
    ];
    for (const topic of topics) {
      const sub = await ctx.bus.subscribe(
        topic,
        async (envelope) => {
          this.observed += 1;
          if (topic === TOPICS.ORDERS_ACCEPTED) {
            this.onOrderAccepted(envelope.payload);
          } else if (topic === TOPICS.TRADING_TRADE) {
            this.onTrade(envelope.payload);
          } else if (topic === TOPICS.TRADING_RESTED) {
            this.onRested(envelope.payload);
          } else if (topic === TOPICS.TRADING_MATCHED) {
            this.onMatchedOrRemoved(envelope.payload);
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

  /** Signale une annulation rapide (appelé par l'orchestrateur si pas d'événement bus). */
  noteOrderRemoved(orderId: string): void {
    const track = this.rested.get(orderId);
    if (!track) return;
    const elapsed = Date.now() - track.rested_at;
    if (track.qty >= SPOOF_MIN_QTY && elapsed <= SPOOF_WINDOW_MS) {
      this.storedAlerts.push({
        alert_id: crypto.randomUUID(),
        asset_id: track.asset_id,
        sgi_id: track.sgi_id,
        user_id: track.user_id,
        pattern: "spoofing",
        severity: "high",
        evidence: {
          order_id: orderId,
          qty: track.qty,
          lived_ms: elapsed,
          threshold_ms: SPOOF_WINDOW_MS,
        },
        detected_at: new Date().toISOString(),
      });
    }
    this.rested.delete(orderId);
  }

  private onOrderAccepted(payload: unknown): void {
    const parsed = OrderAcceptedSchema.safeParse(payload);
    if (!parsed.success) return;
    const o = parsed.data;
    this.orderMeta.set(o.order_id, {
      user_id: o.user_id,
      sgi_id: o.sgi_id,
      asset_id: o.asset_id,
      side: o.side,
    });

    const key = `${o.user_id}|${o.asset_id}`;
    const hits = this.recentSides.get(key) ?? [];
    const now = Date.now();
    hits.push({ side: o.side, at: now });
    const fresh = hits.filter((h) => now - h.at <= WASH_WINDOW_MS);
    this.recentSides.set(key, fresh);
    const hasBuy = fresh.some((h) => h.side === "buy");
    const hasSell = fresh.some((h) => h.side === "sell");
    if (hasBuy && hasSell) {
      this.storedAlerts.push({
        alert_id: crypto.randomUUID(),
        asset_id: o.asset_id,
        sgi_id: o.sgi_id,
        user_id: o.user_id,
        pattern: "wash_trading",
        severity: "high",
        evidence: {
          window_ms: WASH_WINDOW_MS,
          sides: fresh.map((h) => h.side),
          order_id: o.order_id,
        },
        detected_at: new Date().toISOString(),
      });
      this.recentSides.set(key, []);
    }

    // Layering simplifié : ≥3 ordres acceptés même côté / même user / même asset
    const layerKey = `${o.user_id}|${o.asset_id}|${o.side}`;
    let set = this.layerCounts.get(layerKey);
    if (!set) {
      set = new Set();
      this.layerCounts.set(layerKey, set);
    }
    set.add(o.order_id);
    if (set.size >= LAYERING_LEVELS) {
      this.storedAlerts.push({
        alert_id: crypto.randomUUID(),
        asset_id: o.asset_id,
        sgi_id: o.sgi_id,
        user_id: o.user_id,
        pattern: "layering",
        severity: "medium",
        evidence: {
          side: o.side,
          levels: set.size,
          order_ids: [...set],
        },
        detected_at: new Date().toISOString(),
      });
      set.clear();
    }
  }

  private onTrade(payload: unknown): void {
    const trade = TradeExecutedSchema.safeParse(payload);
    if (!trade.success) return;

    if (trade.data.qty >= UNUSUAL_VOLUME_QTY) {
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

    const buyMeta = this.orderMeta.get(trade.data.buy_order_id);
    const sellMeta = this.orderMeta.get(trade.data.sell_order_id);
    if (
      buyMeta &&
      sellMeta &&
      buyMeta.user_id === sellMeta.user_id &&
      buyMeta.user_id
    ) {
      this.storedAlerts.push({
        alert_id: crypto.randomUUID(),
        asset_id: trade.data.asset_id,
        sgi_id: buyMeta.sgi_id,
        user_id: buyMeta.user_id,
        pattern: "wash_trading",
        severity: "critical",
        evidence: {
          trade_id: trade.data.trade_id,
          buy_order_id: trade.data.buy_order_id,
          sell_order_id: trade.data.sell_order_id,
        },
        detected_at: new Date().toISOString(),
      });
    }
  }

  private onRested(payload: unknown): void {
    const rested = OrderRestedSchema.safeParse(payload);
    if (!rested.success) return;
    const meta = this.orderMeta.get(rested.data.order_id);
    this.rested.set(rested.data.order_id, {
      order_id: rested.data.order_id,
      asset_id: meta?.asset_id,
      user_id: meta?.user_id,
      sgi_id: meta?.sgi_id,
      qty: rested.data.qty_remaining,
      rested_at: Date.now(),
    });
  }

  private onMatchedOrRemoved(payload: unknown): void {
    const p = payload as { order_id?: string; qty_remaining?: number };
    if (!p.order_id) return;
    if (typeof p.qty_remaining === "number" && p.qty_remaining === 0) {
      // Rempli entièrement — pas du spoofing
      this.rested.delete(p.order_id);
    }
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
    this.orderMeta.clear();
    this.recentSides.clear();
    this.rested.clear();
    this.layerCounts.clear();
  }
}
