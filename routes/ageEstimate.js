'use strict';

/**
 * Age-estimate API — pure Node.js ONNX inference, no Python dependency.
 *
 * Pipeline:
 *   1. Decode uploaded image with sharp
 *   2. Detect faces with SCRFD-2.5G (ONNX, ~1 MB)
 *   3. Crop + align largest face to 64×64
 *   4. Run InsightFace genderage model (ONNX, ~1.3 MB)
 *      Output [1,3]: [gender_f, gender_m, age/100]
 *
 * Models downloaded by:  node scripts/download-models.js
 *
 * Route:
 *   POST /api/age-estimate   multipart/form-data, field "image"
 */

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const sharp   = require('sharp');
const ort     = require('onnxruntime-node');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODELS_DIR      = path.join(__dirname, '..', 'models');
const FACE_MODEL_PATH = path.join(MODELS_DIR, 'det_2.5g.onnx');
const AGE_MODEL_PATH  = path.join(MODELS_DIR, 'genderage.onnx');

const MAX_FILE_SIZE     = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// SCRFD input size (model is fixed at 640×640)
const DET_SIZE = 640;
// genderage model input size (this build uses 96×96)
const GA_SIZE  = 96;

// ---------------------------------------------------------------------------
// Model sessions (loaded once at startup)
// ---------------------------------------------------------------------------

let faceSession = null;
let ageSession  = null;

async function loadModels() {
  if (faceSession && ageSession) return;
  try {
    [faceSession, ageSession] = await Promise.all([
      ort.InferenceSession.create(FACE_MODEL_PATH),
      ort.InferenceSession.create(AGE_MODEL_PATH),
    ]);
    console.log('[ageEstimate] ONNX models loaded.');
  } catch (err) {
    console.error('[ageEstimate] Failed to load ONNX models:', err.message);
    console.error('  Run: node scripts/download-models.js');
  }
}

loadModels();

// ---------------------------------------------------------------------------
// Multer
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
// Image helpers
// ---------------------------------------------------------------------------

/**
 * Convert a raw RGB Buffer (H×W×3) to a CHW Float32Array.
 * SCRFD expects values in [-1, 1] via mean=127.5, std=128.
 */
function rgbToCHW(raw, h, w, mean = 127.5, std = 128.0) {
  const chw = new Float32Array(3 * h * w);
  for (let i = 0; i < h * w; i++) {
    chw[i]           = (raw[i * 3]     - mean) / std; // R
    chw[h * w + i]   = (raw[i * 3 + 1] - mean) / std; // G
    chw[2 * h * w + i] = (raw[i * 3 + 2] - mean) / std; // B
  }
  return chw;
}

/**
 * Letterbox-resize imageBuffer to DET_SIZE×DET_SIZE (pad with 0).
 * Returns { data: Float32Array [1,3,H,W], scaleX, scaleY, padLeft, padTop }
 */
async function prepareDetectorInput(imageBuffer) {
  const meta = await sharp(imageBuffer).metadata();
  const srcW = meta.width;
  const srcH = meta.height;

  const scale = Math.min(DET_SIZE / srcW, DET_SIZE / srcH);
  const newW  = Math.round(srcW * scale);
  const newH  = Math.round(srcH * scale);
  const padLeft = Math.floor((DET_SIZE - newW) / 2);
  const padTop  = Math.floor((DET_SIZE - newH) / 2);

  const { data: raw } = await sharp(imageBuffer)
    .resize(newW, newH)
    .extend({ top: padTop, bottom: DET_SIZE - newH - padTop,
              left: padLeft, right: DET_SIZE - newW - padLeft,
              background: { r: 0, g: 0, b: 0 } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const chw = rgbToCHW(raw, DET_SIZE, DET_SIZE);
  return { data: chw, scaleX: scale, scaleY: scale, padLeft, padTop };
}

// ---------------------------------------------------------------------------
// SCRFD face detection
// ---------------------------------------------------------------------------

const CONF_THRESHOLD = 0.5;
const IOU_THRESHOLD  = 0.4;

// SCRFD-2.5G output layout (determined from model inspection):
// stride 8  → score 446 (12800×1), bbox 449 (12800×4), kps 452 (12800×10)
// stride 16 → score 466 ( 3200×1), bbox 469 ( 3200×4), kps 472 ( 3200×10)
// stride 32 → score 486 (  800×1), bbox 489 (  800×4), kps 492 (  800×10)
const SCRFD_LEVELS = [
  { stride: 8,  scoreOut: '446', bboxOut: '449' },
  { stride: 16, scoreOut: '466', bboxOut: '469' },
  { stride: 32, scoreOut: '486', bboxOut: '489' },
];
const SCRFD_ANCHORS = 2;

function generateAnchors(stride, fh, fw) {
  const anchors = [];
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      for (let a = 0; a < SCRFD_ANCHORS; a++) {
        anchors.push((x + 0.5) * stride, (y + 0.5) * stride);
      }
    }
  }
  return anchors;
}

function iou(a, b) {
  const ix1 = Math.max(a[0], b[0]);
  const iy1 = Math.max(a[1], b[1]);
  const ix2 = Math.min(a[2], b[2]);
  const iy2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter);
}

function nms(boxes, scores) {
  const order = scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
  const keep = [];
  const suppressed = new Set();
  for (const [, i] of order) {
    if (suppressed.has(i)) continue;
    keep.push(i);
    for (const [, j] of order) {
      if (j !== i && !suppressed.has(j) && iou(boxes[i], boxes[j]) > IOU_THRESHOLD) {
        suppressed.add(j);
      }
    }
  }
  return keep;
}

/**
 * Run SCRFD and return bounding boxes [{x1,y1,x2,y2,score}] in original image coords.
 */
