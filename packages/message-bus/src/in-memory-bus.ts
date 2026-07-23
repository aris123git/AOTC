import type {
  Envelope,
  MessageBusPort,
  MessageHandler,
  PublishOptions,
  SubscribeOptions,
} from "@aotc/core";

type Entry = {
  envelope: Envelope;
  partition_key?: string;
};

/**
 * Bus in-memory pour tests et démarrage local.
 * Remplaçable par Redis Streams sans toucher aux moteurs (Règle #1/#3).
 */
export class InMemoryMessageBus implements MessageBusPort {
  private topics = new Map<string, Entry[]>();
  private handlers = new Map<
    string,
    Array<{ handler: MessageHandler; options: SubscribeOptions }>
  >();

  async publish<T>(
    topic: string,
    envelope: Envelope<T>,
    options?: PublishOptions,
  ): Promise<void> {
    const entry: Entry = {
      envelope: envelope as Envelope,
      partition_key: options?.partition_key,
    };
    const list = this.topics.get(topic) ?? [];
    list.push(entry);
    this.topics.set(topic, list);

    const subs = this.handlers.get(topic) ?? [];
    for (const sub of subs) {
      await sub.handler(envelope);
    }
  }

  async subscribe<T>(
    topic: string,
    handler: MessageHandler<T>,
    options: SubscribeOptions,
  ): Promise<{ unsubscribe: () => Promise<void> }> {
    const subs = this.handlers.get(topic) ?? [];
    const record = { handler: handler as MessageHandler, options };
    subs.push(record);
    this.handlers.set(topic, subs);

    return {
      unsubscribe: async () => {
        const current = this.handlers.get(topic) ?? [];
        this.handlers.set(
          topic,
          current.filter((s) => s !== record),
        );
      },
    };
  }

  /** Helper tests : dump des messages d'un topic. */
  dump(topic: string): Envelope[] {
    return (this.topics.get(topic) ?? []).map((e) => e.envelope);
  }
}
