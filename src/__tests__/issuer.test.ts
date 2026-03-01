/**
 * Tests for src/routes/issuer.ts
 *
 * We mount the issuer router on a small Express app so we can use supertest
 * without starting the real server (which listens on a port and loads ONNX
 * models we don't need here).
 *
 * What is tested:
 *  - GET  /public-key          → returns { N, E } as decimal strings
 *  - POST /request-token       → signs a valid blinded message
 *  - POST /request-token       → rejects bad / missing input with 400
 *  - POST /verify (dev-only)   → verifies a real blind-signature round-trip
 *  - POST /verify              → blocked in production
 *
 * The blind-signature round-trip test proves the full crypto pipeline works:
 *   blind → request-token → unblind → verify
 */

import express from 'express';
import request from 'supertest';
import BlindSignatures from 'blind-signatures';
import { getPublicComponents } from '../lib/keyManager';

// Build the test app once – key generation is expensive so we share it across
// all tests in this file.
function buildApp() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const issuerRouter = require('../routes/issuer').default;
  const app = express();
  app.use(express.json());
  app.use('/', issuerRouter);
  return app;
}

const app = buildApp();

// ─── GET /public-key ─────────────────────────────────────────────────────────

describe('GET /public-key', () => {
  it('responds with 200', async () => {
    const res = await request(app).get('/public-key');
    expect(res.status).toBe(200);
  });

  it('returns an object with N and E fields', async () => {
    const res = await request(app).get('/public-key');
    expect(res.body).toHaveProperty('N');
    expect(res.body).toHaveProperty('E');
  });

  it('N and E are non-empty decimal strings', async () => {
    const res = await request(app).get('/public-key');
    expect(typeof res.body.N).toBe('string');
    expect(typeof res.body.E).toBe('string');
    expect(res.body.N).toMatch(/^\d+$/);
    expect(res.body.E).toMatch(/^\d+$/);
  });

  it('N matches what keyManager reports directly', async () => {
    const { N } = getPublicComponents();
    const res = await request(app).get('/public-key');
    expect(res.body.N).toBe(N);
  });
});

// ─── POST /request-token – validation ────────────────────────────────────────

