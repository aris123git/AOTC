/**
 * Liquidity Engine — décide *quand* intervenir (pas *avec quels fonds* → Treasury).
 * Communication uniquement via contrats / bus.
 */

import { BaseEngine, type EngineContext } from "@aotc/core";
import {
  TOPICS,
  createEnvelope,
  LiquidityInterventionRequestedSchema,
  type LiquidityDecision,
} from "@aotc/contracts";

const DEFAULT_MAX_PER_ASSET = 50_000;
const DEFAULT_MAX_GLOBAL = 200_000;
/** Inventaire synthétique sandbox si l'actif n'a pas encore été seedé. */
const DEFAULT_SEED_INVENTORY = 10_000;

export type LiquidityDecideOpts = {
  asset_id: string;
  side: "buy" | "sell";
  sector?: string;
};

export class LiquidityEngine extends BaseEngine {
  readonly name = "liquidity";
  private unsub: (() => Promise<void>) | null = null;
  private mode: "SGI_PARTNER" | "AOTC_PRINCIPAL" = "SGI_PARTNER";
  private inventory = new Map<string, number>();
  private maxPerAsset = DEFAULT_MAX_PER_ASSET;
  private maxGlobal = DEFAULT_MAX_GLOBAL;

  protected async onStart(ctx: EngineContext): Promise<void> {
    const sub = await ctx.bus.subscribe(
      TOPICS.LIQUIDITY_INTERVENTION_REQUESTED,
      async (envelope) => {
        const req = LiquidityInterventionRequestedSchema.parse(envelope.payload);
        const decision = await this.decide(req.qty, {
          asset_id: req.asset_id,
          side: req.side,
        });
        await ctx.bus.publish(
          TOPICS.LIQUIDITY_DECISION,
          createEnvelope({
            type: "LiquidityDecision",
            correlation_id: envelope.correlation_id,
            causation_id: envelope.message_id,
            environment: envelope.environment,
            payload: decision,
          }),
        );
      },
      { consumer_group: "liquidity", consumer_name: ctx.replica_id },
    );
    this.unsub = sub.unsubscribe;
  }

  protected async onStop(): Promise<void> {
    if (this.unsub) await this.unsub();
  }

  getMode(): "SGI_PARTNER" | "AOTC_PRINCIPAL" {
    return this.mode;
  }

  setMode(mode: "SGI_PARTNER" | "AOTC_PRINCIPAL"): void {
    this.mode = mode;
  }

  getInventory(assetId: string): number {
    return this.inventory.get(assetId) ?? 0;
  }

  seedInventory(assetId: string, qty: number): void {
    this.inventory.set(assetId, Math.max(0, Math.floor(qty)));
  }

  /**
   * Sans opts : comportement Lot 1 (approuve si qty > 0).
   * Avec opts : contrôles inventaire / exposition.
   */
  async decide(
    qty: number,
    opts?: LiquidityDecideOpts,
  ): Promise<LiquidityDecision> {
    if (!opts) {
      return {
        approved: qty > 0,
        reasons: qty > 0 ? [] : ["zero_qty"],
        liquidity_mode: this.mode,
      };
    }

    if (qty <= 0) {
      return {
        approved: false,
        reasons: ["zero_qty"],
        liquidity_mode: this.mode,
      };
    }

    const { asset_id, side } = opts;

    // Intervention acheteur (prend la vente de l'investisseur) → +inventaire
    if (side === "buy") {
      const current = this.ensureInventory(asset_id);
      const afterAsset = current + qty;
      const afterGlobal = this.globalInventory() - current + afterAsset;
      if (afterAsset > this.maxPerAsset) {
        return {
          approved: false,
          reasons: ["asset_exposure_limit"],
          exposure_after: {
            by_asset: afterAsset,
            by_sgi: afterAsset,
            by_sector: afterAsset,
            global: afterGlobal,
          },
          liquidity_mode: this.mode,
        };
      }
      if (afterGlobal > this.maxGlobal) {
        return {
          approved: false,
          reasons: ["global_exposure_limit"],
          exposure_after: {
            by_asset: afterAsset,
            by_sgi: afterAsset,
            by_sector: afterAsset,
            global: afterGlobal,
          },
          liquidity_mode: this.mode,
        };
      }
      this.inventory.set(asset_id, afterAsset);
      return {
        approved: true,
        reasons: [],
        exposure_after: {
          by_asset: afterAsset,
          by_sgi: afterAsset,
          by_sector: afterAsset,
          global: afterGlobal,
        },
        liquidity_mode: this.mode,
      };
    }

    // Intervention vendeur (fournit titres à l'acheteur) → −inventaire
    const available = this.ensureInventory(asset_id);
    if (available < qty) {
      return {
        approved: false,
        reasons: ["insufficient_inventory"],
        exposure_after: {
          by_asset: available,
          by_sgi: available,
          by_sector: available,
          global: this.globalInventory(),
        },
        liquidity_mode: this.mode,
      };
    }
    const afterAsset = available - qty;
    this.inventory.set(asset_id, afterAsset);
    const afterGlobal = this.globalInventory();
    return {
      approved: true,
      reasons: [],
      exposure_after: {
        by_asset: afterAsset,
        by_sgi: afterAsset,
        by_sector: afterAsset,
        global: afterGlobal,
      },
      liquidity_mode: this.mode,
    };
  }

  /** Seed synthétique à la première touche si absent. */
  private ensureInventory(assetId: string): number {
    if (!this.inventory.has(assetId)) {
      this.inventory.set(assetId, DEFAULT_SEED_INVENTORY);
    }
    return this.inventory.get(assetId) ?? 0;
  }

  private globalInventory(): number {
    let sum = 0;
    for (const q of this.inventory.values()) sum += q;
    return sum;
  }
}
