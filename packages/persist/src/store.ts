import { openDatabase, type SqliteDb } from "./db.js";

export type KycStatus = "pending" | "approved";
export type ProposalStatus = "pending" | "approved" | "rejected";
export type PaymentKind = "deposit" | "withdraw";
export type PaymentStatus = "pending" | "succeeded" | "failed";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  kyc_status: KycStatus;
  sgi_id: string;
  cash: number;
  cash_locked: number;
  mfa_secret: string | null;
  mfa_enabled: boolean;
  password_hash: string | null;
  created_at: string;
}

export interface HoldingRow {
  user_id: string;
  asset_id: string;
  symbol: string;
  qty: number;
  locked: number;
}

export interface AuditRow {
  id: string;
  occurred_at: string;
  actor: string;
  summary: string;
  severity: string;
  correlation_id: string | null;
  details_json: string | null;
}

export interface ApiKeyRow {
  id: string;
  key_hash: string;
  name: string;
  sgi_id: string;
  created_at: string;
  revoked_at: string | null;
}

export interface GovernanceProposalRow {
  id: string;
  action: string;
  payload_json: string;
  status: ProposalStatus;
  proposed_by: string;
  approved_by: string | null;
  created_at: string;
}

export interface PaymentIntentRow {
  id: string;
  user_id: string;
  kind: PaymentKind;
  amount: number;
  status: PaymentStatus;
  idempotency_key: string;
  created_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function asRow<T>(row: unknown): T {
  return row as T;
}

function asRows<T>(rows: unknown): T[] {
  return rows as T[];
}

export class PersistStore {
  readonly db: SqliteDb;
  readonly path: string;

  constructor(dbPath?: string) {
    this.path = dbPath ?? process.env.AOTC_DB_PATH ?? ".data/aotc.sqlite";
    this.db = openDatabase(this.path);
  }

  close(): void {
    this.db.close();
  }

  // --- users ---

  upsertUser(user: {
    id: string;
    name: string;
    email: string;
    kyc_status?: KycStatus;
    sgi_id: string;
    cash?: number;
    cash_locked?: number;
    mfa_secret?: string | null;
    mfa_enabled?: boolean;
    password_hash?: string | null;
    created_at?: string;
  }): UserRow {
    const created_at = user.created_at ?? nowIso();
    this.db
      .prepare(
        `INSERT INTO users (
          id, name, email, kyc_status, sgi_id, cash, cash_locked,
          mfa_secret, mfa_enabled, password_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          email = excluded.email,
          kyc_status = excluded.kyc_status,
          sgi_id = excluded.sgi_id,
          cash = excluded.cash,
          cash_locked = excluded.cash_locked,
          mfa_secret = excluded.mfa_secret,
          mfa_enabled = excluded.mfa_enabled,
          password_hash = excluded.password_hash`,
      )
      .run(
        user.id,
        user.name,
        user.email.toLowerCase(),
        user.kyc_status ?? "pending",
        user.sgi_id,
        user.cash ?? 0,
        user.cash_locked ?? 0,
        user.mfa_secret ?? null,
        user.mfa_enabled ? 1 : 0,
        user.password_hash ?? null,
        created_at,
      );
    return this.getUser(user.id)!;
  }

  getUser(id: string): UserRow | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    return row ? mapUser(asRow<Record<string, unknown>>(row)) : null;
  }

  getUserByEmail(email: string): UserRow | null {
    const row = this.db
      .prepare(`SELECT * FROM users WHERE email = ?`)
      .get(email.toLowerCase());
    return row ? mapUser(asRow<Record<string, unknown>>(row)) : null;
  }

  listUsers(sgiId?: string): UserRow[] {
    if (sgiId) {
      return asRows<Record<string, unknown>>(
        this.db
          .prepare(`SELECT * FROM users WHERE sgi_id = ? ORDER BY created_at`)
          .all(sgiId),
      ).map(mapUser);
    }
    return asRows<Record<string, unknown>>(
      this.db.prepare(`SELECT * FROM users ORDER BY created_at`).all(),
    ).map(mapUser);
  }

  updateUserCash(userId: string, cash: number, cashLocked: number): void {
    this.db
      .prepare(`UPDATE users SET cash = ?, cash_locked = ? WHERE id = ?`)
      .run(cash, cashLocked, userId);
  }

  setUserKyc(userId: string, status: KycStatus): void {
    this.db
      .prepare(`UPDATE users SET kyc_status = ? WHERE id = ?`)
      .run(status, userId);
  }

  setUserMfa(
    userId: string,
    secret: string | null,
    enabled: boolean,
  ): void {
    this.db
      .prepare(
        `UPDATE users SET mfa_secret = ?, mfa_enabled = ? WHERE id = ?`,
      )
      .run(secret, enabled ? 1 : 0, userId);
  }

  // --- holdings ---