describe('POST /request-token – input validation', () => {
  it('returns 400 when body is empty', async () => {
    const res = await request(app).post('/request-token').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when blindedMessage is missing', async () => {
    const res = await request(app).post('/request-token').send({ other: 'field' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when blindedMessage contains non-digit characters', async () => {
    const res = await request(app)
      .post('/request-token')
      .send({ blindedMessage: 'not-a-number' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when blindedMessage is an empty string', async () => {
    const res = await request(app).post('/request-token').send({ blindedMessage: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when blindedMessage is a number (not a string)', async () => {
    const res = await request(app).post('/request-token').send({ blindedMessage: 12345 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when blindedMessage is longer than the modulus', async () => {
    const { N } = getPublicComponents();
    // One more digit than the modulus length
    const tooLong = '1'.repeat(N.length + 1);
    const res = await request(app).post('/request-token').send({ blindedMessage: tooLong });
    expect(res.status).toBe(400);
  });
});

// ─── POST /request-token – happy path & full crypto round-trip ───────────────

describe('POST /request-token – blind signature round-trip', () => {
  /**
   * This is the most important test: it exercises the exact same flow the
   * browser demo uses.
   *
   * Steps:
   *  1. Fetch N and E from the server.
   *  2. Create a plaintext message and hash it.
   *  3. Blind the hash with a random blinding factor.
   *  4. POST the blinded hash → receive a blind signature.
   *  5. Unblind the signature.
   *  6. Verify the unblinded signature against the original message.
   */
  it('returns a blindSignature for a valid blinded message', async () => {
    // Step 1 – get public key
    const pkRes = await request(app).get('/public-key');
    const { N, E } = pkRes.body as { N: string; E: string };

    // Step 2 – create message and hash it
    const message = JSON.stringify({ type: 'age', min_age: 18, nonce: 'abc123' });

    // Step 3 – blind
    const { blinded, r } = BlindSignatures.blind({ message, N, E });

    // Step 4 – request blind signature (server expects decimal string)
    const tokenRes = await request(app)
      .post('/request-token')
      .send({ blindedMessage: blinded.toString() });

    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body).toHaveProperty('blindSignature');

    // Step 5 – unblind
    const unblinded = BlindSignatures.unblind({
      signed: tokenRes.body.blindSignature,
      N,
      r,
    });

    // Step 6 – verify (unblinded is a BigInteger; verify expects its string form)
    const valid = BlindSignatures.verify({ unblinded: unblinded.toString(), N, E, message });
    expect(valid).toBe(true);
  });

  it('returns a string blindSignature (decimal)', async () => {
    const { N, E } = getPublicComponents();
    const { blinded } = BlindSignatures.blind({ message: 'test', N, E });

    const res = await request(app).post('/request-token').send({ blindedMessage: blinded.toString() });

    expect(res.status).toBe(200);
    expect(typeof res.body.blindSignature).toBe('string');
    expect(res.body.blindSignature).toMatch(/^\d+$/);
  });

  // 2048-bit RSA signing is slow — allow up to 30 s for two parallel requests
  it('produces different signatures for the same message when blinded with different r values', async () => {  /* timeout below */
    const { N, E } = getPublicComponents();
    const message = 'same-message';

    const { blinded: b1 } = BlindSignatures.blind({ message, N, E });
    const { blinded: b2 } = BlindSignatures.blind({ message, N, E });

    const [res1, res2] = await Promise.all([
      request(app).post('/request-token').send({ blindedMessage: b1.toString() }),
      request(app).post('/request-token').send({ blindedMessage: b2.toString() }),
    ]);

    // Both succeed
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // The blind signatures differ because the blinding factors differ
    expect(res1.body.blindSignature).not.toBe(res2.body.blindSignature);
  }, 30_000);
});

// ─── POST /verify (dev-only endpoint) ────────────────────────────────────────

describe('POST /verify', () => {
  it('is blocked in production (NODE_ENV=production)', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const res = await request(app)
      .post('/verify')
      .send({ token: { foo: 'bar' }, signature: '12345' });

    expect(res.status).toBe(403);
    process.env.NODE_ENV = original;
  });

  it('returns 400 when token or signature is missing', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const res = await request(app).post('/verify').send({ token: { foo: 'bar' } });
    expect(res.status).toBe(400);

    process.env.NODE_ENV = original;
  });

  // 2048-bit RSA signing is slow — allow extra time
  it('verifies a real unblinded signature (full round-trip through /verify)', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const token = { type: 'age', min_age: 18, nonce: 'xyz789' };
    const message = JSON.stringify(token);
    const { N, E } = getPublicComponents();

    // Blind → sign → unblind
    const { blinded, r } = BlindSignatures.blind({ message, N, E });
    const signRes = await request(app)
      .post('/request-token')
      .send({ blindedMessage: blinded.toString() });

    const signature = BlindSignatures.unblind({
      signed: signRes.body.blindSignature,
      N,
      r,
    });

    const verifyRes = await request(app)
      .post('/verify')
      .send({ token, signature: signature.toString() });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.publicKeyValid).toBe(true);
    expect(verifyRes.body.privateKeyValid).toBe(true);

    process.env.NODE_ENV = original;
  }, 30_000);

  it('returns publicKeyValid=false for a tampered signature', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const res = await request(app)
      .post('/verify')
      .send({ token: { foo: 'bar' }, signature: '99999' });

    // Should succeed (HTTP 200) but report invalid
    expect(res.status).toBe(200);
    expect(res.body.publicKeyValid).toBe(false);

    process.env.NODE_ENV = original;
  });
});
