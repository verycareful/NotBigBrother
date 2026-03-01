'use strict';

/**
 * Issuer API — blind-signature token issuance and offline-verification helper.
 *
 * Routes:
 *   GET  /api/issuer/public-key      Returns RSA public components (N, E).
 *   POST /api/issuer/request-token   Issues a blind signature after identity check.
 *   POST /api/issuer/verify          Debug helper: confirms a credential is valid.
 *
 * Cryptographic note
 * ------------------
 * blind-signatures and node-rsa each bundle their own copy of jsbn internally.
 * Passing BigInteger instances across module boundaries breaks modPow() on
 * Node ≥ 22 due to differing prototype chains.
 * Fix: key components are exported as decimal strings and BigIntegers are
 * reconstructed here using the jsbn that blind-signatures requires directly.
 */

const express = require('express');
const BlindSignatures = require('blind-signatures');
const { BigInteger } = require('jsbn');
const { getPublicComponents, getPrivateComponents } = require('../lib/keyManager');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Computes a raw RSA blind signature: blindedStr^D mod N.
 *
 * @param {string} blindedStr - Decimal string representation of the blinded message.
 * @returns {string} Decimal string of the blind signature.
 */
function blindSign(blindedStr) {
  const { N, D } = getPrivateComponents();
  const blinded = new BigInteger(blindedStr);
  const result = blinded.modPow(new BigInteger(D), new BigInteger(N));
  return result.toString();
}

/**
 * Returns true if `s` is a non-empty string of decimal digits whose length
 * does not exceed the modulus length (guards against runaway modPow inputs).
 *
 * @param {string} s
 * @param {number} modulusLength - Number of decimal digits in N.
 * @returns {boolean}
 */
function isValidBigDecimal(s, modulusLength) {
  return (
    typeof s === 'string' &&
    /^\d+$/.test(s) &&
    s.length > 0 &&
    s.length <= modulusLength
  );
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/issuer/public-key
 *
 * Returns the server's RSA public key components as decimal strings.
 * Intentionally public — anyone needs this to verify credentials offline.
 */
router.get('/public-key', (_req, res) => {
  res.json(getPublicComponents());
});

/**
 * POST /api/issuer/request-token
 *
 * Body (JSON): { blindedMessage: string }
 *   blindedMessage — decimal string of the JSBN BigInteger produced by
 *                    BlindSignatures.blind() on the client.
 *
 * Response: { blindSignature: string }
 *
 * TODO: Replace the mock identity check with real age verification
 *       (e.g. government ID scan, bank/open-banking API, etc.).
 */
router.post('/request-token', (req, res) => {
  const { blindedMessage } = req.body;
  const { N } = getPublicComponents();

  if (!isValidBigDecimal(blindedMessage, N.length)) {
    return res.status(400).json({
      error: 'blindedMessage must be a non-empty decimal integer string no longer than the modulus',
    });
  }

  // --- MOCK IDENTITY CHECK ---
  // In production, verify the user is 18+ here before signing.
  // For the demo, every request is approved.
  const identityVerified = true;
  if (!identityVerified) {
    return res.status(403).json({ error: 'Identity verification failed' });
  }
  // --- END MOCK ---

  try {
    const blindSignature = blindSign(blindedMessage);
    return res.json({ blindSignature });
  } catch (err) {
    console.error('[issuer] Signing error:', err.message);
    return res.status(500).json({ error: 'Signing failed' });
  }
});

/**
 * POST /api/issuer/verify
 *
 * Debug helper — not required by the privacy model (verification is offline).
 * Confirms that a credential's signature is valid using both the public key
 * (what a website does) and the private key (server self-check).
 *
 * Body (JSON): { token: object, signature: string }
 * Response:    { publicKeyValid: boolean, privateKeyValid: boolean }
 *
 * NOTE: This endpoint should be disabled or restricted to localhost in
 *       production to avoid leaking the signing oracle.
 */
router.post('/verify', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { token, signature } = req.body;

  if (!token || !signature) {
    return res.status(400).json({ error: 'token and signature are required' });
  }

  try {
    const { N, E } = getPublicComponents();
    const { N: Nstr, D: Dstr } = getPrivateComponents();
    const message = JSON.stringify(token);

    // Public-key check — replicates what any third-party website would do.
    const publicKeyValid = BlindSignatures.verify({ unblinded: signature, N, E, message });

    // Private-key check — manual due to jsbn cross-module issue on Node ≥ 22.
    const msgHash = new BigInteger(BlindSignatures.messageToHash(message), 16);
    const expected = msgHash.modPow(new BigInteger(Dstr), new BigInteger(Nstr)).toString();
    const privateKeyValid = expected === signature;

    return res.json({ publicKeyValid, privateKeyValid });
  } catch (err) {
    console.error('[issuer] Verify error:', err.message);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

module.exports = router;
