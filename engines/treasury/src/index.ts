/**
 * Treasury Engine — gère *avec quels fonds* (séparé de Liquidity).
 */

import { BaseEngine, type EngineContext } from "@aotc/core";
import type { FundsReservationRequested, FundsReserved } from "@aotc/contracts";

export type CreditLine = {
  id: string;
  ceiling: number;
  drawn: number;
};

export type TreasurySnapshot = {
  available: number;
  immobilized: number;
  credit_lines: CreditLine[];
  capital_by_source: {
    aotc_own: number;
    coris: number;
    credit_line: number;
  };
  liquidity_revenue: number;
};

const DEFAULT_SEED = 1_000_000_000;

export class TreasuryEngine extends BaseEngine {
  readonly name = "treasury";
  private available = DEFAULT_SEED;
  private immobilized = 0;
  private reservations = new Map<string, number>();
  private creditLines: CreditLine[] = [
    { id: "cl_sandbox", ceiling: 500_000_000, drawn: 0 },
  ];
  private capital_by_source = {
    aotc_own: DEFAULT_SEED,
    coris: 0,
    credit_line: 0,
  };
  private liquidity_revenue = 0;

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
    this.immobilized += req.amount;
    this.reservations.set(req.reservation_id, req.amount);
    const source = req.source_hint ?? "aotc_own";
    if (source === "aotc_own") {
      this.capital_by_source.aotc_own = Math.max(
        0,
        this.capital_by_source.aotc_own - req.amount,
      );
    }
    return {
      reservation_id: req.reservation_id,
      approved: true,
      source,
      available_after: this.available,
      reasons: [],
    };
  }

  /** Crédit sandbox (dépôt investisseur / seed). */
  credit(amount: number, source: "aotc_own" | "coris" = "aotc_own"): number {
    if (amount > 0) {
      const a = Math.floor(amount);
      this.available += a;
      this.capital_by_source[source] += a;
    }
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
    this.immobilized = Math.max(0, this.immobilized - toRelease);
    this.capital_by_source.aotc_own += toRelease;
    const left = reserved - toRelease;
    if (left <= 0) this.reservations.delete(reservationId);
    else this.reservations.set(reservationId, left);
    return this.available;
  }

  drawCredit(lineId: string, amount: number): boolean {
    const line = this.creditLines.find((c) => c.id === lineId);
    if (!line || amount <= 0) return false;
    if (line.drawn + amount > line.ceiling) return false;
    line.drawn += amount;
    this.available += amount;
    this.capital_by_source.credit_line += amount;
    return true;
  }

  recordLiquidityRevenue(amount: number): void {
    if (amount > 0) this.liquidity_revenue += Math.floor(amount);
  }

  snapshot(): TreasurySnapshot {
    return {
      available: this.available,
      immobilized: this.immobilized,
      credit_lines: this.creditLines.map((c) => ({ ...c })),
      capital_by_source: { ...this.capital_by_source },
      liquidity_revenue: this.liquidity_revenue,
    };
  }

  availableCash(): number {
    return this.available;
  }

  reset(seed = DEFAULT_SEED): void {
    this.available = seed;
    this.immobilized = 0;
    this.reservations.clear();
    this.creditLines = [{ id: "cl_sandbox", ceiling: 500_000_000, drawn: 0 }];
    this.capital_by_source = {
      aotc_own: seed,
      coris: 0,
      credit_line: 0,
    };
    this.liquidity_revenue = 0;
  }
}
