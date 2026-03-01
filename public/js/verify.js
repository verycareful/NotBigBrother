'use strict';

const BlindSignatures = require('blind-signatures');

const TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60;
const FETCH_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

const state = {
  N: null,
  E: null,
  estimatedAge: null,
  token: null,
  tokenString: null,
  blindResult: null,
  blindSignature: null,
  unblinded: null,
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function hexNonce(bytes = 16) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

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
// UI helpers
// ---------------------------------------------------------------------------

function setStep(id, status, label) {
  const icon = document.getElementById(`${id}-icon`);
  const lbl  = document.getElementById(`${id}-label`);

  icon.className = `pstep-icon ${status}`;
  if (status === 'spin') icon.textContent = '…';
  else if (status === 'done') icon.textContent = '✓';
  else if (status === 'err')  icon.textContent = '✗';
  else icon.textContent = '·';

  if (lbl) {
    lbl.textContent = label;
    lbl.className = `pstep-label${status === 'idle' ? ' muted' : ''}`;
  }
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.classList.add('visible');
  document.getElementById('try-again').classList.add('visible');
}

function resetUI() {
  // Hide outcomes
  document.getElementById('progress-panel').classList.remove('visible');
  document.getElementById('error-msg').classList.remove('visible');
  document.getElementById('try-again').classList.remove('visible');
  document.getElementById('download-section').classList.remove('visible');

  // Reset step indicators
  ['ps0','ps1','ps2','ps3','ps4','ps5'].forEach((id, i) => {
    const labels = [
      'Analysing photo',
      'Fetching server public key',
      'Building token payload',
      'Blinding token (your browser)',
      'Requesting blind signature',
      'Unblinding & verifying',
    ];
    setStep(id, 'idle', labels[i]);
  });

  // Reset state
  Object.keys(state).forEach(k => { state[k] = null; });
}

// ---------------------------------------------------------------------------
// Full auto-flow
// ---------------------------------------------------------------------------

async function runFlow(file) {
  resetUI();
  document.getElementById('progress-panel').classList.add('visible');

  // --- Step 0: Age estimation ---
  setStep('ps0', 'spin', 'Analysing photo…');
  const formData = new FormData();
  formData.append('image', file);

  try {
    const res = await fetchWithTimeout('/api/age-estimate', { method: 'POST', body: formData });
    const data = await res.json();

    if (res.status === 422) {
      setStep('ps0', 'err', 'No face detected in image');
      showError('No face detected. Please upload a clear, well-lit photo of your face.');
      return;
    }
    if (!res.ok) {
      setStep('ps0', 'err', 'Age estimation failed');
      showError(`Age estimation error: ${data.error || res.statusText}`);
      return;
    }
    if (!data.is_adult) {
      setStep('ps0', 'err', 'Not confirmed as adult');
      showError(
        `Age could not be confirmed as 18+. ` +
        `Age estimation has a margin of error. ` +
        `In production this would fall back to a document check.`
      );
      return;
    }

    setStep('ps0', 'done', 'Adult confirmed');
  } catch (err) {
    setStep('ps0', 'err', 'Request failed');
    showError(err.name === 'AbortError' ? 'Request timed out. Please try again.' : err.message);
    return;
  }

  // --- Step 1: Fetch public key ---
  setStep('ps1', 'spin', 'Fetching server public key…');
  try {
    const res = await fetchWithTimeout('/api/issuer/public-key');
    const data = await res.json();
    state.N = data.N;
    state.E = data.E;
    setStep('ps1', 'done', 'Public key received');
  } catch (err) {
    setStep('ps1', 'err', 'Failed to fetch public key');
    showError(err.name === 'AbortError' ? 'Request timed out.' : err.message);
    return;
  }

  // --- Step 2: Generate token ---
  setStep('ps2', 'spin', 'Building token payload…');
  const now = Math.floor(Date.now() / 1000);
  state.token = {
    type: 'age_verified',
    min_age: 18,
    issued_at: now,
    expiry: now + TOKEN_LIFETIME_SECONDS,
    nonce: hexNonce(),
  };
  state.tokenString = JSON.stringify(state.token);
  setStep('ps2', 'done', 'Token payload built');

  // --- Step 3: Blind ---
  setStep('ps3', 'spin', 'Blinding token locally…');
  state.blindResult = BlindSignatures.blind({
    message: state.tokenString,
    N: state.N,
    E: state.E,
  });
  setStep('ps3', 'done', 'Token blinded (blinding factor stays in your browser)');

  // --- Step 4: Request blind signature ---
  setStep('ps4', 'spin', 'Requesting blind signature…');
  try {
    const res = await fetchWithTimeout('/api/issuer/request-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blindedMessage: state.blindResult.blinded.toString() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    state.blindSignature = data.blindSignature;
    setStep('ps4', 'done', 'Blind signature received');
  } catch (err) {
    setStep('ps4', 'err', 'Signature request failed');
    showError(err.name === 'AbortError' ? 'Request timed out.' : err.message);
    return;
  }

  // --- Step 5: Unblind + verify ---
  setStep('ps5', 'spin', 'Unblinding and verifying…');
  state.unblinded = BlindSignatures.unblind({
    signed: state.blindSignature,
    N: state.N,
    r: state.blindResult.r,
  });

  const valid = BlindSignatures.verify({
    unblinded: state.unblinded,
    N: state.N,
    E: state.E,
    message: state.tokenString,
  });

  if (!valid) {
    setStep('ps5', 'err', 'Signature verification failed');
    showError('Signature verification failed — something went wrong. Please try again.');
    return;
  }

  setStep('ps5', 'done', 'Signature verified — credential ready');

  // Show download UI
  document.getElementById('download-section').classList.add('visible');
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

function downloadCredential() {
  const payload = {
    token: state.token,
    signature: state.unblinded.toString(),
    publicKey: { N: state.N, E: state.E },
    issuedAt: new Date().toISOString(),
  };

  const b64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const blob = new Blob([`nbb1.${b64}`], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nbb-credential.nbb';
  a.click();
  URL.revokeObjectURL(url);
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
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
  } catch (err) {
    showError(`Camera error: ${err.message}`);
    return;
  }
  document.getElementById('camera-preview').srcObject = cameraStream;
  document.getElementById('camera-modal').classList.add('open');
}

function snapPhoto() {
  const video = document.getElementById('camera-preview');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  closeCameraModal();
  canvas.toBlob((blob) => {
    runFlow(new File([blob], 'snapshot.jpg', { type: 'image/jpeg' }));
  }, 'image/jpeg', 0.92);
}

// ---------------------------------------------------------------------------
// DOM wiring
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input');

  document.getElementById('btn-upload').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) {
      runFlow(fileInput.files[0]);
      fileInput.value = '';
    }
  });

  document.getElementById('btn-camera').addEventListener('click', openCameraModal);
  document.getElementById('btn-snap').addEventListener('click', snapPhoto);
  document.getElementById('btn-camera-cancel').addEventListener('click', closeCameraModal);

  document.getElementById('camera-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeCameraModal();
  });

  document.getElementById('btn-download').addEventListener('click', downloadCredential);

  document.getElementById('btn-try-again').addEventListener('click', () => {
    resetUI();
    fileInput.click();
  });

  document.getElementById('btn-verify-again').addEventListener('click', () => {
    resetUI();
    fileInput.click();
  });
});
