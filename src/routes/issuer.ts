/**
 * Issuer API — blind-signature token issuance and offline-verification helper.
 *
 * Routes:
 *   GET  /api/issuer/public-key      Public RSA components (N, E) as decimal strings.
 *   POST /api/issuer/request-token   Issues a blind signature after identity check.
 *   POST /api/issuer/verify          Dev-only: confirms a credential signature is valid.
 *
 * Cryptographic note
 * ------------------
 * blind-signatures and node-rsa each bundle their own copy of jsbn internally.
 * Passing BigInteger instances across module boundaries breaks modPow() on
 * Node ≥ 22 due to differing prototype chains.
 * Fix: key components are exported as decimal strings; BigIntegers are
 * reconstructed here from the jsbn copy that blind-signatures uses directly.
 */

import express, { Request, Response } from 'express';
import BlindSignatures from 'blind-signatures';
import { BigInteger } from 'jsbn';
import { getPublicComponents, getPrivateComponents } from '../lib/keyManager';

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Computes a raw RSA blind signature: blindedStr^D mod N.
 *
 * @param blindedStr - Decimal string of the blinded message BigInteger.
 * @returns Decimal string of the resulting blind signature.
 */
function blindSign(blindedStr: string): string {
  const { N, D } = getPrivateComponents();
  const result = new BigInteger(blindedStr).modPow(new BigInteger(D), new BigInteger(N));
  return result.toString();
}

/**
 * Type-guard: returns true when `s` is a non-empty decimal string whose length
 * does not exceed `modulusLength`.  The length cap prevents runaway modPow()
 * calls on inputs larger than the RSA modulus.
 */
function isValidBigDecimal(s: unknown, modulusLength: number): s is string {
  return (
    typeof s === 'string' &&
    s.length > 0 &&
    s.length <= modulusLength &&
    /^\d+$/.test(s)
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
 *
 * Response: { N: string, E: string }
 */
router.get('/public-key', (_req: Request, res: Response) => {
  res.json(getPublicComponents());
});

/**
 * POST /api/issuer/request-token
 *
 * Issues a blind signature after confirming the user's age.
 *
 * Body:     { blindedMessage: string }  — decimal string from BlindSignatures.blind()
 * Response: { blindSignature: string }  — decimal string
 *
 * TODO: Replace the mock identity check with real age verification
 *       (e.g. government ID scan, bank/open-banking API, etc.).
 */
router.post('/request-token', (req: Request, res: Response) => {
  const { blindedMessage } = req.body as { blindedMessage: unknown };
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
    return res.json({ blindSignature: blindSign(blindedMessage) });
  } catch (err) {
    console.error('[issuer] Signing error:', (err as Error).message);
    return res.status(500).json({ error: 'Signing failed' });
  }
});

/**
 * POST /api/issuer/verify  (development only — blocked in production)
 *
 * Debug helper that confirms a credential's signature using both the public
 * key (what any website does) and the private key (server self-check).
 * Not required by the privacy model — offline verification uses the public
 * key alone.
 *
 * Body:     { token: object, signature: string }
 * Response: { publicKeyValid: boolean, privateKeyValid: boolean }
 */
router.post('/verify', (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { token, signature } = req.body as { token: unknown; signature: unknown };

  if (!token || !signature) {
    return res.status(400).json({ error: 'token and signature are required' });
  }

  try {
    const { N, E }          = getPublicComponents();
    const { N: Nstr, D: Dstr } = getPrivateComponents();
    const message = JSON.stringify(token);

    // Public-key check — replicates what any third-party website would do.
    const publicKeyValid = BlindSignatures.verify({ unblinded: signature as string, N, E, message });

    // Private-key check — manual because of the jsbn cross-module issue on Node ≥ 22.
    const msgHash = new BigInteger(BlindSignatures.messageToHash(message), 16);
    const expected = msgHash.modPow(new BigInteger(Dstr), new BigInteger(Nstr)).toString();
    const privateKeyValid = expected === signature;

    return res.json({ publicKeyValid, privateKeyValid });
  } catch (err) {
    console.error('[issuer] Verify error:', (err as Error).message);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

export default router;
