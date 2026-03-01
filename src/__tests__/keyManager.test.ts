/**
 * Tests for src/lib/keyManager.ts
 *
 * Verifies that the RSA key manager correctly loads or generates a keypair
 * and exposes the expected numeric components used by the blind signature
 * protocol.
 *
 * NOTE: Key generation is slow (~5 s for 2048-bit RSA).  The module keeps a
 * process-level singleton, so generation happens at most once per test run.
 */

import fs from 'fs';
import path from 'path';

// require() is intentional here: we need the live module singleton (the
// cached _key) rather than a Jest-isolated copy.  An `import` would give
// us the same singleton in this file, but require() makes the intent
// explicit and consistent with the inline require() calls used in the
// persistence suite below.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const km = require('../lib/keyManager');

const REAL_KEYS_DIR = path.join(__dirname, '..', '..', 'keys');

/** Returns true when every character of `s` is an ASCII digit. */
function isAllDigits(s: string): boolean {
  return /^\d+$/.test(s);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

describe('keyManager – public API', () => {
  test('loadOrGenerateKey() returns a NodeRSA instance', () => {
    const key = km.loadOrGenerateKey();
    expect(key).toBeDefined();
    expect(key.keyPair).toBeDefined();
  });

  test('getKey() returns the same instance as loadOrGenerateKey()', () => {
    expect(km.getKey()).toBe(km.loadOrGenerateKey());
  });

  test('loadOrGenerateKey() is idempotent (returns the cached singleton)', () => {
    expect(km.loadOrGenerateKey()).toBe(km.loadOrGenerateKey());
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
    const { N: pubN  } = km.getPublicComponents();
    const { N: privN } = km.getPrivateComponents();
    expect(pubN).toBe(privN);
  });

  test('public exponent E is a small positive integer (typically 65537)', () => {
    const { E } = km.getPublicComponents();
    expect(parseInt(E, 10)).toBeGreaterThan(1);
  });

  test('modulus N is at least 600 decimal digits long (≥ 2048-bit key)', () => {
    // A 2048-bit number has ⌈2048 × log₁₀2⌉ = 617 decimal digits.
    const { N } = km.getPublicComponents();
    expect(N.length).toBeGreaterThanOrEqual(600);
  });
});

// ---------------------------------------------------------------------------
// Disk persistence
// ---------------------------------------------------------------------------

describe('keyManager – disk persistence', () => {
  // Ensure the key is initialised before checking file existence.
  beforeAll(() => km.loadOrGenerateKey());

  test('keys/private.pem exists after initialisation', () => {
    expect(fs.existsSync(path.join(REAL_KEYS_DIR, 'private.pem'))).toBe(true);
  });

  test('keys/public.pem exists after initialisation', () => {
    expect(fs.existsSync(path.join(REAL_KEYS_DIR, 'public.pem'))).toBe(true);
  });

  test('keys/private.pem contains a valid PEM header', () => {
    const privatePem = path.join(REAL_KEYS_DIR, 'private.pem');
    if (fs.existsSync(privatePem)) {
      expect(fs.readFileSync(privatePem, 'utf8')).toMatch(
        /-----BEGIN RSA PRIVATE KEY-----|-----BEGIN PRIVATE KEY-----/,
      );
    }
  });
});
