/**
 * Contrat de base de tout moteur AOTC.
 * RÈGLES #2 #5 : découplage event-driven + réplication / leadership.
 */

import type { PartitionKey } from "../domain/ids.js";
import type { MessageBusPort } from "../ports/message-bus.js";
import type {
  EngineReplicaState,
  LeaderElectionPort,
  ReplicaRole,
} from "../ports/leadership.js";

export interface EngineContext {
  bus: MessageBusPort;
  leadership: LeaderElectionPort;
  replica_id: string;
  environment: "sandbox" | "production";
}

export interface Engine {
  readonly name: string;
  start(ctx: EngineContext): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<"up" | "degraded" | "down">;
  replicaState(): EngineReplicaState;
}

export abstract class BaseEngine implements Engine {
  abstract readonly name: string;
  protected ctx: EngineContext | null = null;
  protected role: ReplicaRole = "follower";
  protected partitions: PartitionKey[] = [];
  private running = false;

  async start(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    this.running = true;
    await this.onStart(ctx);
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.onStop();
    this.ctx = null;
  }

  async health(): Promise<"up" | "degraded" | "down"> {
    if (!this.running || !this.ctx) return "down";
    return this.onHealth();
  }

  replicaState(): EngineReplicaState {
    return {
      engine_name: this.name,
      replica_id: this.ctx?.replica_id ?? "unstarted",
      role: this.role,
      partitions: [...this.partitions],
    };
  }

  /**
   * Acquiert le leadership pour une partition. Seul le leader écrit.
   */
  protected async becomeLeaderIfPossible(
    partition: PartitionKey,
    ttlMs = 10_000,
  ): Promise<boolean> {
    if (!this.ctx) return false;
    const lease = await this.ctx.leadership.tryAcquire(
      partition,
      this.ctx.replica_id,
      ttlMs,
    );
    if (lease) {
      this.role = "leader";
      if (!this.partitions.includes(partition)) {
        this.partitions.push(partition);
      }
      return true;
    }
    return false;
  }

  protected abstract onStart(ctx: EngineContext): Promise<void>;
  protected abstract onStop(): Promise<void>;
  protected async onHealth(): Promise<"up" | "degraded" | "down"> {
    return "up";
  }
}
