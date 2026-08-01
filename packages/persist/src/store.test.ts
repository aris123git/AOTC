import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PersistStore } from "./store.js";

describe("PersistStore", () => {
  let dir: string;
  let store: PersistStore;

  afterEach(() => {
    store?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function openTemp(): PersistStore {
    dir = mkdtempSync(join(tmpdir(), "aotc-persist-"));
    store = new PersistStore(join(dir, "test.sqlite"));
    return store;
  }

  it("persists users and holdings", () => {
    const s = openTemp();
    const user = s.upsertUser({
      id: "u1",
      name: "Awa",
      email: "awa@example.com",
      sgi_id: "sgi_demo",
      cash: 1000,
    });
    expect(user.email).toBe("awa@example.com");
    expect(s.getUserByEmail("AWA@example.com")?.id).toBe("u1");

    s.upsertHolding({
      user_id: "u1",
      asset_id: "ast_snts",
      symbol: "SNTS",
      qty: 10,
      locked: 0,
    });
    expect(s.listHoldings("u1")).toHaveLength(1);
  });

  it("stores audit, payments, api keys, governance", () => {
    const s = openTemp();
    s.upsertUser({
      id: "u1",
      name: "Awa",
      email: "awa@example.com",
      sgi_id: "sgi_demo",
    });

    s.appendAudit({
      actor: "auth",
      summary: "compte créé",
      severity: "success",
      correlation_id: crypto.randomUUID(),
      details: { ok: true },
    });
    expect(s.listAudit()).toHaveLength(1);

    const intent = s.insertPaymentIntent({
      id: "pi1",
      user_id: "u1",
      kind: "deposit",
      amount: 5000,
      idempotency_key: "idem-1",
    });
    expect(intent.status).toBe("pending");
    s.updatePaymentIntentStatus("pi1", "succeeded");
    expect(s.getPaymentIntent("pi1")?.status).toBe("succeeded");

    s.insertApiKey({
      id: "k1",
      key_hash: "abc",
      name: "partner",
      sgi_id: "sgi_demo",
    });
    expect(s.revokeApiKey("k1")).toBe(true);
    expect(s.getApiKeyByHash("abc")?.revoked_at).toBeTruthy();

    const prop = s.insertProposal({
      id: "g1",
      action: "kill_switch",
      payload: { symbol: "SNTS" },
      proposed_by: "admin",
    });
    expect(prop.status).toBe("pending");
    s.setProposalStatus("g1", "approved", "admin");
    expect(s.getProposal("g1")?.status).toBe("approved");
  });

  it("survives reopen on same path", () => {
    dir = mkdtempSync(join(tmpdir(), "aotc-persist-"));
    const path = join(dir, "reopen.sqlite");
    const a = new PersistStore(path);
    a.upsertUser({
      id: "u1",
      name: "Awa",
      email: "awa@example.com",
      sgi_id: "sgi_demo",
      cash: 42,
    });
    a.close();

    store = new PersistStore(path);
    expect(store.getUser("u1")?.cash).toBe(42);
  });
});
