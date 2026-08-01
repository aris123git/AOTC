import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  totp,
  verifyTotp,
  otpauthUrl,
} from "./totp.js";
import { createApiKey, hashApiKey } from "./api-keys.js";
import { OtpService } from "./otp.js";

describe("TOTP", () => {
  it("roundtrip encode/decode base32", () => {
    const secret = generateTotpSecret();
    const again = base32Encode(base32Decode(secret));
    expect(again).toBe(secret);
  });

  it("génère et vérifie un code TOTP (±1 fenêtre)", () => {
    const secret = generateTotpSecret();
    const at = Date.now();
    const code = totp(secret, { at });
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, { at })).toBe(true);
    expect(verifyTotp(secret, "000000", { at })).toBe(false);
    // fenêtre précédente
    const prev = totp(secret, { at: at - 30_000 });
    expect(verifyTotp(secret, prev, { at, window: 1 })).toBe(true);
  });

  it("construit otpauth URL", () => {
    const url = otpauthUrl({
      secret: "JBSWY3DPEHPK3PXP",
      accountName: "awa@example.com",
      issuer: "AOTC",
    });
    expect(url.startsWith("otpauth://totp/")).toBe(true);
    expect(url).toContain("secret=JBSWY3DPEHPK3PXP");
  });
});

describe("OTP + API keys", () => {
  it("OTP request/verify", async () => {
    const otp = new OtpService({ ttlMs: 60_000 });
    const { code } = await otp.request("awa@example.com");
    expect(code).toMatch(/^\d{6}$/);
    expect(await otp.verify("awa@example.com", code)).toBe(true);
    expect(await otp.verify("awa@example.com", code)).toBe(false);
  });

  it("createApiKey hash", () => {
    const key = createApiKey();
    expect(key.raw_key.startsWith("aotc_sk_")).toBe(true);
    expect(hashApiKey(key.raw_key)).toBe(key.key_hash);
  });
});
