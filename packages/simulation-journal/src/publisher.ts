/**
 * Publie une entrée journal via le Message Bus + store local.
 * Les moteurs utilisent ceci (ou le store injecté) — jamais d'import croisé moteur.
 */

import type { MessageBusPort, SimulationJournalPort, AppendJournalInput } from "@aotc/core";
import { TOPICS, createEnvelope, SimulationJournalEntrySchema } from "@aotc/contracts";

export class JournalPublisher {
  constructor(
    private readonly journal: SimulationJournalPort,
    private readonly bus: MessageBusPort,
  ) {}

  async record(input: AppendJournalInput): Promise<void> {
    const entry = await this.journal.append(input);
    const payload = SimulationJournalEntrySchema.parse(entry);
    await this.bus.publish(
      TOPICS.SIMULATION_JOURNAL,
      createEnvelope({
        type: "SimulationJournalEntry",
        correlation_id: entry.correlation_id,
        environment: entry.environment,
        payload,
        message_id: entry.entry_id,
        occurred_at: entry.occurred_at,
      }),
    );
  }
}
