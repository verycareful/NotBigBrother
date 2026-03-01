/**
 * Age-estimate API — pure Node.js ONNX inference, no Python dependency.
 *
 * Pipeline:
 *   1. Decode uploaded image with sharp
 *   2. Detect faces with SCRFD-2.5G (ONNX, ~1 MB)
 *   3. Crop + align the largest face (1.5× expansion, as InsightFace does)
 *   4. Run InsightFace genderage model (ONNX, ~1.3 MB)
 *      Output layout [1,3]: [gender_f, gender_m, age/100]
 *
 * Models are downloaded by:  node scripts/download-models.js
 *
 * Route:
 *   POST /api/age-estimate   multipart/form-data, field "image"
 *
 * Response:
 *   200  { is_adult: boolean, face_confidence: number, age_confidence: number }
 *   400  No image provided
 *   422  No face detected
 *   500  Inference error
 *   503  Models not yet loaded
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';

const router = express.Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODELS_DIR      = path.join(__dirname, '..', '..', 'models');
const FACE_MODEL_PATH = path.join(MODELS_DIR, 'det_2.5g.onnx');
const AGE_MODEL_PATH  = path.join(MODELS_DIR, 'genderage.onnx');

/** Maximum upload size — large enough for real photos, small enough to limit DoS. */
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/** SVG excluded to avoid potential XXE via the ONNX image decoder. */
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** SCRFD model input resolution (fixed at 640×640). */
const DET_SIZE = 640;

/** InsightFace genderage model input resolution. */
const GA_SIZE = 96;

/** SCRFD confidence threshold — boxes below this score are discarded. */
const CONF_THRESHOLD = 0.5;

/** IoU threshold for non-maximum suppression. */
const IOU_THRESHOLD = 0.4;

/** Number of anchor boxes per grid cell in SCRFD-2.5G. */
const SCRFD_ANCHORS = 2;

/**
 * SCRFD-2.5G output node names (determined by model inspection).
 * Each stride level produces a score tensor and a bbox tensor.
 *
 *   stride 8  → 12800 boxes, stride 16 → 3200 boxes, stride 32 → 800 boxes
 */
const SCRFD_LEVELS = [
  { stride: 8,  scoreOut: '446', bboxOut: '449' },
  { stride: 16, scoreOut: '466', bboxOut: '469' },
  { stride: 32, scoreOut: '486', bboxOut: '489' },
] as const;

/**
 * Conservative age threshold for the adult decision.
 *
 * The genderage model has ~7 yr MAE and skews old, so we require an estimated
 * age of 25+ before declaring adult.  A genuine 13-year-old would need a
 * ~12-year overestimate to pass — well beyond the model's observed error range.
 */
const ADULT_AGE_THRESHOLD = 25;

// ---------------------------------------------------------------------------
// Model sessions (loaded once at startup)
// ---------------------------------------------------------------------------

let faceSession: ort.InferenceSession | null = null;
let ageSession:  ort.InferenceSession | null = null;

/** Loads both ONNX sessions in parallel; no-ops if already loaded. */
async function loadModels(): Promise<void> {
  if (faceSession && ageSession) return;
  try {
    [faceSession, ageSession] = await Promise.all([
      ort.InferenceSession.create(FACE_MODEL_PATH),
      ort.InferenceSession.create(AGE_MODEL_PATH),
    ]);
    console.log('[ageEstimate] ONNX models loaded.');
  } catch (err) {
    console.error('[ageEstimate] Failed to load ONNX models:', (err as Error).message);
    console.error('  Run: node scripts/download-models.js');
  }
}

loadModels();

// ---------------------------------------------------------------------------
// Multer upload config
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
 * Converts a packed RGB Buffer (H×W×3, row-major) to a CHW Float32Array,
 * normalising each channel with the given mean and std.
 *
 * SCRFD expects the input in the range [-1, 1] using mean=127.5, std=128.
 */
function rgbToCHW(raw: Buffer, h: number, w: number, mean = 127.5, std = 128.0): Float32Array {
  const chw = new Float32Array(3 * h * w);
  for (let i = 0; i < h * w; i++) {
    chw[i]             = (raw[i * 3]     - mean) / std; // R
    chw[h * w + i]     = (raw[i * 3 + 1] - mean) / std; // G
    chw[2 * h * w + i] = (raw[i * 3 + 2] - mean) / std; // B
  }
  return chw;
}

