/**
 * Treasury Engine — gère *avec quels fonds* (séparé de Liquidity).
 */

import { BaseEngine, type EngineContext } from "@aotc/core";
import type { FundsReservationRequested, FundsReserved } from "@aotc/contracts";

export class TreasuryEngine extends BaseEngine {
  readonly name = "treasury";
  private available = 1_000_000_000; // minor units XOF — sandbox seed
  private reservations = new Map<string, number>();

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
    this.reservations.set(req.reservation_id, req.amount);
    return {
      reservation_id: req.reservation_id,
      approved: true,
      source: req.source_hint ?? "aotc_own",
      available_after: this.available,
      reasons: [],
    };
  }

  /** Crédit sandbox (dépôt investisseur / seed). */
  credit(amount: number): number {
    if (amount > 0) this.available += Math.floor(amount);
    return this.available;
  }

  /**
   * Libère une réservation (partielle ou totale).
   * Si amount omis, libère le solde restant de la réservation.
   */
  release(reservationId: string, amount?: number): number {
    const reserved = this.reservations.get(reservationId) ?? 0;
    if (reserved <= 0) return this.available;
    const toRelease =
      amount === undefined
        ? reserved
        : Math.min(reserved, Math.max(0, Math.floor(amount)));
    this.available += toRelease;
    const left = reserved - toRelease;
    if (left <= 0) this.reservations.delete(reservationId);
    else this.reservations.set(reservationId, left);
    return this.available;
  }

  availableCash(): number {
    return this.available;
  }

  reset(seed = 1_000_000_000): void {
    this.available = seed;
    this.reservations.clear();
  }
}
