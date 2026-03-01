'use strict';

/**
 * Download ONNX models required for age estimation.
 *
 * Models (from github.com/yakhyo/facial-analysis, MIT licence):
 *   models/det_2.5g.onnx   — SCRFD-2.5G face detector  (~1 MB)
 *   models/genderage.onnx  — InsightFace gender+age     (~1.3 MB)
 *
 * Run:  node scripts/download-models.js
 */

const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');

const MODELS_DIR = path.join(__dirname, '..', 'models');

const BASE = 'https://github.com/yakhyo/facial-analysis/releases/download/v0.0.1';

const MODELS = [
  { name: 'det_2.5g.onnx',  url: `${BASE}/det_2.5g.onnx`,  size: '~1 MB' },
  { name: 'genderage.onnx', url: `${BASE}/genderage.onnx`, size: '~1.3 MB' },
];

fs.mkdirSync(MODELS_DIR, { recursive: true });

/** Follow redirects and stream the final response into destPath. */
function download(url, destPath, label, size) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destPath)) {
      console.log(`  ✓ ${label} already exists, skipping.`);
      return resolve();
    }

    console.log(`  ↓ Downloading ${label} (${size})…`);
    const tmp = destPath + '.tmp';

    function get(requestUrl, redirects) {
      if (redirects > 10) return reject(new Error('Too many redirects'));
      const mod = requestUrl.startsWith('https') ? https : http;
      mod.get(requestUrl, { headers: { 'User-Agent': 'node' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          res.resume(); // discard body
          return get(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${requestUrl}`));
        }
        const file = fs.createWriteStream(tmp);
        res.pipe(file);
        file.on('finish', () => file.close(() => {
          fs.renameSync(tmp, destPath);
          console.log(`  ✓ ${label} saved.`);
          resolve();
        }));
        file.on('error', (err) => {
          if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
          reject(err);
        });
      }).on('error', reject);
    }

    get(url, 0);
  });
}

async function main() {
  console.log('Downloading ONNX models…\n');
  for (const model of MODELS) {
    await download(model.url, path.join(MODELS_DIR, model.name), model.name, model.size);
  }
  console.log('\nAll models ready.');
}

main().catch((err) => {
  console.error('Download failed:', err.message);
  process.exit(1);
});
