'use strict';

/**
 * Age-estimate API — accepts an uploaded image, delegates analysis to the
 * Python DeepFace subprocess, and returns the estimated age.
 *
 * Route:
 *   POST /api/age-estimate   multipart/form-data with field "image"
 *
 * The image is processed entirely in memory and never written to disk.
 *
 * Exit codes from the Python subprocess:
 *   0  — Success; stdout contains { estimated_age, is_adult }
 *   1  — General failure (bad image, library error); stdout contains { error, detail }
 *   2  — No face detected; stdout contains { error: "no_face_detected" }
 */

const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const path = require('path');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PYTHON_SCRIPT = path.join(__dirname, '..', 'lib', 'age_estimator.py');
const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');

/** Maximum upload size (bytes). Generous for real photos; tight enough to limit DoS. */
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/** Subprocess wall-clock timeout (ms). Prevents hanging on malformed inputs. */
const ANALYSIS_TIMEOUT_MS = 30_000; // 30 s

/** Maximum number of concurrent Python subprocesses. */
const MAX_CONCURRENT_PROCESSES = 5;
let activeProcesses = 0;

/** Allowed image MIME types. Excludes SVG to avoid potential XXE via DeepFace. */
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// ---------------------------------------------------------------------------
// Multer configuration
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error(`Unsupported image type: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * POST /api/age-estimate
 *
 * Accepts a single image via multipart upload, pipes the raw bytes to the
 * Python age-estimator subprocess, and returns JSON with the estimated age.
 *
 * Responds with:
 *   200  { estimated_age: number, is_adult: boolean }
 *   400  No image provided or unsupported type
 *   408  Analysis timed out
 *   422  No face detected in the image
 *   500  Internal analysis error
 */
router.post('/', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image provided' });
  }

  if (activeProcesses >= MAX_CONCURRENT_PROCESSES) {
    return res.status(503).json({ error: 'Service temporarily unavailable, please try again shortly' });
  }
  activeProcesses++;

  const py = spawn(PYTHON_BIN, [PYTHON_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let responded = false;

  /** Sends a response exactly once, regardless of how many events fire. */
  function reply(status, body) {
    if (responded) return;
    responded = true;
    activeProcesses--;
    clearTimeout(timer);
    res.status(status).json(body);
  }

  // Kill the subprocess and return 408 if it exceeds the timeout.
  const timer = setTimeout(() => {
    py.kill();
    reply(408, { error: 'Age analysis timed out' });
  }, ANALYSIS_TIMEOUT_MS);

  py.stdout.on('data', (chunk) => { stdout += chunk; });
  py.stderr.on('data', (chunk) => { stderr += chunk; });

  py.on('close', (code) => {
    if (stderr) console.error('[ageEstimate] Python stderr:', stderr.trim());

    let result;
    try {
      result = JSON.parse(stdout);
    } catch {
      return reply(500, { error: 'Invalid response from age estimator' });
    }

    if (code === 2) return reply(422, { error: 'no_face_detected' }); // no face detected
    if (code !== 0) return reply(500, { error: 'Age analysis failed' }); // analysis error
    reply(200, result);
  });

  py.on('error', (err) => {
    console.error('[ageEstimate] Subprocess error:', err.message);
    reply(500, { error: 'Age analysis failed' });
  });

  // Send the raw image bytes to Python stdin, then close to signal EOF.
  py.stdin.write(req.file.buffer);
  py.stdin.end();
});

module.exports = router;
