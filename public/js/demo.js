'use strict';

const BlindSignatures = require('blind-signatures');

// ---------------------------------------------------------------------------
// Shared state — tracks progress through the 7-step blind-signature flow
// ---------------------------------------------------------------------------

const state = {
  ageVerified: false,
  estimatedAge: null,
  N: null,           // RSA modulus (decimal string)
  E: null,           // Public exponent (decimal string)
  token: null,       // Plaintext token object (built in step 2)
  tokenString: null, // JSON.stringify(token) — hashed for signing
  blindResult: null, // { blinded: BigInteger, r: BigInteger }
  blindSignature: null,
  unblinded: null,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Token lifetime in seconds (1 year).  Server-side expiry policy should match. */
const TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60;

/** Fetch timeout in milliseconds.  Prevents hanging on unresponsive server. */
const FETCH_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Generates a cryptographically random hex nonce.
 *
 * @param {number} [bytes=16] - Number of random bytes (nonce length = bytes * 2 hex chars).
 * @returns {string} Lowercase hex string.
 */
function hexNonce(bytes = 16) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convenience wrapper — updates both the status indicator and the output
 * element for a single step in one call.
 *
 * @param {string} stepId  - Step prefix, e.g. 's0' (maps to 's0-status' and 's0-output').
 * @param {'ok'|'fail'|'loading'|'idle'} status
 * @param {string} text    - Output message.
 * @param {boolean} [isError=false] - If true, applies the error CSS class to the output.
 */
function updateStep(stepId, status, text, isError = false) {
  const statusEl = document.getElementById(`${stepId}-status`);
  const outputEl = document.getElementById(`${stepId}-output`);

  statusEl.className = `step-status ${status}`;
  statusEl.textContent = status === 'ok' ? '✓' : status === 'fail' ? '✗' : '…';

  outputEl.textContent = text;
  outputEl.className = 'step-output' + (isError ? ' error' : '');
}

/**
 * Wrapper around fetch() that aborts after FETCH_TIMEOUT_MS.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Step 0 — Age estimation via file upload or camera snapshot
// ---------------------------------------------------------------------------

/**
 * Uploads *file* to the age-estimate endpoint and updates the step-0 UI.
 *
 * @param {File} file
 */
async function estimateAgeFromFile(file) {
  updateStep('s0', 'loading', 'Analysing…');

  const formData = new FormData();
  formData.append('image', file);

  try {
    const res = await fetchWithTimeout('/api/age-estimate', { method: 'POST', body: formData });
    const data = await res.json();

    if (res.status === 422) {
      updateStep('s0', 'fail', '✗ No face detected in the image. Please upload a clear photo.', true);
      return;
    }

    if (!res.ok) {
      updateStep('s0', 'fail', `Error: ${data.error || res.statusText}`, true);
      return;
    }

    state.estimatedAge = data.estimated_age;
    state.ageVerified = data.is_adult;

    if (data.is_adult) {
      updateStep('s0', 'ok',
        `✓ Age estimated: ~${data.estimated_age} years old\n` +
        `✓ Adult confirmed (≥ 18)\n\n` +
        `Your image was processed on-server and immediately discarded.\n` +
        `Only this number was retained. Proceed to step 1.`
      );
    } else {
      updateStep('s0', 'fail',
        `✗ Age estimated: ~${data.estimated_age} years old\n` +
        `✗ Not confirmed as adult (< 18)\n\n` +
        `Age estimation has a margin of error of ~5 years.\n` +
        `In production this would fall back to a document check.`,
        true
      );
    }
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Request timed out' : err.message;
    updateStep('s0', 'fail', `Error: ${msg}`, true);
  }
}

// ---------------------------------------------------------------------------
// Step 1 — Fetch public key from server
// ---------------------------------------------------------------------------

async function fetchPublicKey() {
  updateStep('s1', 'loading', 'Fetching public key…');
  try {
    const res = await fetchWithTimeout('/api/issuer/public-key');
    const data = await res.json();
    state.N = data.N;
    state.E = data.E;
    updateStep('s1', 'ok', JSON.stringify({ N: state.N.slice(0, 40) + '…', E: state.E }, null, 2));
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Request timed out' : err.message;
    updateStep('s1', 'fail', `Error: ${msg}`, true);
  }
}

// ---------------------------------------------------------------------------
// Step 2 — Generate token payload locally
// ---------------------------------------------------------------------------

function generateToken() {
  if (!state.N) {
    updateStep('s2', 'fail', 'Complete step 1 first.', true);
    return;
  }
  if (!state.ageVerified) {
    updateStep('s2', 'fail', 'Complete step 0 (age verification) first.', true);
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  state.token = {
    type: 'age_verified',
    min_age: 18,
    estimated_age: state.estimatedAge,
    issued_at: now,
    expiry: now + TOKEN_LIFETIME_SECONDS,
    nonce: hexNonce(),
  };
  state.tokenString = JSON.stringify(state.token);

  updateStep('s2', 'ok', JSON.stringify(state.token, null, 2));
}

// ---------------------------------------------------------------------------
// Step 3 — Blind the token
// ---------------------------------------------------------------------------

function blindToken() {
  if (!state.tokenString) {
    updateStep('s3', 'fail', 'Complete step 2 first.', true);
    return;
  }

  state.blindResult = BlindSignatures.blind({
    message: state.tokenString,
    N: state.N,
    E: state.E,
  });

  const preview = state.blindResult.blinded.toString().slice(0, 60) + '…';
  updateStep('s3', 'ok',
    `blinded (first 60 digits):\n${preview}\n\n` +
    `Blinding factor r: (stored locally, never sent to server)`
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Send blinded message to server, receive blind signature
// ---------------------------------------------------------------------------

async function requestSignature() {
  if (!state.blindResult) {
    updateStep('s4', 'fail', 'Complete step 3 first.', true);
    return;
  }
  updateStep('s4', 'loading', 'Requesting blind signature…');

  try {
    const res = await fetchWithTimeout('/api/issuer/request-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blindedMessage: state.blindResult.blinded.toString() }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || res.statusText);

    state.blindSignature = data.blindSignature;
    const preview = state.blindSignature.slice(0, 60) + '…';
    updateStep('s4', 'ok',
      `blindSignature (first 60 digits):\n${preview}\n\n` +
      `(Server signed without seeing your token — only the blinded hash)`
    );
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Request timed out' : err.message;
    updateStep('s4', 'fail', `Error: ${msg}`, true);
  }
}

// ---------------------------------------------------------------------------
// Step 5 — Unblind the signature
// ---------------------------------------------------------------------------

function unblindSignature() {
  if (!state.blindSignature) {
    updateStep('s5', 'fail', 'Complete step 4 first.', true);
    return;
  }

  state.unblinded = BlindSignatures.unblind({
    signed: state.blindSignature,
    N: state.N,
    r: state.blindResult.r,
  });

  const preview = state.unblinded.toString().slice(0, 60) + '…';
  updateStep('s5', 'ok',
    `unblinded signature (first 60 digits):\n${preview}\n\n` +
    `(Blinding factor removed — this is the final credential signature)`
  );
}

// ---------------------------------------------------------------------------
// Step 6 — Verify locally (no server call)
// ---------------------------------------------------------------------------

function verifyLocally() {
  if (!state.unblinded) {
    updateStep('s6', 'fail', 'Complete step 5 first.', true);
    return;
  }

  const valid = BlindSignatures.verify({
    unblinded: state.unblinded,
    N: state.N,
    E: state.E,
    message: state.tokenString,
  });

  if (valid) {
    updateStep('s6', 'ok',
      `✓ Signature is valid!\n\n` +
      `The server's public key confirms this token was genuinely signed.\n` +
      `No server call needed — this check runs entirely in your browser.`
    );
  } else {
    updateStep('s6', 'fail', '✗ Signature invalid — something went wrong.', true);
  }
}

// ---------------------------------------------------------------------------
// Step 7 — Download credential as .nbb file
// ---------------------------------------------------------------------------

/**
 * Serialises the completed credential as "nbb1.<base64url>" and triggers a
 * browser download.  Format mirrors a signed JWT but with a custom prefix to
 * distinguish NotBigBrother credentials.
 */
function saveCredential() {
  if (!state.unblinded) {
    updateStep('s7', 'fail', 'Complete step 5 first.', true);
    return;
  }

  const payload = {
    token: state.token,
    signature: state.unblinded.toString(),
    publicKey: { N: state.N, E: state.E },
    issuedAt: new Date().toISOString(),
  };

  // base64url-encode (no padding, URL-safe alphabet)
  const b64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const fileContent = `nbb1.${b64}`;

  const blob = new Blob([fileContent], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nbb-credential.nbb';
  a.click();
  URL.revokeObjectURL(url);

  updateStep('s7', 'ok',
    `Downloaded nbb-credential.nbb\n\nnbb1.${b64.slice(0, 40)}…\n\n` +
    `Store this file like a password — it is your anonymous age credential.`
  );
}

// ---------------------------------------------------------------------------
// Camera helpers
// ---------------------------------------------------------------------------

let cameraStream = null;

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
}

function closeCameraModal() {
  stopCamera();
  document.getElementById('camera-modal').classList.remove('open');
}

async function openCameraModal() {
  updateStep('s0', 'loading', 'Requesting camera access…');

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false,
    });
  } catch (err) {
    updateStep('s0', 'fail', `Camera error: ${err.message}`, true);
    return;
  }

  document.getElementById('camera-preview').srcObject = cameraStream;
  document.getElementById('camera-modal').classList.add('open');
  updateStep('s0', 'idle', 'Camera open — click "Take Photo" when ready.');
}

function snapAndEstimate() {
  const video = document.getElementById('camera-preview');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  closeCameraModal();

  canvas.toBlob((blob) => {
    estimateAgeFromFile(new File([blob], 'snapshot.jpg', { type: 'image/jpeg' }));
  }, 'image/jpeg', 0.92);
}

// ---------------------------------------------------------------------------
// DOM wiring — runs after the document is ready
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('age-file-input');

  document.getElementById('btn-s0-upload').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) {
      estimateAgeFromFile(fileInput.files[0]);
      fileInput.value = '';
    }
  });

  document.getElementById('btn-s0-camera').addEventListener('click', openCameraModal);
  document.getElementById('btn-camera-snap').addEventListener('click', snapAndEstimate);
  document.getElementById('btn-camera-cancel').addEventListener('click', closeCameraModal);

  // Close modal when clicking the backdrop (outside the modal box).
  document.getElementById('camera-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeCameraModal();
  });

  document.getElementById('btn-s1').addEventListener('click', fetchPublicKey);
  document.getElementById('btn-s2').addEventListener('click', generateToken);
  document.getElementById('btn-s3').addEventListener('click', blindToken);
  document.getElementById('btn-s4').addEventListener('click', requestSignature);
  document.getElementById('btn-s5').addEventListener('click', unblindSignature);
  document.getElementById('btn-s6').addEventListener('click', verifyLocally);
  document.getElementById('btn-s7').addEventListener('click', saveCredential);
});
