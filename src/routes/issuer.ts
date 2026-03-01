import express, { Request, Response } from 'express';
import BlindSignatures from 'blind-signatures';
import { BigInteger } from 'jsbn';
import { getPublicComponents, getPrivateComponents } from '../lib/keyManager';

const router = express.Router();

function blindSign(blindedStr: string): string {
  const { N, D } = getPrivateComponents();
  const blinded = new BigInteger(blindedStr);
  const result = blinded.modPow(new BigInteger(D), new BigInteger(N));
  return result.toString();
}

function isValidBigDecimal(s: unknown, modulusLength: number): s is string {
  return (
    typeof s === 'string' &&
    /^\d+$/.test(s) &&
    s.length > 0 &&
    s.length <= modulusLength
  );
}

/**
 * GET /api/issuer/public-key
 */
router.get('/public-key', (_req: Request, res: Response) => {
  res.json(getPublicComponents());
});

/**
 * POST /api/issuer/request-token
 * Body: { blindedMessage: string }
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
  const identityVerified = true;
  if (!identityVerified) {
    return res.status(403).json({ error: 'Identity verification failed' });
  }
  // --- END MOCK ---

  try {
    const blindSignature = blindSign(blindedMessage);
    return res.json({ blindSignature });
  } catch (err) {
    console.error('[issuer] Signing error:', (err as Error).message);
    return res.status(500).json({ error: 'Signing failed' });
  }
});

/**
 * POST /api/issuer/verify  (dev only)
 * Body: { token: object, signature: string }
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
    const { N, E } = getPublicComponents();
    const { N: Nstr, D: Dstr } = getPrivateComponents();
    const message = JSON.stringify(token);

    const publicKeyValid = BlindSignatures.verify({ unblinded: signature as string, N, E, message });

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
