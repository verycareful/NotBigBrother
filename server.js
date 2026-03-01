'use strict';

/**
 * NotBigBrother — privacy-preserving age verification server.
 *
 * Environment variables:
 *   PORT             Listening port (default: 3001)
 *   ALLOWED_ORIGINS  Comma-separated list of allowed CORS origins (default: http://localhost:3001)
 */

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const keyManager = require('./lib/keyManager');
const issuerRouter = require('./routes/issuer');
const ageEstimateRouter = require('./routes/ageEstimate');

const app = express();
const PORT = process.env.PORT || 3001;

// Security headers
app.use(helmet());

// CORS — restrict to configured origins only
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || `http://localhost:${PORT}`).split(',').map(s => s.trim())
);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Rate limiting on all API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', apiLimiter);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/issuer', issuerRouter);
app.use('/api/age-estimate', ageEstimateRouter);

app.get('/demo', (_req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'demo.html'));
});

app.get('/verify', (_req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'verify.html'));
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Pre-load / generate the RSA keypair at startup so the first request
// does not incur the ~5 s key-generation delay.
keyManager.loadOrGenerateKey();

const server = app.listen(PORT, () => {
  console.log(`NotBigBrother running on http://localhost:${PORT}`);
});

server.on('error', (err) => {
  console.error('[server] Failed to start:', err.message);
  process.exit(1);
});
