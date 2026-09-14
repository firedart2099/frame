// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
/**
 * crypto.js — MD5 + HMAC-MD5 + Base64 puros (zero dependências).
 * Porte fiel do src/providers/moviebox/crypto.rs do MovieBox-Tui.
 * Funciona em React Native (Hermes) e Node.
 *
 * CommonJS de propósito: Metro lida bem, e permite testar no Node direto.
 */

// ---------------------------------------------------------------------------
// UTF-8
// ---------------------------------------------------------------------------
function utf8Bytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000)
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// MD5 (bytes -> bytes), implementação clássica RFC 1321
// ---------------------------------------------------------------------------
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const K = new Uint32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;

function rotl(x, c) {
  return ((x << c) | (x >>> (32 - c))) >>> 0;
}

function md5Bytes(input) {
  const origBitLen = input.length * 8;
  const paddedLen = Math.floor((input.length + 8) / 64) * 64 + 64;
  const buf = new Uint8Array(paddedLen);
  buf.set(input);
  buf[input.length] = 0x80;
  const low = origBitLen >>> 0;
  const high = Math.floor(origBitLen / 4294967296);
  for (let i = 0; i < 4; i++) {
    buf[paddedLen - 8 + i] = (low >>> (8 * i)) & 0xff;
    buf[paddedLen - 4 + i] = (high >>> (8 * i)) & 0xff;
  }

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let off = 0; off < paddedLen; off += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) {
      M[j] =
        (buf[off + j * 4]) |
        (buf[off + j * 4 + 1] << 8) |
        (buf[off + j * 4 + 2] << 16) |
        (buf[off + j * 4 + 3] << 24);
    }

    let A = a0, B = b0, C = c0, D = d0;

    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(F, S[i])) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const words = [a0, b0, c0, d0];
  for (let w = 0; w < 4; w++) {
    for (let i = 0; i < 4; i++) out[w * 4 + i] = (words[w] >>> (8 * i)) & 0xff;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hex / Base64
// ---------------------------------------------------------------------------
function bytesToHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b64Encode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : null;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : null;
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 3) << 4) | (b1 === null ? 0 : b1 >> 4)];
    out += b1 === null ? '=' : B64_CHARS[((b1 & 15) << 2) | (b2 === null ? 0 : b2 >> 6)];
    out += b2 === null ? '=' : B64_CHARS[b2 & 63];
  }
  return out;
}

function b64Decode(str) {
  let clean = String(str).replace(/=+$/, '');
  const pad = (4 - (clean.length % 4)) % 4;
  clean += '='.repeat(pad);
  const rev = new Map();
  for (let i = 0; i < 64; i++) rev.set(B64_CHARS[i], i);
  const out = [];
  let acc = 0, bits = 0;
  for (const ch of clean) {
    if (ch === '=') break;
    const v = rev.get(ch);
    if (v === undefined) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// HMAC-MD5
// ---------------------------------------------------------------------------
function hmacMd5Bytes(keyBytes, msgBytes) {
  const BLOCK = 64;
  let key = keyBytes;
  if (key.length > BLOCK) key = md5Bytes(key);
  const k = new Uint8Array(BLOCK);
  k.set(key.subarray(0, BLOCK));

  const ipad = new Uint8Array(BLOCK);
  const opad = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) {
    ipad[i] = k[i] ^ 0x36;
    opad[i] = k[i] ^ 0x5c;
  }
  const inner = new Uint8Array(BLOCK + msgBytes.length);
  inner.set(ipad);
  inner.set(msgBytes, BLOCK);
  const innerHash = md5Bytes(inner);

  const outer = new Uint8Array(BLOCK + innerHash.length);
  outer.set(opad);
  outer.set(innerHash, BLOCK);
  return md5Bytes(outer);
}

// ---------------------------------------------------------------------------
// API pública do módulo
// ---------------------------------------------------------------------------
function md5Hex(strOrBytes) {
  const bytes = typeof strOrBytes === 'string' ? utf8Bytes(strOrBytes) : strOrBytes;
  return bytesToHex(md5Bytes(bytes));
}

function hmacMd5Base64(keyBytes, msgString) {
  return b64Encode(hmacMd5Bytes(keyBytes, utf8Bytes(msgString)));
}

export {
  utf8Bytes,
  md5Bytes,
  md5Hex,
  hmacMd5Bytes,
  hmacMd5Base64,
  b64Encode,
  b64Decode,
  bytesToHex,
};
