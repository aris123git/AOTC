/**
 * Clés API partenaires — `aotc_sk_...` + stockage du hash SHA-256.
 */

import { createHash, randomBytes } from "node:crypto";

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

export function createApiKey(opts?: {
  prefix?: string;
  bytes?: number;
}): { id: string; raw_key: string; key_hash: string } {
  const prefix = opts?.prefix ?? "aotc_sk_";
  const raw = randomBytes(opts?.bytes ?? 24).toString("base64url");
  const raw_key = `${prefix}${raw}`;
  return {
    id: crypto.randomUUID(),
    raw_key,
    key_hash: hashApiKey(raw_key),
  };
}

export function createSessionToken(): string {
  return `aotc_sess_${randomBytes(24).toString("base64url")}`;
}
