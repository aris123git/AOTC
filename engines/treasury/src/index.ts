/**
 * Treasury Engine — gère *avec quels fonds* (séparé de Liquidity).
 */

import { BaseEngine, type EngineContext } from "@aotc/core";
import type { FundsReservationRequested, FundsReserved } from "@aotc/contracts";

export class TreasuryEngine extends BaseEngine {
  readonly name = "treasury";
  private available = 1_000_000_000; // minor units XOF — sandbox seed

  protected async onStart(_ctx: EngineContext): Promise<void> {}
  protected async onStop(): Promise<void> {}

  async reserve(req: FundsReservationRequested): Promise<FundsReserved> {
    if (req.amount > this.available) {
      return {
        reservation_id: req.reservation_id,
        approved: false,
        source: req.source_hint ?? "aotc_own",
        available_after: this.available,
        reasons: ["insufficient_funds"],
      };
    }
    this.available -= req.amount;
    return {
      reservation_id: req.reservation_id,
      approved: true,
      source: req.source_hint ?? "aotc_own",
      available_after: this.available,
      reasons: [],
    };
  }

  availableCash(): number {
    return this.available;
  }
}
