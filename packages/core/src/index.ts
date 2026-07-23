/**
 * @aotc/core — Domaine métier pur.
 *
 * RÈGLE IMMUTABLE #3 : aucune dépendance Supabase / Next.js / Redis / Postgres.
 * Ce package doit rester exécutable hors de toute infrastructure.
 */

export * from "./domain/exchange.js";
export * from "./domain/market.js";
export * from "./domain/instrument.js";
export * from "./domain/asset.js";
export * from "./domain/ids.js";
export * from "./ports/message-bus.js";
export * from "./ports/repository.js";
export * from "./ports/leadership.js";
export * from "./ports/decision.js";
export * from "./engines/engine.js";
