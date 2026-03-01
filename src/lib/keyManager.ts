import BlindSignatures from 'blind-signatures';
import NodeRSA from 'node-rsa';
import fs from 'fs';
import path from 'path';

const KEYS_DIR = path.join(__dirname, '..', '..', 'keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem');

let _key: NodeRSA | null = null;

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
      fs.writeFileSync(PUBLIC_KEY_PATH, _key.exportKey('pkcs8-public-pem'));
      console.log('[keyManager] RSA keypair saved to keys/');
    } catch (err) {
      console.error(`[keyManager] Could not persist keypair to disk: ${(err as Error).message}`);
    }
  }

  return _key!;
}

export function getPublicComponents(): { N: string; E: string } {
  const key = loadOrGenerateKey();
  return {
    N: key.keyPair.n.toString(),
    E: key.keyPair.e.toString(),
  };
}

export function getPrivateComponents(): { N: string; D: string } {
  const key = loadOrGenerateKey();
  return {
    N: key.keyPair.n.toString(),
    D: key.keyPair.d.toString(),
  };
}

export function getKey(): NodeRSA {
  return loadOrGenerateKey();
}
