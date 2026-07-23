import type { LeaderElectionPort, LeadershipLease, PartitionKey } from "@aotc/core";

/**
 * Élection de leader in-memory (single-process).
 * Prod : Redis Redlock / etcd — même port (Règle #5).
 */
export class InMemoryLeaderElection implements LeaderElectionPort {
  private leases = new Map<string, LeadershipLease>();

  async tryAcquire(
    partition: PartitionKey,
    holderId: string,
    ttlMs: number,
  ): Promise<LeadershipLease | null> {
    this.purgeExpired(partition);
    const current = this.leases.get(partition);
    if (current && current.holder_id !== holderId) {
      return null;
    }
    const now = Date.now();
    const lease: LeadershipLease = {
      partition,
      holder_id: holderId,
      acquired_at: new Date(now).toISOString(),
      expires_at: new Date(now + ttlMs).toISOString(),
    };
    this.leases.set(partition, lease);
    return lease;
  }

  async renew(
    lease: LeadershipLease,
    ttlMs: number,
  ): Promise<LeadershipLease | null> {
    this.purgeExpired(lease.partition);
    const current = this.leases.get(lease.partition);
    if (!current || current.holder_id !== lease.holder_id) return null;
    return this.tryAcquire(lease.partition, lease.holder_id, ttlMs);
  }

  async release(partition: PartitionKey, holderId: string): Promise<void> {
    const current = this.leases.get(partition);
    if (current?.holder_id === holderId) {
      this.leases.delete(partition);
    }
  }

  async currentLeader(partition: PartitionKey): Promise<LeadershipLease | null> {
    this.purgeExpired(partition);
    return this.leases.get(partition) ?? null;
  }

  private purgeExpired(partition: PartitionKey): void {
    const current = this.leases.get(partition);
    if (current && Date.parse(current.expires_at) <= Date.now()) {
      this.leases.delete(partition);
    }
  }
}
