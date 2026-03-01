/**
 * Tests for src/routes/issuer.ts
 *
 * The issuer router is mounted on a minimal Express app so supertest can
 * exercise it without starting the full server (no port binding, no ONNX
 * model loading).
 *
 * Coverage:
 *   GET  /public-key          → returns { N, E } as decimal strings
 *   POST /request-token       → validates input, rejects bad requests
 *   POST /request-token       → full blind-signature round-trip
 *   POST /verify              → blocked in production
 *   POST /verify              → validates a real round-trip in development
 */

import express from 'express';
import request from 'supertest';
import BlindSignatures from 'blind-signatures';
import { getPublicComponents } from '../lib/keyManager';

// Build the test app once — RSA key generation is expensive and is shared
// across all suites in this file via the keyManager singleton.
function buildApp() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const issuerRouter = require('../routes/issuer').default;
  const app = express();
  app.use(express.json());
  app.use('/', issuerRouter);
  return app;
}

const app = buildApp();

// ---------------------------------------------------------------------------
// GET /public-key
// ---------------------------------------------------------------------------

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
    const res   = await request(app).get('/public-key');
    expect(res.body.N).toBe(N);
  });
});

// ---------------------------------------------------------------------------
// POST /request-token — input validation
// ---------------------------------------------------------------------------

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
    const res = await request(app).post('/request-token').send({ blindedMessage: 'not-a-number' });
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
    const { N }   = getPublicComponents();
    const tooLong = '1'.repeat(N.length + 1);
    const res     = await request(app).post('/request-token').send({ blindedMessage: tooLong });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /request-token — blind-signature round-trip
// ---------------------------------------------------------------------------

describe('POST /request-token – blind signature round-trip', () => {
  /**
   * Full end-to-end test of the blind-signature protocol:
   *   1. Fetch N and E from the server.
   *   2. Blind a message with a random blinding factor.
   *   3. POST the blinded hash → receive a blind signature.
   *   4. Unblind the signature.
   *   5. Verify the unblinded signature against the original message.
   */
  it('blind → sign → unblind → verify succeeds', async () => {
    const { N, E } = (await request(app).get('/public-key')).body as { N: string; E: string };
    const message  = JSON.stringify({ type: 'age', min_age: 18, nonce: 'abc123' });

    const { blinded, r } = BlindSignatures.blind({ message, N, E });

    const tokenRes = await request(app)
      .post('/request-token')
      .send({ blindedMessage: blinded.toString() });

    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body).toHaveProperty('blindSignature');

    const unblinded = BlindSignatures.unblind({ signed: tokenRes.body.blindSignature, N, r });
    const valid     = BlindSignatures.verify({ unblinded: unblinded.toString(), N, E, message });

    expect(valid).toBe(true);
  });

  it('returns a decimal string blindSignature', async () => {
    const { N, E }    = getPublicComponents();
    const { blinded } = BlindSignatures.blind({ message: 'test', N, E });

    const res = await request(app).post('/request-token').send({ blindedMessage: blinded.toString() });

    expect(res.status).toBe(200);
    expect(typeof res.body.blindSignature).toBe('string');
    expect(res.body.blindSignature).toMatch(/^\d+$/);
  });

  // RSA signing is slow — allow up to 30 s for two parallel requests.
  it('produces different blind signatures for the same message when blinded with different r values', async () => {
    const { N, E } = getPublicComponents();
    const message  = 'same-message';

    const { blinded: b1 } = BlindSignatures.blind({ message, N, E });
    const { blinded: b2 } = BlindSignatures.blind({ message, N, E });

    const [res1, res2] = await Promise.all([
      request(app).post('/request-token').send({ blindedMessage: b1.toString() }),
      request(app).post('/request-token').send({ blindedMessage: b2.toString() }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    // Different blinding factors produce different blind signatures.
    expect(res1.body.blindSignature).not.toBe(res2.body.blindSignature);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// POST /verify (dev-only endpoint)
// ---------------------------------------------------------------------------

describe('POST /verify', () => {
  // Save and restore NODE_ENV around each test so a mid-test throw cannot
  // leave the environment in the wrong state for subsequent tests.
  let savedEnv: string | undefined;
  beforeEach(() => { savedEnv = process.env.NODE_ENV; });
  afterEach(()  => { process.env.NODE_ENV = savedEnv; });

  it('returns 403 when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(app)
      .post('/verify')
      .send({ token: { foo: 'bar' }, signature: '12345' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when signature is missing', async () => {
    process.env.NODE_ENV = 'development';
    const res = await request(app).post('/verify').send({ token: { foo: 'bar' } });
    expect(res.status).toBe(400);
  });

  it('returns { publicKeyValid: false } for a tampered signature', async () => {
    process.env.NODE_ENV = 'development';
    const res = await request(app)
      .post('/verify')
      .send({ token: { foo: 'bar' }, signature: '99999' });
    expect(res.status).toBe(200);
    expect(res.body.publicKeyValid).toBe(false);
  });

  // RSA signing is slow — allow extra time.
  it('validates a real unblinded signature (full round-trip)', async () => {
    process.env.NODE_ENV = 'development';

    const token   = { type: 'age', min_age: 18, nonce: 'xyz789' };
    const message = JSON.stringify(token);
    const { N, E } = getPublicComponents();

    const { blinded, r } = BlindSignatures.blind({ message, N, E });
    const signRes  = await request(app).post('/request-token').send({ blindedMessage: blinded.toString() });
    const signature = BlindSignatures.unblind({ signed: signRes.body.blindSignature, N, r });

    const verifyRes = await request(app)
      .post('/verify')
      .send({ token, signature: signature.toString() });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.publicKeyValid).toBe(true);
    expect(verifyRes.body.privateKeyValid).toBe(true);
  }, 30_000);
});
