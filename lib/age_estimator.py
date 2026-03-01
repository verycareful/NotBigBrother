"""
age_estimator.py — DeepFace-based facial age estimation.

Communication contract (with Express parent process):
  stdin   Raw image bytes (JPEG, PNG, WebP, etc.)
  stdout  A single line of JSON:
            Success:       {"estimated_age": <int>, "is_adult": <bool>}
            No face:       {"error": "no_face_detected"}
            Other failure: {"error": "analysis_failed", "detail": "<message>"}
  stderr  Human-readable diagnostics (only on error; safe to log server-side)
  exit 0  Success
  exit 1  General failure (bad image data, library error, etc.)
  exit 2  No face detected
"""

import sys
import json


def _json_out(data: dict) -> None:
    """Write *data* as a single JSON line to stdout and flush immediately."""
    print(json.dumps(data), flush=True)


def main() -> None:
    img_bytes = sys.stdin.buffer.read()

    if not img_bytes:
        _json_out({"error": "analysis_failed", "detail": "No image data received"})
        sys.exit(1)

    try:
        from deepface import DeepFace  # noqa: PLC0415 — lazy import keeps startup fast
        import numpy as np
        import cv2

        # Decode raw bytes → BGR ndarray that DeepFace can accept directly.
        arr = np.frombuffer(img_bytes, dtype=np.uint8)
        img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)

        if img_bgr is None:
            print("[age_estimator] cv2.imdecode returned None — unsupported or corrupt image", file=sys.stderr)
            _json_out({"error": "analysis_failed", "detail": "Could not decode image"})
            sys.exit(1)

        result = DeepFace.analyze(
            img_path=img_bgr,
            actions=["age"],
            enforce_detection=True,
            silent=True,
        )

        # DeepFace returns a list when multiple faces are found; use the first.
        if isinstance(result, list):
            result = result[0]

        age = int(result["age"])
        _json_out({"estimated_age": age, "is_adult": age >= 18})

    except Exception as exc:
        detail = str(exc)
        if "Face could not be detected" in detail or "No face" in detail:
            print(f"[age_estimator] No face detected: {detail}", file=sys.stderr)
            _json_out({"error": "no_face_detected"})
            sys.exit(2)
        else:
            print(f"[age_estimator] Analysis error: {detail}", file=sys.stderr)
            _json_out({"error": "analysis_failed", "detail": detail})
            sys.exit(1)


if __name__ == "__main__":
    main()
