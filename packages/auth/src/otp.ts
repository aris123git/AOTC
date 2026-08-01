/**
 * OTP 6 chiffres — Map mémoire + persistance optionnelle (callback).
 */

export type OtpRecord = {
  code: string;
  email: string;
  expires_at: number;
};

export type OtpPersistAdapter = {
  save?(record: OtpRecord): void | Promise<void>;
  load?(email: string): OtpRecord | null | Promise<OtpRecord | null>;
  clear?(email: string): void | Promise<void>;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export class OtpService {
  private readonly store = new Map<string, OtpRecord>();
  private readonly ttlMs: number;
  private readonly persist?: OtpPersistAdapter;

  constructor(opts?: { ttlMs?: number; persist?: OtpPersistAdapter }) {
    this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
    this.persist = opts?.persist;
  }

  generateCode(): string {
    const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
    return String(n).padStart(6, "0");
  }

  async request(email: string): Promise<{ code: string; expires_at: number }> {
    const key = email.trim().toLowerCase();
    const code = this.generateCode();
    const expires_at = Date.now() + this.ttlMs;
    const record: OtpRecord = { code, email: key, expires_at };
    this.store.set(key, record);
    await this.persist?.save?.(record);
    return { code, expires_at };
  }

  async verify(email: string, code: string): Promise<boolean> {
    const key = email.trim().toLowerCase();
    let record = this.store.get(key) ?? null;
    if (!record && this.persist?.load) {
      record = (await this.persist.load(key)) ?? null;
      if (record) this.store.set(key, record);
    }
    if (!record) return false;
    if (Date.now() > record.expires_at) {
      this.store.delete(key);
      await this.persist?.clear?.(key);
      return false;
    }
    if (record.code !== code.trim()) return false;
    this.store.delete(key);
    await this.persist?.clear?.(key);
    return true;
  }

  /** Dev / tests — lit le code courant sans le consommer. */
  peek(email: string): string | null {
    return this.store.get(email.trim().toLowerCase())?.code ?? null;
  }

  clear(): void {
    this.store.clear();
  }
}
