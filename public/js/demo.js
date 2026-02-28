'use strict';

const BlindSignatures = require('blind-signatures');

// State shared across steps
const state = {
  N: null,
  E: null,
  token: null,
  tokenString: null,
  blindResult: null,  // { blinded, r }
  blindSignature: null,
  unblinded: null,
};

function hexNonce(bytes = 16) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

function setOutput(id, text, isError) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'step-output' + (isError ? ' error' : '');
}

function setStatus(id, status) {
  const el = document.getElementById(id);
  el.className = 'step-status ' + status;
  el.textContent = status === 'ok' ? '✓' : status === 'fail' ? '✗' : '…';
}

// Step 1: Fetch public key from server
async function fetchPublicKey() {
  setStatus('s1-status', 'loading');
  try {
    const res = await fetch('/api/issuer/public-key');
    const data = await res.json();
    state.N = data.N;
    state.E = data.E;
    setOutput('s1-output', JSON.stringify({ N: state.N.slice(0, 40) + '…', E: state.E }, null, 2));
    setStatus('s1-status', 'ok');
  } catch (err) {
    setOutput('s1-output', 'Error: ' + err.message, true);
    setStatus('s1-status', 'fail');
  }
}

// Step 2: Generate token payload locally
function generateToken() {
  if (!state.N) { setOutput('s2-output', 'Complete step 1 first.', true); return; }

  const now = Math.floor(Date.now() / 1000);
  state.token = {
    type: 'age_verified',
    min_age: 18,
    issued_at: now,
    expiry: now + 365 * 24 * 60 * 60,
    nonce: hexNonce(),
  };
  state.tokenString = JSON.stringify(state.token);
  setOutput('s2-output', JSON.stringify(state.token, null, 2));
  setStatus('s2-status', 'ok');
}

// Step 3: Blind the token
function blindToken() {
  if (!state.tokenString) { setOutput('s3-output', 'Complete step 2 first.', true); return; }

  state.blindResult = BlindSignatures.blind({
    message: state.tokenString,
    N: state.N,
    E: state.E,
  });

  const preview = state.blindResult.blinded.toString().slice(0, 60) + '…';
  setOutput('s3-output', 'blinded (first 60 digits):\n' + preview + '\n\nBlinding factor r: (stored locally, never sent to server)');
  setStatus('s3-status', 'ok');
}

// Step 4: Send blinded message to server, get blind signature
async function requestSignature() {
  if (!state.blindResult) { setOutput('s4-output', 'Complete step 3 first.', true); return; }
  setStatus('s4-status', 'loading');

  try {
    const res = await fetch('/api/issuer/request-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blindedMessage: state.blindResult.blinded.toString() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);

    state.blindSignature = data.blindSignature;
    const preview = state.blindSignature.slice(0, 60) + '…';
    setOutput('s4-output', 'blindSignature (first 60 digits):\n' + preview + '\n\n(Server signed without seeing your token — only the blinded hash)');
    setStatus('s4-status', 'ok');
  } catch (err) {
    setOutput('s4-output', 'Error: ' + err.message, true);
    setStatus('s4-status', 'fail');
  }
}

// Step 5: Unblind the signature
function unblindSignature() {
  if (!state.blindSignature) { setOutput('s5-output', 'Complete step 4 first.', true); return; }

  state.unblinded = BlindSignatures.unblind({
    signed: state.blindSignature,
    N: state.N,
    r: state.blindResult.r,
  });

  const preview = state.unblinded.toString().slice(0, 60) + '…';
  setOutput('s5-output', 'unblinded signature (first 60 digits):\n' + preview + '\n\n(Blinding factor removed — this is the final credential signature)');
  setStatus('s5-status', 'ok');
}

// Step 6: Verify locally (no server call)
function verifyLocally() {
  if (!state.unblinded) { setOutput('s6-output', 'Complete step 5 first.', true); return; }

  const valid = BlindSignatures.verify({
    unblinded: state.unblinded,
    N: state.N,
    E: state.E,
    message: state.tokenString,
  });

  if (valid) {
    setOutput('s6-output', '✓ Signature is valid!\n\nThe server\'s public key confirms this token was genuinely signed.\nNo server call needed — this check runs entirely in your browser.');
    setStatus('s6-status', 'ok');
  } else {
    setOutput('s6-output', '✗ Signature invalid — something went wrong.', true);
    setStatus('s6-status', 'fail');
  }
}

// Step 7: Download credential as a .nbb file
// Format: "nbb1." + base64url(JSON payload)
function saveCredential() {
  if (!state.unblinded) { setOutput('s7-output', 'Complete step 5 first.', true); return; }

  const payload = {
    token: state.token,
    signature: state.unblinded.toString(),
    publicKey: { N: state.N, E: state.E },
    issuedAt: new Date().toISOString(),
  };

  const b64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fileContent = 'nbb1.' + b64;

  const blob = new Blob([fileContent], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nbb-credential.nbb';
  a.click();
  URL.revokeObjectURL(url);

  setOutput('s7-output', 'Downloaded nbb-credential.nbb\n\nnbb1.' + b64.slice(0, 40) + '…\n\nStore this file like a password — it is your anonymous age credential.');
  setStatus('s7-status', 'ok');
}

// Wire up buttons after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-s1').addEventListener('click', fetchPublicKey);
  document.getElementById('btn-s2').addEventListener('click', generateToken);
  document.getElementById('btn-s3').addEventListener('click', blindToken);
  document.getElementById('btn-s4').addEventListener('click', requestSignature);
  document.getElementById('btn-s5').addEventListener('click', unblindSignature);
  document.getElementById('btn-s6').addEventListener('click', verifyLocally);
  document.getElementById('btn-s7').addEventListener('click', saveCredential);
});
