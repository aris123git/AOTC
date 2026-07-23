/**
 * Topics Message Bus — convention `aotc.<domaine>.<evenement>`
 */
export const TOPICS = {
  ORDERS_REQUESTED: "aotc.orders.requested",
  ORDERS_ACCEPTED: "aotc.orders.accepted",
  ORDERS_REJECTED: "aotc.orders.rejected",
  TRADING_MATCHED: "aotc.trading.matched",
  TRADING_RESTED: "aotc.trading.rested",
  TRADING_TRADE: "aotc.trading.trade",
  RISK_DECISION: "aotc.risk.decision",
  RISK_ALERT: "aotc.risk.alert",
  RISK_KILLSWITCH: "aotc.risk.killswitch",
  PRICING_QUOTE: "aotc.pricing.quote",
  LIQUIDITY_DECISION: "aotc.liquidity.decision",
  LIQUIDITY_INTERVENTION_REQUESTED: "aotc.liquidity.intervention_requested",
  TREASURY_RESERVED: "aotc.treasury.reserved",
  TREASURY_RELEASED: "aotc.treasury.released",
  SETTLEMENT_INSTRUCTED: "aotc.settlement.instructed",
  SETTLEMENT_CONFIRMED: "aotc.settlement.confirmed",
  SETTLEMENT_FAILED: "aotc.settlement.failed",
  MARKETDATA_TICK: "aotc.marketdata.tick",
  MARKETDATA_CANDLE: "aotc.marketdata.candle",
  MARKETDATA_CORPORATE_ACTION: "aotc.marketdata.corporate_action",
  PARTNER_STATS: "aotc.partner.stats",
  MONITORING_ALERT: "aotc.monitoring.alert",
  DECISION_SIGNAL: "aotc.decision.signal",
} as const;

export type Topic = (typeof TOPICS)[keyof typeof TOPICS];
