'use strict';

const express = require('express');
const BlindSignatures = require('blind-signatures');
const { BigInteger } = require('jsbn');
const { getPublicComponents, getPrivateComponents } = require('../lib/keyManager');

const router = express.Router();

// blind-signatures bundles its own jsbn, while node-rsa bundles a separate copy.
// Passing BigInteger instances across module boundaries breaks modPow().
// Fix: export key components as decimal strings and reconstruct with the same
// jsbn that blind-signatures uses (required directly here).
function blindSign(blindedStr) {
  const { N, D } = getPrivateComponents();
  const N_bi = new BigInteger(N);
  const D_bi = new BigInteger(D);
  const blinded_bi = new BigInteger(blindedStr);
  return blinded_bi.modPow(D_bi, N_bi).toString();
}

// GET /api/issuer/public-key
// Returns the server's RSA public key components (N, E) as decimal strings.
// Intentionally public — anyone needs this to verify tokens offline.
router.get('/public-key', (_req, res) => {
  res.json(getPublicComponents());
});

// POST /api/issuer/request-token
// Body: { blindedMessage: string }  (decimal string of a JSBN BigInteger)
// Returns: { blindSignature: string }
//
// TODO: Replace mock identity check with real age verification
// (government ID scan, bank verification, etc.)
router.post('/request-token', (req, res) => {
  const { blindedMessage } = req.body;

  if (!blindedMessage || typeof blindedMessage !== 'string' || !/^\d+$/.test(blindedMessage)) {
    return res.status(400).json({ error: 'blindedMessage must be a decimal integer string' });
  }

  // --- MOCK IDENTITY CHECK ---
  // In production, this is where you verify the user is 18+.
  // For now, we always approve.
  const identityVerified = true;
  if (!identityVerified) {
    return res.status(403).json({ error: 'Identity verification failed' });
  }
  // --- END MOCK ---

  try {
    const blindSignature = blindSign(blindedMessage);
    res.json({ blindSignature });
  } catch (err) {
    console.error('[issuer] Signing error:', err.message);
    res.status(500).json({ error: 'Signing failed' });
  }
});

// POST /api/issuer/verify
// Debug endpoint — not needed for the privacy model (verification is offline).
// Body: { token: object, signature: string }
// Returns: { publicKeyValid: boolean, privateKeyValid: boolean }
router.post('/verify', (req, res) => {
  const { token, signature } = req.body;

  if (!token || !signature) {
    return res.status(400).json({ error: 'token and signature are required' });
  }

  try {
    const { N, E } = getPublicComponents();
    const { N: Nstr, D: Dstr } = getPrivateComponents();
    const message = JSON.stringify(token);

    // Public key check — what any website does (no secrets needed)
    const publicKeyValid = BlindSignatures.verify({ unblinded: signature, N, E, message });

    // Private key check — verify2 equivalent, manual due to jsbn cross-module bug on Node 22
    const msgHash = new BigInteger(BlindSignatures.messageToHash(message), 16);
    const N_bi = new BigInteger(Nstr);
    const D_bi = new BigInteger(Dstr);
    const expected = msgHash.modPow(D_bi, N_bi).toString();
    const privateKeyValid = expected === signature;

    res.json({ publicKeyValid, privateKeyValid });
  } catch (err) {
    console.error('[issuer] Verify error:', err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

module.exports = router;
