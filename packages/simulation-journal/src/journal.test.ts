import { describe, expect, it } from "vitest";
import { InMemorySimulationJournal } from "../src/in-memory-journal.js";
import { runLot1Demo } from "../src/demo-flow.js";

describe("Simulation Journal", () => {
  it("formate une chronologie lisible", async () => {
    const journal = new InMemorySimulationJournal();
    const correlation_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    await journal.append({
      correlation_id,
      environment: "sandbox",
      actor: "risk",
      summary: "Risk Engine : VALIDÉ",
      severity: "success",
      occurred_at: "2026-07-23T09:41:12.000Z",
    });
    await journal.append({
      correlation_id,
      environment: "sandbox",
      actor: "sor",
      summary: "Smart Order Router : Book interne",
      severity: "success",
      occurred_at: "2026-07-23T09:41:13.000Z",
    });
    const lines = await journal.formatTimeline(correlation_id);
    expect(lines).toEqual([
      "09:41:12  Risk Engine : VALIDÉ",
      "09:41:13  Smart Order Router : Book interne",
    ]);
  });

  it("exécute le scénario Lot 1 E2E et journalise les 12 étapes", async () => {
    const result = await runLot1Demo();
    expect(result.timeline.length).toBeGreaterThanOrEqual(12);
    expect(result.trade_id).toBeTruthy();
    expect(result.portfolio.holdings_qty).toBe(100);

    const joined = result.timeline.join("\n");
    expect(joined).toMatch(/compte créé/i);
    expect(joined).toMatch(/KYC validé/i);
    expect(joined).toMatch(/Dépôt simulé/i);
    expect(joined).toMatch(/Ordre reçu/i);
    expect(joined).toMatch(/Risk Engine : VALIDÉ/);
    expect(joined).toMatch(/Smart Order Router/);
    expect(joined).toMatch(/Trading Engine/);
    expect(joined).toMatch(/Carnet d'ordres/);
    expect(joined).toMatch(/Liquidity Engine/);
    expect(joined).toMatch(/Settlement Engine : Instruction T\+3/);
    expect(joined).toMatch(/Portefeuille mis à jour/);
    expect(joined).toMatch(/Audit/);
  }, 15_000);
});
