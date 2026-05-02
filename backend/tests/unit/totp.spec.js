/**
 * Unit test — implementación TOTP (RFC 6238).
 *
 * Valores esperados tomados del vector de referencia del RFC 6238 Appendix B
 * (secret ASCII "12345678901234567890" → base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").
 */

const totp = require('../../src/shared/utils/totp');

describe('TOTP (RFC 6238)', () => {
  const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  it('computeCode coincide con el vector del RFC 6238 para t=59 (código esperado 94287082, truncado a 6: 287082)', () => {
    // El RFC define HOTP con 8 dígitos; computeCode usa 6 por default.
    const code = totp.computeCode(RFC_SECRET_BASE32, 59);
    expect(code).toBe('287082');
  });

  it('verify acepta el código del instante actual', () => {
    const secret = totp.generateSecret();
    const now = Math.floor(Date.now() / 1000);
    const code = totp.computeCode(secret, now);
    expect(totp.verify(secret, code, now)).toBe(true);
  });

  it('verify acepta el código del step previo (tolerancia -30s)', () => {
    const secret = totp.generateSecret();
    const now = Math.floor(Date.now() / 1000);
    const codePrev = totp.computeCode(secret, now - 30);
    expect(totp.verify(secret, codePrev, now)).toBe(true);
  });

  it('verify rechaza un código fuera de ventana (-2 steps)', () => {
    const secret = totp.generateSecret();
    const now = Math.floor(Date.now() / 1000);
    const codeFar = totp.computeCode(secret, now - 120);
    expect(totp.verify(secret, codeFar, now)).toBe(false);
  });

  it('verify rechaza códigos malformados', () => {
    const secret = totp.generateSecret();
    expect(totp.verify(secret, '12345', Math.floor(Date.now() / 1000))).toBe(false);  // 5 dígitos
    expect(totp.verify(secret, 'abcdef', Math.floor(Date.now() / 1000))).toBe(false); // no numérico
    expect(totp.verify(secret, '', Math.floor(Date.now() / 1000))).toBe(false);
    expect(totp.verify(secret, null, Math.floor(Date.now() / 1000))).toBe(false);
  });

  it('generateSecret devuelve 32 caracteres base32 válidos', () => {
    const secret = totp.generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('buildOtpAuthUri genera un URI parseable con issuer y secret', () => {
    const uri = totp.buildOtpAuthUri({
      secret: RFC_SECRET_BASE32,
      label: 'user@example.com',
      issuer: 'ERP ELDOM',
    });
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain(`secret=${RFC_SECRET_BASE32}`);
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});
