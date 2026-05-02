/**
 * @module shared/utils/totp
 * @description RFC 6238 TOTP (HMAC-SHA1) autocontenido — sin dependencias externas.
 *
 * Compatible con Google Authenticator, Microsoft Authenticator, Authy, 1Password.
 *
 * Decisiones:
 *   * SHA-1 (default de Google Authenticator; SHA-256 rompe compatibilidad).
 *   * 30s step, 6 dígitos (RFC 6238 §4 + uso de facto en apps móviles).
 *   * ±1 step de tolerancia (90s de ventana total) → permite drift sin abrir
 *     demasiado la superficie a código robado.
 *   * Secreto: 20 bytes (RFC 4226 §4) → 32 caracteres base32.
 *
 * No expone el secreto fuera del módulo salvo al construir el otpauth:// URI.
 */

const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

function base32Decode(str) {
  const clean = str.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Base32 inválido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * Genera un secreto TOTP fresco (20 bytes → 32 caracteres base32).
 */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/**
 * Calcula el código TOTP para un secreto y un timestamp dado.
 * No usar directamente en autenticación — usar `verify` con ventana.
 */
function computeCode(secretBase32, timestampSeconds = Math.floor(Date.now() / 1000), step = 30, digits = 6) {
  const counter = Math.floor(timestampSeconds / step);
  const key = base32Decode(secretBase32);

  // Counter big-endian de 8 bytes (RFC 4226 §5.3)
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter % 0x100000000, 4);

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();

  // Dynamic truncation (RFC 4226 §5.3)
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const code = bin % 10 ** digits;
  return String(code).padStart(digits, '0');
}

/**
 * Verifica un código TOTP con ventana ±1 step (RFC 6238 §5.2).
 * Devuelve true si coincide con t, t-30s o t+30s.
 */
function verify(secretBase32, code, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secretBase32 || typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
  for (const offset of [-30, 0, 30]) {
    const candidate = computeCode(secretBase32, nowSeconds + offset);
    // Comparación en tiempo constante para no filtrar progreso por timing.
    if (candidate.length === code.length &&
        crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(code))) {
      return true;
    }
  }
  return false;
}

/**
 * Construye el URI otpauth:// que las apps autenticadoras consumen
 * (Google Authenticator, Authy, etc.). El frontend puede pintarlo como QR.
 *
 * Formato (RFC Draft "keyuri"):
 *   otpauth://totp/Issuer:label?secret=BASE32&issuer=Issuer&algorithm=SHA1&digits=6&period=30
 */
function buildOtpAuthUri({ secret, label, issuer }) {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedLabel = encodeURIComponent(`${issuer}:${label}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${encodedLabel}?${params.toString()}`;
}

module.exports = {
  generateSecret,
  computeCode,
  verify,
  buildOtpAuthUri,
};
