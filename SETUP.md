# Setup & Usage Guide

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- npm (included with Node.js)
- Internet access during first run (to download ONNX models, ~2.3 MB total)

---

## Installation

```bash
# Clone the repository
git clone https://github.com/Zonde246/NotBigBrother.git
cd NotBigBrother

# Install dependencies (also auto-downloads ONNX models via postinstall)
npm install
```

The `postinstall` script downloads two ONNX models into `models/`:
- `det_2.5g.onnx` — SCRFD face detector (~1 MB)
- `genderage.onnx` — InsightFace gender + age estimator (~1.3 MB)

If the download fails or you need to re-run it manually:

```bash
npm run download-models
```

---

## Running the Server

```bash
# Production / standard
npm start

# Development (auto-restarts on file changes, requires Node 18+)
npm run dev
```

The server starts on **http://localhost:3001** by default.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the server listens on |
| `ALLOWED_ORIGINS` | `http://localhost:3001` | Comma-separated CORS-allowed origins |
| `NODE_ENV` | — | Set to `production` to disable the debug `/api/issuer/verify` endpoint |

Example with custom values:

```bash
PORT=8080 ALLOWED_ORIGINS=https://mysite.com npm start
```

---

## Demo Pages

Once the server is running, open these in your browser:

| Route | Description |
|---|---|
| `http://localhost:3001/` | Landing page |
| `http://localhost:3001/demo` | Age-estimation demo (camera or image upload) |
| `http://localhost:3001/verify` | Token verification demo |

---

## API Endpoints

### `GET /api/issuer/public-key`
Returns the server's RSA public key components (`N`, `E`) as decimal strings. Used by third parties to verify tokens offline — no server call needed at verification time.

### `POST /api/issuer/request-token`
Issues a blind signature for a blinded message after age verification.

**Body:**
```json
{ "blindedMessage": "<decimal string>" }
```

**Response:**
```json
{ "blindSignature": "<decimal string>" }
```

> **Note:** The identity check is currently mocked (all requests approved). Replace the mock in `routes/issuer.js` with a real verification provider before deploying.

### `POST /api/issuer/verify` *(dev only)*
Debug helper that confirms a credential signature is valid. Disabled when `NODE_ENV=production`.

**Body:**
```json
{ "token": { ... }, "signature": "<decimal string>" }
```

**Response:**
```json
{ "publicKeyValid": true, "privateKeyValid": true }
```

### `POST /api/age-estimate`
Accepts an uploaded image and returns an estimated age using the ONNX models.

---

## Rebuilding Client Bundles

The client-side JS is pre-bundled. If you modify `public/js/demo.js` or `public/js/verify.js`, rebuild with:

```bash
# Requires browserify (already in devDependencies)
npm run bundle:all
```

Or individually:

```bash
npm run bundle         # rebuilds demo.bundle.js
npm run bundle:verify  # rebuilds verify.bundle.js
```

---

## Integrating Token Verification into Your Website

No API key or account required. Token verification is fully offline:

```js
import { verify } from '@notbigbrother/verify';

const isValid = await verify(tokenFromUser);

if (isValid) {
  // User is confirmed 18+. You know nothing else about them.
}
```

The library validates the token against NotBigBrother's published public key locally. No network calls are made at verification time.

---

## Production Checklist

- [ ] Set `NODE_ENV=production` to disable the debug verify endpoint
- [ ] Set `ALLOWED_ORIGINS` to your actual domain(s)
- [ ] Replace the mock identity check in `routes/issuer.js` with a real age-verification provider
- [ ] Run behind a reverse proxy (nginx, Caddy) with TLS
- [ ] Ensure `models/` directory is writable for first-run model downloads, or pre-populate it in your Docker image