  upsertHolding(h: HoldingRow): void {
    this.db
      .prepare(
        `INSERT INTO holdings (user_id, asset_id, symbol, qty, locked)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, asset_id) DO UPDATE SET
           symbol = excluded.symbol,
           qty = excluded.qty,
           locked = excluded.locked`,
      )
      .run(h.user_id, h.asset_id, h.symbol, h.qty, h.locked);
  }

  listHoldings(userId: string): HoldingRow[] {
    return asRows<HoldingRow>(
      this.db.prepare(`SELECT * FROM holdings WHERE user_id = ?`).all(userId),
    );
  }

  replaceHoldings(userId: string, holdings: HoldingRow[]): void {
    this.db.prepare(`DELETE FROM holdings WHERE user_id = ?`).run(userId);
    for (const h of holdings) this.upsertHolding(h);
  }

  // --- orders / trades / settlements (JSON blobs) ---

  saveOrder(id: string, userId: string, payload: unknown): void {
    this.db
      .prepare(
        `INSERT INTO orders (id, user_id, payload_json, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json`,
      )
      .run(id, userId, JSON.stringify(payload), nowIso());
  }

  listOrders(userId?: string): Array<{ id: string; user_id: string; payload: unknown }> {
    type OrderBlob = { id: string; user_id: string; payload_json: string };
    const rows = asRows<OrderBlob>(
      userId
        ? this.db
            .prepare(`SELECT * FROM orders WHERE user_id = ? ORDER BY created_at`)
            .all(userId)
        : this.db.prepare(`SELECT * FROM orders ORDER BY created_at`).all(),
    );
    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      payload: JSON.parse(r.payload_json) as unknown,
    }));
  }

  saveTrade(id: string, payload: unknown, userId?: string): void {
    this.db
      .prepare(
        `INSERT INTO trades (id, user_id, payload_json, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json`,
      )
      .run(id, userId ?? null, JSON.stringify(payload), nowIso());
  }

  listTrades(): Array<{ id: string; user_id: string | null; payload: unknown }> {
    const rows = asRows<{
      id: string;
      user_id: string | null;
      payload_json: string;
    }>(this.db.prepare(`SELECT * FROM trades ORDER BY created_at`).all());
    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      payload: JSON.parse(r.payload_json) as unknown,
    }));
  }

  saveSettlement(id: string, payload: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settlements (id, payload_json, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json`,
      )
      .run(id, JSON.stringify(payload), nowIso());
  }

  listSettlements(): Array<{ id: string; payload: unknown }> {
    const rows = asRows<{ id: string; payload_json: string }>(
      this.db.prepare(`SELECT * FROM settlements ORDER BY created_at`).all(),
    );
    return rows.map((r) => ({
      id: r.id,
      payload: JSON.parse(r.payload_json) as unknown,
    }));
  }

  // --- audit ---

  appendAudit(entry: {
    id?: string;
    occurred_at?: string;
    actor: string;
    summary: string;
    severity: string;
    correlation_id?: string;
    details?: unknown;
  }): AuditRow {
    const id = entry.id ?? crypto.randomUUID();
    const occurred_at = entry.occurred_at ?? nowIso();
    const details_json =
      entry.details === undefined ? null : JSON.stringify(entry.details);
    this.db
      .prepare(
        `INSERT INTO audit_log (
          id, occurred_at, actor, summary, severity, correlation_id, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        occurred_at,
        entry.actor,
        entry.summary,
        entry.severity,
        entry.correlation_id ?? null,
        details_json,
      );
    return {
      id,
      occurred_at,
      actor: entry.actor,
      summary: entry.summary,
      severity: entry.severity,
      correlation_id: entry.correlation_id ?? null,
      details_json,
    };
  }

  listAudit(limit = 200): AuditRow[] {
    return asRows<AuditRow>(
      this.db
        .prepare(
          `SELECT * FROM audit_log ORDER BY occurred_at DESC LIMIT ?`,
        )
        .all(limit),
    );
  }

  // --- api keys ---

  insertApiKey(row: {
    id: string;
    key_hash: string;
    name: string;
    sgi_id: string;
    created_at?: string;
  }): ApiKeyRow {
    const created_at = row.created_at ?? nowIso();
    this.db
      .prepare(
        `INSERT INTO api_keys (id, key_hash, name, sgi_id, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(row.id, row.key_hash, row.name, row.sgi_id, created_at);
    return {
      id: row.id,
      key_hash: row.key_hash,
      name: row.name,
      sgi_id: row.sgi_id,
      created_at,
      revoked_at: null,
    };
  }

  getApiKeyByHash(keyHash: string): ApiKeyRow | null {
    const row = this.db
      .prepare(`SELECT * FROM api_keys WHERE key_hash = ?`)
      .get(keyHash);
    return row ? asRow<ApiKeyRow>(row) : null;
  }

  listApiKeys(sgiId?: string): ApiKeyRow[] {
    if (sgiId) {
      return asRows<ApiKeyRow>(
        this.db
          .prepare(
            `SELECT * FROM api_keys WHERE sgi_id = ? ORDER BY created_at DESC`,
          )
          .all(sgiId),
      );
    }
    return asRows<ApiKeyRow>(
      this.db.prepare(`SELECT * FROM api_keys ORDER BY created_at DESC`).all(),
    );
  }

  revokeApiKey(id: string): boolean {
    const res = this.db
      .prepare(
        `UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
      )
      .run(nowIso(), id);
    return Number(res.changes) > 0;
  }

  // --- governance ---

  insertProposal(row: {
    id: string;
    action: string;
    payload: unknown;
    proposed_by: string;
    created_at?: string;
  }): GovernanceProposalRow {
    const created_at = row.created_at ?? nowIso();
    const payload_json = JSON.stringify(row.payload ?? {});
    this.db
      .prepare(
        `INSERT INTO governance_proposals (
          id, action, payload_json, status, proposed_by, approved_by, created_at
        ) VALUES (?, ?, ?, 'pending', ?, NULL, ?)`,
      )
      .run(row.id, row.action, payload_json, row.proposed_by, created_at);
    return {
      id: row.id,
      action: row.action,
      payload_json,
      status: "pending",
      proposed_by: row.proposed_by,
      approved_by: null,
      created_at,
    };
  }

  getProposal(id: string): GovernanceProposalRow | null {
    const row = this.db
      .prepare(`SELECT * FROM governance_proposals WHERE id = ?`)
      .get(id);
    return row ? asRow<GovernanceProposalRow>(row) : null;
  }

  listProposals(): GovernanceProposalRow[] {
    return asRows<GovernanceProposalRow>(
      this.db
        .prepare(
          `SELECT * FROM governance_proposals ORDER BY created_at DESC`,
        )
        .all(),
    );
  }

  setProposalStatus(
    id: string,
    status: ProposalStatus,
    approvedBy?: string,
  ): GovernanceProposalRow | null {
    this.db
      .prepare(
        `UPDATE governance_proposals
         SET status = ?, approved_by = ?
         WHERE id = ?`,
      )
      .run(status, approvedBy ?? null, id);
    return this.getProposal(id);
  }

  // --- payment intents ---

  insertPaymentIntent(row: {
    id: string;
    user_id: string;
    kind: PaymentKind;
    amount: number;
    idempotency_key: string;
    status?: PaymentStatus;
    created_at?: string;
  }): PaymentIntentRow {
    const created_at = row.created_at ?? nowIso();
    const status = row.status ?? "pending";
    this.db
      .prepare(
        `INSERT INTO payment_intents (
          id, user_id, kind, amount, status, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.user_id,
        row.kind,
        row.amount,
        status,
        row.idempotency_key,
        created_at,
      );
    return {
      id: row.id,
      user_id: row.user_id,
      kind: row.kind,
      amount: row.amount,
      status,
      idempotency_key: row.idempotency_key,
      created_at,
    };
  }

  getPaymentIntent(id: string): PaymentIntentRow | null {
    const row = this.db
      .prepare(`SELECT * FROM payment_intents WHERE id = ?`)
      .get(id);
    return row ? asRow<PaymentIntentRow>(row) : null;
  }

  getPaymentIntentByIdempotency(
    key: string,
  ): PaymentIntentRow | null {
    const row = this.db
      .prepare(`SELECT * FROM payment_intents WHERE idempotency_key = ?`)
      .get(key);
    return row ? asRow<PaymentIntentRow>(row) : null;
  }

  updatePaymentIntentStatus(
    id: string,
    status: PaymentStatus,
  ): PaymentIntentRow | null {
    this.db
      .prepare(`UPDATE payment_intents SET status = ? WHERE id = ?`)
      .run(status, id);
    return this.getPaymentIntent(id);
  }

  listPaymentIntents(userId?: string): PaymentIntentRow[] {
    if (userId) {
      return asRows<PaymentIntentRow>(
        this.db
          .prepare(
            `SELECT * FROM payment_intents WHERE user_id = ? ORDER BY created_at DESC`,
          )
          .all(userId),
      );
    }
    return asRows<PaymentIntentRow>(
      this.db
        .prepare(`SELECT * FROM payment_intents ORDER BY created_at DESC`)
        .all(),
    );
  }
}

function mapUser(row: Record<string, unknown>): UserRow {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    kyc_status: row.kyc_status as KycStatus,
    sgi_id: String(row.sgi_id),
    cash: Number(row.cash),
    cash_locked: Number(row.cash_locked),
    mfa_secret: (row.mfa_secret as string | null) ?? null,
    mfa_enabled: Boolean(row.mfa_enabled),
    password_hash: (row.password_hash as string | null) ?? null,
    created_at: String(row.created_at),
  };
}
