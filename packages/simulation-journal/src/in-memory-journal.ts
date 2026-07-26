import type {
  AppendJournalInput,
  SimulationJournalEntry,
  SimulationJournalPort,
} from "@aotc/core";

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Adapter mémoire — remplacé par Postgres sans toucher aux moteurs.
 */
export class InMemorySimulationJournal implements SimulationJournalPort {
  private entries: SimulationJournalEntry[] = [];

  async append(input: AppendJournalInput): Promise<SimulationJournalEntry> {
    const entry: SimulationJournalEntry = {
      entry_id: input.entry_id ?? crypto.randomUUID(),
      correlation_id: input.correlation_id,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
      actor: input.actor,
      summary: input.summary,
      severity: input.severity ?? "info",
      scenario_step: input.scenario_step,
      details: input.details,
      environment: input.environment,
    };
    this.entries.push(entry);
    return entry;
  }

  async listByCorrelation(correlationId: string): Promise<SimulationJournalEntry[]> {
    return this.entries
      .filter((e) => e.correlation_id === correlationId)
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  }

  async formatTimeline(correlationId: string): Promise<string[]> {
    const list = await this.listByCorrelation(correlationId);
    return list.map((e) => `${formatTime(e.occurred_at)}  ${e.summary}`);
  }

  /** Dump complet (tests / NOC sandbox). */
  all(): SimulationJournalEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}
