/**
 * keyManager — RSA-2048 keypair lifecycle for the blind-signature issuer.
 *
 * Keys are persisted to `keys/` on first generation so the server can survive
 * restarts without invalidating previously issued credentials.
 *
 * IMPORTANT: Keep `keys/private.pem` out of version control (.gitignore).
 *
 * Key components are exported as decimal strings rather than jsbn BigInteger
 * instances.  blind-signatures and node-rsa each bundle their own copy of
 * jsbn, so passing BigInteger objects across module boundaries breaks modPow().
 * Callers reconstruct BigIntegers from strings using whichever jsbn copy they
 * need locally.
 */

import BlindSignatures from 'blind-signatures';
import NodeRSA from 'node-rsa';
import fs from 'fs';
import path from 'path';

const KEYS_DIR          = path.join(__dirname, '..', '..', 'keys');
const PRIVATE_KEY_PATH  = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH   = path.join(KEYS_DIR, 'public.pem');

let _key: NodeRSA | null = null;

/**
 * Returns the cached RSA keypair, loading it from disk or generating a fresh
 * one if none exists yet.  Subsequent calls return the same instance.
 *
 * @throws {Error} If an on-disk PEM file exists but cannot be read or parsed.
 */
export function loadOrGenerateKey(): NodeRSA {
  if (_key) return _key;

  if (fs.existsSync(PRIVATE_KEY_PATH)) {
    try {
      const privatePem = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
      _key = new NodeRSA(privatePem);
      console.log('[keyManager] Loaded RSA keypair from disk');
    } catch (err) {
      throw new Error(`[keyManager] Failed to read private key: ${(err as Error).message}`);
    }
  } else {
    console.log('[keyManager] Generating 2048-bit RSA keypair (first run, may take a moment)…');
    _key = BlindSignatures.keyGeneration({ b: 2048 });

    try {
      fs.mkdirSync(KEYS_DIR, { recursive: true });
      fs.writeFileSync(PRIVATE_KEY_PATH, _key.exportKey('pkcs1-private-pem'));
      fs.writeFileSync(PUBLIC_KEY_PATH,  _key.exportKey('pkcs8-public-pem'));
      console.log('[keyManager] RSA keypair saved to keys/');
    } catch (err) {
      // Key is still usable in memory for this process lifetime; warn but
      // don't crash — the server can continue signing even without persistence.
      console.error(`[keyManager] Could not persist keypair to disk: ${(err as Error).message}`);
    }
  }

  return _key!;
}

/**
 * Returns the RSA public key components as decimal strings.
 * Safe to expose publicly — required by verifiers to check credentials offline.
 */
export function getPublicComponents(): { N: string; E: string } {
  const key = loadOrGenerateKey();
  return {
    N: key.keyPair.n.toString(),
    E: key.keyPair.e.toString(),
  };
}

/**
 * Returns the RSA private key components as decimal strings.
 * Used only server-side for blind signing — never send these to clients.
 */
export function getPrivateComponents(): { N: string; D: string } {
  const key = loadOrGenerateKey();
  return {
    N: key.keyPair.n.toString(),
    D: key.keyPair.d.toString(),
  };
}

/** Convenience alias for {@link loadOrGenerateKey}. */
export function getKey(): NodeRSA {
  return loadOrGenerateKey();
}
