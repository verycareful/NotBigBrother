'use strict';

/**
 * keyManager — RSA-2048 keypair lifecycle for the blind-signature issuer.
 *
 * Keys are persisted to `keys/` on first generation so the server can
 * survive restarts without re-issuing credentials against a different key.
 *
 * IMPORTANT: Keep `keys/private.pem` out of version control (.gitignore).
 *
 * Key components are exported as decimal strings rather than jsbn BigInteger
 * instances.  blind-signatures and node-rsa each bundle their own copy of
 * jsbn, so passing BigInteger objects across module boundaries breaks modPow().
 * Callers reconstruct BigIntegers from strings using the jsbn copy they need.
 */

const BlindSignatures = require('blind-signatures');
const NodeRSA = require('node-rsa');
const fs = require('fs');
const path = require('path');

const KEYS_DIR = path.join(__dirname, '..', 'keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem');

/** @type {import('node-rsa') | null} */
let _key = null;

/**
 * Loads the RSA keypair from disk, or generates and persists a fresh one if
 * none exists.  Subsequent calls return the cached instance immediately.
 *
 * @returns {import('node-rsa')} The loaded or freshly-generated RSA key.
 * @throws {Error} If the on-disk PEM is unreadable or corrupt.
 */
function loadOrGenerateKey() {
  if (_key) return _key;

  if (fs.existsSync(PRIVATE_KEY_PATH)) {
    try {
      const privatePem = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
      _key = new NodeRSA(privatePem);
      console.log('[keyManager] Loaded RSA keypair from disk');
    } catch (err) {
      throw new Error(`[keyManager] Failed to read private key: ${err.message}`);
    }
  } else {
    console.log('[keyManager] Generating 2048-bit RSA keypair (first run, may take a moment)…');
    _key = BlindSignatures.keyGeneration({ b: 2048 });

    try {
      fs.mkdirSync(KEYS_DIR, { recursive: true });
      fs.writeFileSync(PRIVATE_KEY_PATH, _key.exportKey('pkcs1-private-pem'));
      fs.writeFileSync(PUBLIC_KEY_PATH, _key.exportKey('pkcs8-public-pem'));
      console.log('[keyManager] RSA keypair saved to keys/');
    } catch (err) {
      // Key is still usable in memory; warn but don't crash.
      console.error(`[keyManager] Could not persist keypair to disk: ${err.message}`);
    }
  }

  return _key;
}

/**
 * Returns the public key components as decimal strings.
 * Safe to expose publicly — required by verifiers to check credentials offline.
 *
 * @returns {{ N: string, E: string }}
 */
function getPublicComponents() {
  const key = loadOrGenerateKey();
  return {
    N: key.keyPair.n.toString(),
    E: key.keyPair.e.toString(),
  };
}

/**
 * Returns the private key components as decimal strings.
 * Used only server-side for blind signing — never send these to clients.
 *
 * @returns {{ N: string, D: string }}
 */
function getPrivateComponents() {
  const key = loadOrGenerateKey();
  return {
    N: key.keyPair.n.toString(),
    D: key.keyPair.d.toString(),
  };
}

/** @returns {import('node-rsa')} */
function getKey() {
  return loadOrGenerateKey();
}

module.exports = { loadOrGenerateKey, getPublicComponents, getPrivateComponents, getKey };
