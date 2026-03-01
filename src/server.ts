import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { loadOrGenerateKey } from './lib/keyManager';
import issuerRouter from './routes/issuer';
import ageEstimateRouter from './routes/ageEstimate';

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());

const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || `http://localhost:${PORT}`).split(',').map(s => s.trim())
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

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', apiLimiter);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/issuer', issuerRouter);
app.use('/api/age-estimate', ageEstimateRouter);

app.get('/demo', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'demo.html'));
});

app.get('/verify', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'verify.html'));
});

app.get('/why-docs', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'why-docs.html'));
});

app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'index.html'));
});

loadOrGenerateKey();

const server = app.listen(PORT, () => {
  console.log(`NotBigBrother running on http://localhost:${PORT}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  console.error('[server] Failed to start:', err.message);
  process.exit(1);
});