async function detectFaces(imageBuffer) {
  const { data, scaleX, scaleY, padLeft, padTop } = await prepareDetectorInput(imageBuffer);

  const inputName = faceSession.inputNames[0];
  const tensor = new ort.Tensor('float32', data, [1, 3, DET_SIZE, DET_SIZE]);
  const results = await faceSession.run({ [inputName]: tensor });

  const allBoxes  = [];
  const allScores = [];

  for (const { stride, scoreOut, bboxOut } of SCRFD_LEVELS) {
    const fh = DET_SIZE / stride;
    const fw = DET_SIZE / stride;
    const anchors = generateAnchors(stride, fh, fw);

    const scores = results[scoreOut].data;
    const bboxes = results[bboxOut].data;

    for (let i = 0; i < anchors.length / 2; i++) {
      const score = scores[i];
      if (score < CONF_THRESHOLD) continue;

      const ax = anchors[i * 2];
      const ay = anchors[i * 2 + 1];

      // SCRFD bbox output is distance-based: [left, top, right, bottom] × stride
      const l = bboxes[i * 4]     * stride;
      const t = bboxes[i * 4 + 1] * stride;
      const r = bboxes[i * 4 + 2] * stride;
      const b = bboxes[i * 4 + 3] * stride;

      // Map back to original image coordinates
      const x1 = (ax - l - padLeft) / scaleX;
      const y1 = (ay - t - padTop)  / scaleY;
      const x2 = (ax + r - padLeft) / scaleX;
      const y2 = (ay + b - padTop)  / scaleY;

      allBoxes.push([x1, y1, x2, y2]);
      allScores.push(score);
    }
  }

  if (allBoxes.length === 0) return [];

  const kept = nms(allBoxes, allScores);
  return kept.map(i => ({
    x1: allBoxes[i][0], y1: allBoxes[i][1],
    x2: allBoxes[i][2], y2: allBoxes[i][3],
    score: allScores[i],
  }));
}

// ---------------------------------------------------------------------------
// Gender + Age inference
// ---------------------------------------------------------------------------

/**
 * Crop the face region with a 1.5× scale expansion (as InsightFace does),
 * resize to GA_SIZE×GA_SIZE, return CHW Float32Array (mean=0, std=1, 0–255 range).
 */
async function prepareAgeInput(imageBuffer, face, imgW, imgH) {
  const cx = (face.x1 + face.x2) / 2;
  const cy = (face.y1 + face.y2) / 2;
  const size = Math.max(face.x2 - face.x1, face.y2 - face.y1) * 1.5;

  const left   = Math.max(0, Math.round(cx - size / 2));
  const top    = Math.max(0, Math.round(cy - size / 2));
  const right  = Math.min(imgW, Math.round(cx + size / 2));
  const bottom = Math.min(imgH, Math.round(cy + size / 2));

  const { data: raw } = await sharp(imageBuffer)
    .extract({ left, top, width: right - left, height: bottom - top })
    .resize(GA_SIZE, GA_SIZE)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // CHW, values 0–255 (genderage model was trained with mean=0, std=1)
  const chw = new Float32Array(3 * GA_SIZE * GA_SIZE);
  for (let i = 0; i < GA_SIZE * GA_SIZE; i++) {
    chw[i]                       = raw[i * 3];     // R
    chw[GA_SIZE * GA_SIZE + i]   = raw[i * 3 + 1]; // G
    chw[2 * GA_SIZE * GA_SIZE + i] = raw[i * 3 + 2]; // B
  }
  return chw;
}

async function estimateAge(imageBuffer, face) {
  const meta = await sharp(imageBuffer).metadata();
  const chw  = await prepareAgeInput(imageBuffer, face, meta.width, meta.height);

  const inputName = ageSession.inputNames[0];
  const tensor    = new ort.Tensor('float32', chw, [1, 3, GA_SIZE, GA_SIZE]);
  const results   = await ageSession.run({ [inputName]: tensor });

  const out = results[ageSession.outputNames[0]].data; // [gender_f, gender_m, age/100]
  return { age: Math.round(out[2] * 100), raw: out[2] };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image provided' });
  }

  if (!faceSession || !ageSession) {
    return res.status(503).json({ error: 'Models not loaded. Run: node scripts/download-models.js' });
  }

  try {
    const faces = await detectFaces(req.file.buffer);

    if (faces.length === 0) {
      return res.status(422).json({ error: 'no_face_detected' });
    }

    // Use the largest face by area
    const best = faces.reduce((a, b) =>
      (b.x2 - b.x1) * (b.y2 - b.y1) > (a.x2 - a.x1) * (a.y2 - a.y1) ? b : a
    );

    const { age, raw } = await estimateAge(req.file.buffer, best);

    // The genderage model has ~7 yr MAE and skews old, so we apply a
    // conservative threshold: require an estimated age of 25+ before
    // declaring adult. A genuine 13-year-old would need a ~12-year
    // overestimate to pass — well beyond the model's observed error range.
    const is_adult = age >= 25;

    // face_confidence: how clearly SCRFD detected a face (0–1).
    // age_confidence: how far the raw prediction is from the threshold,
    // normalised to [0,1]. Values near 0 are ambiguous; near 1 are clear.
    // NOTE: the raw age value is intentionally never returned — only the
    // binary adult/non-adult outcome and confidence signals are exposed.
    const face_confidence = parseFloat(best.score.toFixed(3));
    const age_confidence  = parseFloat(Math.min(Math.abs(raw - 0.25) * 4, 1).toFixed(3));

    return res.status(200).json({ is_adult, face_confidence, age_confidence });
  } catch (err) {
    console.error('[ageEstimate] Inference error:', err.message);
    return res.status(500).json({ error: 'Age analysis failed', detail: err.message });
  }
});

module.exports = router;
