/**
 * Haute disponibilité — RÈGLE #5.
 * Chaque moteur est réplicable (×N) avec un seul leader par partition.
 */

import type { PartitionKey } from "../domain/ids.js";

export type ReplicaRole = "leader" | "follower";

export interface LeadershipLease {
  partition: PartitionKey;
  holder_id: string;
  acquired_at: string;
  expires_at: string;
}

/**
 * Port d'élection de leader. Implémentations : Redis Redlock, etcd, Consul, …
 * Le cœur métier ne connaît pas l'implémentation.
 */
export interface LeaderElectionPort {
  /** Tente d'acquérir / renouveler le lease pour la partition. */
  tryAcquire(partition: PartitionKey, holderId: string, ttlMs: number): Promise<LeadershipLease | null>;
  /** Renouvelle le lease si on est toujours holder. */
  renew(lease: LeadershipLease, ttlMs: number): Promise<LeadershipLease | null>;
  release(partition: PartitionKey, holderId: string): Promise<void>;
  /** Lecture : qui détient actuellement ? */
  currentLeader(partition: PartitionKey): Promise<LeadershipLease | null>;
}

export interface EngineReplicaState {
  engine_name: string;
  replica_id: string;
  role: ReplicaRole;
  partitions: PartitionKey[];
}
