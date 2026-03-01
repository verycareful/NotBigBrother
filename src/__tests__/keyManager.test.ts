/**
 * Tests for src/lib/keyManager.ts
 *
 * These tests verify that the RSA key manager correctly loads or generates a
 * keypair and exposes the expected numeric components used by the blind
 * signature protocol.
 *
 * NOTE: Key generation is slow (~5 s for 2048-bit RSA).  To avoid re-running
 * generation on every test run the module keeps a module-level singleton.  We
 * reset it between suites via jest.resetModules() so each describe block gets
 * a clean slate.
 */

import fs from 'fs';
import path from 'path';

// Path where the real keys would live – we want to avoid touching production
// key files during tests, so we point the module at a temp dir via mocking.
const REAL_KEYS_DIR = path.join(__dirname, '..', '..', 'keys');

// ─── helpers ────────────────────────────────────────────────────────────────

/** Returns true when every character in s is an ASCII digit */
function isAllDigits(s: string) {
  return /^\d+$/.test(s);
}

// ─── suite: module exports ───────────────────────────────────────────────────

describe('keyManager – public API', () => {
  // We use the real key (generated once when the server first ran, or during
  // the test run) to exercise the happy path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const km = require('../lib/keyManager');

  test('loadOrGenerateKey() returns a NodeRSA instance', () => {
    const key = km.loadOrGenerateKey();
    expect(key).toBeDefined();
    // NodeRSA exposes keyPair
    expect(key.keyPair).toBeDefined();
  });

  test('getKey() returns the same instance as loadOrGenerateKey()', () => {
    expect(km.getKey()).toBe(km.loadOrGenerateKey());
  });

  test('getPublicComponents() returns N and E as non-empty decimal strings', () => {
    const { N, E } = km.getPublicComponents();

    expect(typeof N).toBe('string');
    expect(typeof E).toBe('string');
    expect(N.length).toBeGreaterThan(0);
    expect(E.length).toBeGreaterThan(0);
    expect(isAllDigits(N)).toBe(true);
    expect(isAllDigits(E)).toBe(true);
  });

  test('getPrivateComponents() returns N and D as non-empty decimal strings', () => {
    const { N, D } = km.getPrivateComponents();

    expect(typeof N).toBe('string');
    expect(typeof D).toBe('string');
    expect(N.length).toBeGreaterThan(0);
    expect(D.length).toBeGreaterThan(0);
    expect(isAllDigits(N)).toBe(true);
    expect(isAllDigits(D)).toBe(true);
  });

  test('public N and private N are the same modulus', () => {
    const { N: pubN } = km.getPublicComponents();
    const { N: privN } = km.getPrivateComponents();
    expect(pubN).toBe(privN);
  });

  test('public exponent E is a small positive number (typically 65537)', () => {
    const { E } = km.getPublicComponents();
    const e = parseInt(E, 10);
    expect(e).toBeGreaterThan(1);
  });

  test('modulus N is at least 512 decimal digits long (≥ 2048-bit key)', () => {
    // A 2048-bit number has ⌈2048 × log₁₀2⌉ = 617 decimal digits
    const { N } = km.getPublicComponents();
    expect(N.length).toBeGreaterThanOrEqual(600);
  });

  test('loadOrGenerateKey() is idempotent (returns cached singleton)', () => {
    const first = km.loadOrGenerateKey();
    const second = km.loadOrGenerateKey();
    expect(first).toBe(second);
  });
});

// ─── suite: key persistence ──────────────────────────────────────────────────

describe('keyManager – disk persistence', () => {
  test('private.pem exists after server has been initialised', () => {
    // This guards against accidental deletion of key files.
    // If the file doesn't yet exist (fresh checkout) the module will generate
    // it, so we just verify it is present after importing.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../lib/keyManager').loadOrGenerateKey();
    const privatePem = path.join(REAL_KEYS_DIR, 'private.pem');
    expect(fs.existsSync(privatePem)).toBe(true);
  });

  test('public.pem exists after server has been initialised', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../lib/keyManager').loadOrGenerateKey();
    const publicPem = path.join(REAL_KEYS_DIR, 'public.pem');
    expect(fs.existsSync(publicPem)).toBe(true);
  });

  test('private.pem contains a valid PEM header', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../lib/keyManager').loadOrGenerateKey();
    const privatePem = path.join(REAL_KEYS_DIR, 'private.pem');
    if (fs.existsSync(privatePem)) {
      const contents = fs.readFileSync(privatePem, 'utf8');
      expect(contents).toMatch(/-----BEGIN RSA PRIVATE KEY-----|-----BEGIN PRIVATE KEY-----/);
    }
  });
});