interface DetectorInput {
  data: Float32Array;
  scaleX: number;
  scaleY: number;
  padLeft: number;
  padTop: number;
}

/**
 * Letterbox-resizes the image to DET_SIZE×DET_SIZE (black padding) and returns
 * the CHW Float32Array tensor plus the scale/pad offsets needed to map
 * detector outputs back to original image coordinates.
 */
async function prepareDetectorInput(imageBuffer: Buffer): Promise<DetectorInput> {
  const meta = await sharp(imageBuffer).metadata();
  const srcW = meta.width!;
  const srcH = meta.height!;

  const scale   = Math.min(DET_SIZE / srcW, DET_SIZE / srcH);
  const newW    = Math.round(srcW * scale);
  const newH    = Math.round(srcH * scale);
  const padLeft = Math.floor((DET_SIZE - newW) / 2);
  const padTop  = Math.floor((DET_SIZE - newH) / 2);

  const { data: raw } = await sharp(imageBuffer)
    .resize(newW, newH)
    .extend({
      top: padTop,    bottom: DET_SIZE - newH - padTop,
      left: padLeft,  right:  DET_SIZE - newW - padLeft,
      background: { r: 0, g: 0, b: 0 },
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data: rgbToCHW(raw, DET_SIZE, DET_SIZE), scaleX: scale, scaleY: scale, padLeft, padTop };
}

// ---------------------------------------------------------------------------
// SCRFD face detection
// ---------------------------------------------------------------------------

/** Generates SCRFD anchor centre points (cx, cy) for one feature-map level. */
function generateAnchors(stride: number, fh: number, fw: number): number[] {
  const anchors: number[] = [];
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      for (let a = 0; a < SCRFD_ANCHORS; a++) {
        anchors.push((x + 0.5) * stride, (y + 0.5) * stride);
      }
    }
  }
  return anchors;
}

/** Intersection-over-union between two [x1,y1,x2,y2] boxes. */
function iou(a: number[], b: number[]): number {
  const inter = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
              * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter);
}

