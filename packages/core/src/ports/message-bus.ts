/**
 * Port Message Bus — RÈGLE #1 & #2.
 * Les moteurs ne voient que cette interface ; l'adapter Redis/NATS est hors core.
 */

export type Environment = "sandbox" | "production";

export interface Envelope<T = unknown> {
  message_id: string;
  schema_version: string;
  type: string;
  occurred_at: string;
  correlation_id: string;
  causation_id?: string;
  actor?: {
    id: string;
    role: "investor" | "sgi_agent" | "aotc_admin" | "super_admin" | "system";
  };
  tenant?: { sgi_id?: string };
  environment: Environment;
  payload: T;
}

export interface PublishOptions {
  /** Clé de partition pour ordering / leadership. */
  partition_key?: string;
}

export interface SubscribeOptions {
  consumer_group: string;
  consumer_name: string;
  /** Si true, ne traite que si ce replica est leader de la partition. */
  leader_only?: boolean;
}

export type MessageHandler<T = unknown> = (
  envelope: Envelope<T>,
) => Promise<void> | void;

/**
 * Port abstrait. Implémentations : Redis Streams, NATS, in-memory (tests).
 */
export interface MessageBusPort {
  publish<T>(topic: string, envelope: Envelope<T>, options?: PublishOptions): Promise<void>;
  subscribe<T>(
    topic: string,
    handler: MessageHandler<T>,
    options: SubscribeOptions,
  ): Promise<{ unsubscribe: () => Promise<void> }>;
}
