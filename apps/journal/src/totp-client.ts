/**
 * TOTP client navigateur (RFC 6238) — HMAC-SHA1, pas 30s, 6 chiffres.
 * Implémentation pure JS (pas de dépendances Node) pour le sandbox MFA.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Uint8Array {
  const cleaned = input
    .replace(/=+$/g, "")
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error("invalid_base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** SHA-1 (FIPS 180-1) — compact, pour HMAC uniquement. */
function sha1(message: Uint8Array): Uint8Array {
  const ml = message.length;
  const withOne = new Uint8Array(ml + 1);
  withOne.set(message);
  withOne[ml] = 0x80;

  const bitLen = ml * 8;
  const totalLen = ((withOne.length + 8 + 63) & ~63);
  const padded = new Uint8Array(totalLen);
  padded.set(withOne);
  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);
  // high 32 bits of length — always 0 for our short messages
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Int32Array(80);
  for (let i = 0; i < totalLen; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = view.getInt32(i + j * 4, false);
    }
    for (let j = 16; j < 80; j++) {
      const x = w[j - 3]! ^ w[j - 8]! ^ w[j - 14]! ^ w[j - 16]!;
      w[j] = (x << 1) | (x >>> 31);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let j = 0; j < 80; j++) {
      let f: number;
      let k: number;
      if (j < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (j < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[j]!) | 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) | 0;
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, h0 >>> 0, false);
  ov.setUint32(4, h1 >>> 0, false);
  ov.setUint32(8, h2 >>> 0, false);
  ov.setUint32(12, h3 >>> 0, false);
  ov.setUint32(16, h4 >>> 0, false);
  return out;
}

function hmacSha1(key: Uint8Array, data: Uint8Array): Uint8Array {
  const block = 64;
  let k = key;
  if (k.length > block) k = sha1(k);
  const keyBlock = new Uint8Array(block);
  keyBlock.set(k);

  const oKey = new Uint8Array(block);
  const iKey = new Uint8Array(block);
  for (let i = 0; i < block; i++) {
    oKey[i] = keyBlock[i]! ^ 0x5c;
    iKey[i] = keyBlock[i]! ^ 0x36;
  }

  const inner = new Uint8Array(block + data.length);
  inner.set(iKey);
  inner.set(data, block);
  const innerHash = sha1(inner);

  const outer = new Uint8Array(block + 20);
  outer.set(oKey);
  outer.set(innerHash, block);
  return sha1(outer);
}

function hotp(secret: Uint8Array, counter: number, digits = 6): string {
  const buf = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    buf[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const hmac = hmacSha1(secret, buf);
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  const mod = 10 ** digits;
  return String(code % mod).padStart(digits, "0");
}

/** Génère le code TOTP courant pour un secret Base32. */
export function generateTotp(secretBase32: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30);
  return hotp(base32Decode(secretBase32), counter, 6);
}
