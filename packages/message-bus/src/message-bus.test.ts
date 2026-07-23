import { describe, expect, it } from "vitest";
import { asMarketId, asExchangeId, marketPartition, type Envelope } from "@aotc/core";
import { InMemoryLeaderElection, InMemoryMessageBus } from "../src/index.js";

describe("@aotc/message-bus", () => {
  it("publie et délivre un message", async () => {
    const bus = new InMemoryMessageBus();
    const received: Envelope[] = [];
    await bus.subscribe(
      "aotc.test",
      (env) => {
        received.push(env);
      },
      { consumer_group: "g1", consumer_name: "c1" },
    );

    const envelope: Envelope = {
      message_id: "11111111-1111-1111-1111-111111111111",
      schema_version: "1.0",
      type: "Test",
      occurred_at: new Date().toISOString(),
      correlation_id: "22222222-2222-2222-2222-222222222222",
      environment: "sandbox",
      payload: { hello: "world" },
    };
    await bus.publish("aotc.test", envelope);
    expect(received).toHaveLength(1);
    expect(bus.dump("aotc.test")).toHaveLength(1);
  });

  it("n'autorise qu'un leader par partition", async () => {
    const election = new InMemoryLeaderElection();
    const partition = marketPartition(asExchangeId("ex1"), asMarketId("m1"));
    const a = await election.tryAcquire(partition, "replica-a", 5_000);
    const b = await election.tryAcquire(partition, "replica-b", 5_000);
    expect(a?.holder_id).toBe("replica-a");
    expect(b).toBeNull();
  });
});
