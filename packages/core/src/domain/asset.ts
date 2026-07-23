import type { AssetId } from "./ids.js";

/**
 * Sous-jacent générique. Les actions ne sont qu'un AssetClass parmi d'autres.
 * Attributs spécifiques déportés (equity / bond / sukuk / fund) — jamais de branche BRVM.
 */
export type AssetClass =
  | "equity"
  | "bond"
  | "govt_bond"
  | "sukuk"
  | "mutual_fund"
  | "etf";

export interface Asset {
  id: AssetId;
  symbol: string;
  isin?: string;
  asset_class: AssetClass;
  name: string;
  currency: string;
  status: "listed" | "suspended" | "delisted";
  tick_size: number;
  lot_size: number;
  equity?: { sector: string };
  bond?: {
    coupon_bps: number;
    maturity: string;
    face_value: number;
    accrual: "actual/360" | "30/360";
  };
  sukuk?: {
    profit_rate_bps: number;
    maturity: string;
    sharia_board_ref: string;
  };
  fund?: {
    nav: number;
    nav_frequency: "daily" | "weekly";
    isin_share_class: string;
  };
}