/** Greedy NMS: returns indices of kept boxes in descending score order. */
function nms(boxes: number[][], scores: number[]): number[] {
  const order     = scores.map((s, i) => [s, i] as [number, number]).sort((a, b) => b[0] - a[0]);
  const keep:     number[]    = [];
  const suppressed = new Set<number>();

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

interface FaceBox {
  x1: number; y1: number;
  x2: number; y2: number;
  score: number;
}

/** Returns the pixel area of a face bounding box. */
function faceArea(f: FaceBox): number {
  return (f.x2 - f.x1) * (f.y2 - f.y1);
}

/**
 * Runs SCRFD face detection and returns all detected faces in original image
 * coordinates, sorted by descending confidence.
 */
async function detectFaces(imageBuffer: Buffer): Promise<FaceBox[]> {
  const { data, scaleX, scaleY, padLeft, padTop } = await prepareDetectorInput(imageBuffer);

  const inputName = faceSession!.inputNames[0];
  const tensor    = new ort.Tensor('float32', data, [1, 3, DET_SIZE, DET_SIZE]);
  const results   = await faceSession!.run({ [inputName]: tensor });

  const allBoxes:  number[][] = [];
  const allScores: number[]   = [];

  for (const { stride, scoreOut, bboxOut } of SCRFD_LEVELS) {
    const fh      = DET_SIZE / stride;
    const fw      = DET_SIZE / stride;
    const anchors = generateAnchors(stride, fh, fw);
    const scores  = results[scoreOut].data as Float32Array;
    const bboxes  = results[bboxOut].data  as Float32Array;

    for (let i = 0; i < anchors.length / 2; i++) {
      if (scores[i] < CONF_THRESHOLD) continue;

      const ax = anchors[i * 2];
      const ay = anchors[i * 2 + 1];

      // SCRFD bbox output is distance-based: [left, top, right, bottom] × stride
      const l = bboxes[i * 4]     * stride;
      const t = bboxes[i * 4 + 1] * stride;
      const r = bboxes[i * 4 + 2] * stride;
      const b = bboxes[i * 4 + 3] * stride;

      // Map back to original image coordinates
      allBoxes.push([
        (ax - l - padLeft) / scaleX,
        (ay - t - padTop)  / scaleY,
        (ax + r - padLeft) / scaleX,
        (ay + b - padTop)  / scaleY,
      ]);
      allScores.push(scores[i]);
    }
  }

  if (allBoxes.length === 0) return [];

  return nms(allBoxes, allScores).map((i) => ({
    x1: allBoxes[i][0], y1: allBoxes[i][1],
    x2: allBoxes[i][2], y2: allBoxes[i][3],
    score: allScores[i],
  }));
}

// ---------------------------------------------------------------------------
// Gender + Age inference
// ---------------------------------------------------------------------------

/**
 * Crops the face region with a 1.5× scale expansion, resizes to GA_SIZE×GA_SIZE,
 * and returns a CHW Float32Array with raw 0–255 values (genderage model
 * was trained with mean=0, std=1).
 */
async function prepareAgeInput(imageBuffer: Buffer, face: FaceBox, imgW: number, imgH: number): Promise<Float32Array> {
  const cx   = (face.x1 + face.x2) / 2;
  const cy   = (face.y1 + face.y2) / 2;
  const size = Math.max(face.x2 - face.x1, face.y2 - face.y1) * 1.5;

  const left   = Math.max(0,    Math.round(cx - size / 2));
  const top    = Math.max(0,    Math.round(cy - size / 2));
  const right  = Math.min(imgW, Math.round(cx + size / 2));
  const bottom = Math.min(imgH, Math.round(cy + size / 2));

  const { data: raw } = await sharp(imageBuffer)
    .extract({ left, top, width: right - left, height: bottom - top })
    .resize(GA_SIZE, GA_SIZE)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const chw = new Float32Array(3 * GA_SIZE * GA_SIZE);
  for (let i = 0; i < GA_SIZE * GA_SIZE; i++) {
    chw[i]                         = raw[i * 3];      // R
    chw[GA_SIZE * GA_SIZE + i]     = raw[i * 3 + 1];  // G
    chw[2 * GA_SIZE * GA_SIZE + i] = raw[i * 3 + 2];  // B
  }
  return chw;
}

/**
 * Runs the InsightFace genderage model on a single face crop.
 *
 * @returns `age` — raw predicted age (rounded to nearest year);
 *          `raw` — the normalised value (0–1, multiply by 100 for years).
 */
async function estimateAge(imageBuffer: Buffer, face: FaceBox): Promise<{ age: number; raw: number }> {
  const meta = await sharp(imageBuffer).metadata();
  const chw  = await prepareAgeInput(imageBuffer, face, meta.width!, meta.height!);

  const inputName = ageSession!.inputNames[0];
  const tensor    = new ort.Tensor('float32', chw, [1, 3, GA_SIZE, GA_SIZE]);
  const results   = await ageSession!.run({ [inputName]: tensor });

  const out = results[ageSession!.outputNames[0]].data as Float32Array;
  // out[0]=gender_f, out[1]=gender_m, out[2]=age/100
  return { age: Math.round(out[2] * 100), raw: out[2] };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/**
 * POST /api/age-estimate
 *
 * Accepts a single image via multipart upload, runs face detection + age
 * estimation, and returns the binary adult/non-adult outcome.
 *
 * The raw estimated age is intentionally not returned — only the binary
 * outcome and confidence signals are exposed to minimise data leakage.
 */
router.post('/', upload.single('image'), async (req: Request, res: Response) => {
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

    // Use the largest detected face — most likely to be the subject.
    const best = faces.reduce((a, b) => (faceArea(b) > faceArea(a) ? b : a));

    const { age, raw } = await estimateAge(req.file.buffer, best);

    const is_adult = age >= ADULT_AGE_THRESHOLD;

    // face_confidence: SCRFD detection score (0–1).
    // age_confidence:  how far the raw prediction is from the decision threshold,
    //                  normalised to [0,1]. Values near 0 are ambiguous.
    const face_confidence = parseFloat(best.score.toFixed(3));
    const age_confidence  = parseFloat(Math.min(Math.abs(raw - 0.25) * 4, 1).toFixed(3));

    return res.status(200).json({ is_adult, face_confidence, age_confidence });
  } catch (err) {
    console.error('[ageEstimate] Inference error:', (err as Error).message);
    return res.status(500).json({ error: 'Age analysis failed', detail: (err as Error).message });
  }
});

export default router;
