"""Crop geometry, normalization, and quality measurement.

Crops are always square and always inside the source image: the rectangle is
slid into bounds first and only shrunk if it cannot fit, so a crop is never
stretched and never reads past an edge.
"""
from __future__ import annotations

import io
import math

import numpy as np
from PIL import Image

# scale multiplies the larger box side; shift moves the centre down in units of
# that side, which is what includes shoulders in a portrait without cutting the
# top of the head off.
MODES = {
    "tight": {"label": "Tight face", "scale": 1.12, "shift": 0.0},
    "head": {"label": "Head", "scale": 1.85, "shift": 0.06},
    "portrait": {"label": "Portrait", "scale": 3.10, "shift": 0.34},
}
DEFAULT_MODE = "head"
SIZES = (0, 512, 768, 1024)  # 0 keeps the original crop resolution
MAX_PADDING = 1.5


def crop_rect(box, image_size, mode=DEFAULT_MODE, padding=0.0):
    """A square rectangle around one face, clamped inside the image."""
    if mode not in MODES:
        raise ValueError(f"Unknown crop mode '{mode}'")
    padding = float(np.clip(padding, -0.5, MAX_PADDING))
    width, height = image_size
    x1, y1, x2, y2 = box
    base = max(x2 - x1, y2 - y1)
    if base <= 0:
        raise ValueError("Face box has no area")
    spec = MODES[mode]
    side = base * max(0.05, spec["scale"] + padding)
    centre_x = (x1 + x2) / 2
    centre_y = (y1 + y2) / 2 + base * spec["shift"]
    # A square larger than the image cannot fit; shrink rather than distort.
    side = min(side, width, height)
    left = min(max(centre_x - side / 2, 0.0), width - side)
    top = min(max(centre_y - side / 2, 0.0), height - side)
    return (int(round(left)), int(round(top)), int(round(left + side)), int(round(top + side)))


def normalize(image, size):
    """Fit into a square of `size`, padding rather than stretching."""
    if not size:
        return image
    source = image.convert("RGB")
    scale = min(size / source.width, size / source.height)
    width = max(1, int(round(source.width * scale)))
    height = max(1, int(round(source.height * scale)))
    resized = source.resize((width, height), Image.LANCZOS)
    if width == size and height == size:
        return resized
    canvas = Image.new("RGB", (size, size), (0, 0, 0))
    canvas.paste(resized, ((size - width) // 2, (size - height) // 2))
    return canvas


def render(source_image, box, mode=DEFAULT_MODE, padding=0.0, size=0):
    rect = crop_rect(box, source_image.size, mode, padding)
    crop = source_image.convert("RGB").crop(rect)
    return normalize(crop, size), rect


def encode(image):
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def sharpness(image):
    """Variance of the Laplacian: the usual cheap blur proxy, no OpenCV needed."""
    grey = np.asarray(image.convert("L"), dtype=np.float32)
    if grey.shape[0] < 3 or grey.shape[1] < 3:
        return 0.0
    laplacian = (grey[:-2, 1:-1] + grey[2:, 1:-1] + grey[1:-1, :-2] + grey[1:-1, 2:]
                 - 4.0 * grey[1:-1, 1:-1])
    return float(laplacian.var())


def exposure(image):
    grey = np.asarray(image.convert("L"), dtype=np.float32)
    total = max(grey.size, 1)
    return {
        "brightness": float(grey.mean()),
        "clipped_dark": float((grey <= 4).sum() / total),
        "clipped_bright": float((grey >= 251).sum() / total),
    }


def pose(landmarks):
    """Roll and a yaw proxy from the five ArcFace points.

    Eye midpoint versus nose gives how far the head is turned; it is an estimate
    from 2D points, not a calibrated pose, and is labelled that way in the UI.
    """
    if len(landmarks) < 5:
        return {"roll_degrees": None, "yaw_ratio": None}
    (left_eye, right_eye, nose) = landmarks[0], landmarks[1], landmarks[2]
    dx = right_eye[0] - left_eye[0]
    dy = right_eye[1] - left_eye[1]
    roll = math.degrees(math.atan2(dy, dx))
    span = math.hypot(dx, dy)
    if span < 1e-6:
        return {"roll_degrees": roll, "yaw_ratio": None}
    centre_x = (left_eye[0] + right_eye[0]) / 2
    centre_y = (left_eye[1] + right_eye[1]) / 2
    # Project the nose offset onto the eye line, so roll does not leak into yaw.
    yaw = ((nose[0] - centre_x) * dx + (nose[1] - centre_y) * dy) / (span * span)
    return {"roll_degrees": roll, "yaw_ratio": float(np.clip(yaw * 2.0, -1.5, 1.5))}


def measure(crop_image, face, rect):
    """Every quality number recorded for one face."""
    light = exposure(crop_image)
    angles = pose(face.landmarks)
    yaw = angles["yaw_ratio"]
    roll = angles["roll_degrees"]
    return {
        "confidence": round(float(face.confidence), 4),
        "face_width": round(face.width, 1),
        "face_height": round(face.height, 1),
        "crop_width": rect[2] - rect[0],
        "crop_height": rect[3] - rect[1],
        "sharpness": round(sharpness(crop_image), 2),
        "brightness": round(light["brightness"], 1),
        "clipped_dark": round(light["clipped_dark"], 4),
        "clipped_bright": round(light["clipped_bright"], 4),
        "roll_degrees": None if roll is None else round(roll, 1),
        "yaw_ratio": None if yaw is None else round(yaw, 3),
        "extreme_angle": bool(yaw is not None and abs(yaw) > 0.55) or bool(roll is not None and abs(roll) > 35),
    }


def flags(metrics, thresholds):
    """Advisory reasons a face may not belong in a dataset. Never deletes."""
    reasons = []
    if metrics["confidence"] < thresholds["min_confidence"]:
        reasons.append("low confidence")
    if min(metrics["face_width"], metrics["face_height"]) < thresholds["min_face_pixels"]:
        reasons.append("small face")
    if metrics["sharpness"] < thresholds["min_sharpness"]:
        reasons.append("blurry")
    if metrics["clipped_bright"] > 0.25:
        reasons.append("blown highlights")
    if metrics["clipped_dark"] > 0.35:
        reasons.append("crushed shadows")
    if metrics["brightness"] < 35 or metrics["brightness"] > 225:
        reasons.append("extreme exposure")
    if metrics["extreme_angle"]:
        reasons.append("extreme angle")
    return reasons
