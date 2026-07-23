/**
 * CLI : pnpm --filter @aotc/simulation-journal demo
 * Affiche la chronologie du scénario Lot 1.
 */
import { runLot1Demo } from "./demo-flow.js";

const result = await runLot1Demo();

console.log("");
console.log("═══ AOTC — Journal de simulation (Lot 1) ═══");
console.log(`correlation_id: ${result.correlation_id}`);
console.log(`order_id:       ${result.order_id}`);
console.log(`trade_id:       ${result.trade_id ?? "(aucun)"}`);
console.log(
  `portefeuille:   cash=${result.portfolio.cash_available} · qty=${result.portfolio.holdings_qty}`,
);
console.log("");
console.log("── Chronologie ──");
for (const line of result.timeline) {
  console.log(line);
}
console.log("");
