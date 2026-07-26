/**
 * Adapters Message Bus & Leadership.
 * Les moteurs importent @aotc/core (ports) ; l'infra concrète vit ici.
 * Redis Streams / NATS viendront en adapters séparés — le port ne change pas.
 */

export { InMemoryMessageBus } from "./in-memory-bus.js";
export { InMemoryLeaderElection } from "./in-memory-leadership.js";
