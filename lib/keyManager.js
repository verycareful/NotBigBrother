'use strict';

const BlindSignatures = require('blind-signatures');
const NodeRSA = require('node-rsa');
const fs = require('fs');
const path = require('path');

const KEYS_DIR = path.join(__dirname, '..', 'keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem');

let _key = null;

function loadOrGenerateKey() {
  if (_key) return _key;

  if (fs.existsSync(PRIVATE_KEY_PATH)) {
    const privatePem = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
    _key = new NodeRSA(privatePem);
    console.log('[keyManager] Loaded RSA keypair from disk');
  } else {
    console.log('[keyManager] Generating 2048-bit RSA keypair (first run, may take a moment)...');
    _key = BlindSignatures.keyGeneration({ b: 2048 });

    if (!fs.existsSync(KEYS_DIR)) {
      fs.mkdirSync(KEYS_DIR, { recursive: true });
    }

    fs.writeFileSync(PRIVATE_KEY_PATH, _key.exportKey('pkcs1-private-pem'));
    fs.writeFileSync(PUBLIC_KEY_PATH, _key.exportKey('pkcs8-public-pem'));
    console.log('[keyManager] RSA keypair saved to keys/');
  }

  return _key;
}

function getPublicComponents() {
  const key = loadOrGenerateKey();
  return {
    N: key.keyPair.n.toString(),
    E: key.keyPair.e.toString(),
  };
}

// Returns key components as decimal strings for use with jsbn BigInteger.
// node-rsa bundles its own jsbn internally, so we export strings rather than
// BigInteger instances to avoid cross-module identity issues.
function getPrivateComponents() {
  const key = loadOrGenerateKey();
  return {
    N: key.keyPair.n.toString(),
    D: key.keyPair.d.toString(),
  };
}

function getKey() {
  return loadOrGenerateKey();
}

module.exports = { loadOrGenerateKey, getPublicComponents, getPrivateComponents, getKey };
