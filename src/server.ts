/**
 * NotBigBrother — privacy-preserving age verification server.
 *
 * Environment variables:
 *   PORT             Listening port (default: 3001)
 *   ALLOWED_ORIGINS  Comma-separated allowed CORS origins
 *                    (default: http://localhost:<PORT>)
 *   NODE_ENV         Set to "production" to disable the /api/issuer/verify
 *                    debug endpoint.
 */

import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { loadOrGenerateKey } from './lib/keyManager';
import issuerRouter from './routes/issuer';
import ageEstimateRouter from './routes/ageEstimate';

const app  = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Security middleware
// ---------------------------------------------------------------------------

app.use(helmet());

// CORS — only allow explicitly configured origins (deny all others by default).
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || `http://localhost:${PORT}`)
    .split(',')
    .map((s) => s.trim()),
);

app.use((req: Request, res: Response, next: NextFunction) => {
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

// Rate-limit all API routes: 100 requests per 15 minutes per IP.
app.use(
  '/api/',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  }),
);

// ---------------------------------------------------------------------------
// Body parsing & static files
// ---------------------------------------------------------------------------

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.use('/api/issuer', issuerRouter);
app.use('/api/age-estimate', ageEstimateRouter);

app.get('/demo',     (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '..', 'views', 'demo.html')));
app.get('/verify',   (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '..', 'views', 'verify.html')));
app.get('/why-docs', (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '..', 'views', 'why-docs.html')));
app.get('/',         (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '..', 'views', 'index.html')));

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

// Pre-load / generate the RSA keypair so the first request does not incur
// the ~5 s key-generation delay.
loadOrGenerateKey();

const server = app.listen(PORT, () => {
  console.log(`NotBigBrother running on http://localhost:${PORT}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  console.error('[server] Failed to start:', err.message);
  process.exit(1);
});
