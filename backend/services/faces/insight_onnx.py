"""SCRFD detection + ArcFace embedding, driven directly on onnxruntime.

Using the ONNX graphs rather than the ``insightface`` package keeps the build
dependency-free: onnxruntime is already installed, and the pre/post-processing
below is the whole of what that package would add. Weights live under
``models/face`` and are only ever fetched by an explicit user action.
"""
from __future__ import annotations

import threading
import os

import numpy as np
from PIL import Image

from config import settings
from services.faces.providers import DetectedFace, ProviderStatus, register

MODEL_REPO = "deepghs/insightface"
DETECT_SIZE = 640
STRIDES = (8, 16, 32)
ANCHORS = 2
NMS_IOU = 0.4
# The ArcFace 112x112 template every w600k model was trained against.
ARCFACE_TEMPLATE = np.array([
    [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
    [41.5493, 92.3655], [70.7299, 92.2041]], dtype=np.float32)


def root():
    return settings.models_dir / "face" / "buffalo_l"


FILES = (
    {"name": "det_10g.onnx", "repo_path": "buffalo_l/det_10g.onnx", "bytes": 16923827, "role": "detection"},
    {"name": "w600k_r50.onnx", "repo_path": "buffalo_l/w600k_r50.onnx", "bytes": 174383860, "role": "recognition"},
)


def nms(boxes, scores, threshold=NMS_IOU):
    order = scores.argsort()[::-1]
    keep = []
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    while order.size:
        best = order[0]
        keep.append(best)
        if order.size == 1:
            break
        rest = order[1:]
        x1 = np.maximum(boxes[best, 0], boxes[rest, 0])
        y1 = np.maximum(boxes[best, 1], boxes[rest, 1])
        x2 = np.minimum(boxes[best, 2], boxes[rest, 2])
        y2 = np.minimum(boxes[best, 3], boxes[rest, 3])
        overlap = np.maximum(0.0, x2 - x1) * np.maximum(0.0, y2 - y1)
        union = areas[best] + areas[rest] - overlap
        order = rest[overlap / np.maximum(union, 1e-9) <= threshold]
    return keep


def similarity_transform(source, target):
    """Umeyama similarity transform: rotation, uniform scale, translation only.

    A full affine fit would shear the crop to match the template, which changes
    the face rather than aligning it.
    """
    source_mean, target_mean = source.mean(axis=0), target.mean(axis=0)
    source_centered, target_centered = source - source_mean, target - target_mean
    covariance = target_centered.T @ source_centered / source.shape[0]
    u, singular, vt = np.linalg.svd(covariance)
    correction = np.eye(2)
    if np.linalg.det(u) * np.linalg.det(vt) < 0:
        correction[1, 1] = -1
    rotation = u @ correction @ vt
    variance = source_centered.var(axis=0).sum()
    scale = 1.0 if variance < 1e-9 else (singular * np.diag(correction)).sum() / variance
    matrix = np.eye(3, dtype=np.float32)
    matrix[:2, :2] = scale * rotation
    matrix[:2, 2] = target_mean - scale * rotation @ source_mean
    return matrix


class InsightOnnxProvider:
    key = "insight-onnx"
    name = "SCRFD + ArcFace (ONNX)"

    def __init__(self):
        self._lock = threading.RLock()
        self._detector = None
        self._recognizer = None
        self._device = "cpu"
        self._cpu_fallback = False

    # --- model files -----------------------------------------------------

    def missing(self):
        return [item for item in FILES if not (root() / item["name"]).is_file()]

    def status(self):
        missing = self.missing()
        try:
            import onnxruntime
            providers = onnxruntime.get_available_providers()
        except (ImportError, OSError, RuntimeError):
            return ProviderStatus(self.key, self.name, False, "unavailable",
                                  "Face detection is unavailable: ONNX Runtime is missing or could not load. Install requirements-faces.txt and restart. Other workspaces remain available.", list(FILES))
        cuda = "CUDAExecutionProvider" in providers
        device = self._device if self._detector else ("cuda" if cuda and not self._cpu_fallback else "cpu")
        if missing:
            total = sum(item["bytes"] for item in missing) / 1024 ** 2
            detail = f"{len(missing)} model file(s) not installed ({total:.0f} MB to download)."
        elif self._cpu_fallback:
            detail = "Ready on CPU. GPU initialization failed, so this provider automatically uses CPU for this app session."
        elif device == "cuda":
            detail = "Ready. Runs on the GPU under the shared runtime lease."
        else:
            detail = "Ready. Runs on the CPU, so face work does not reserve image-generation VRAM."
        return ProviderStatus(self.key, self.name, not missing, device, detail,
                              [{**item, "installed": not any(m["name"] == item["name"] for m in missing)}
                               for item in FILES])

    def install(self, progress=None):
        """Explicitly fetch the model files. Never called implicitly."""
        import os

        from huggingface_hub import hf_hub_download
        target = root().parent
        target.mkdir(parents=True, exist_ok=True)
        # The desktop sets HF_HUB_OFFLINE for ordinary runs; this one action is
        # a deliberate download the user asked for.
        previous = os.environ.get("HF_HUB_OFFLINE")
        os.environ["HF_HUB_OFFLINE"] = "0"
        try:
            for item in self.missing():
                if progress:
                    progress(f"Downloading {item['name']}")
                hf_hub_download(MODEL_REPO, item["repo_path"], local_dir=str(target))
        finally:
            if previous is None:
                os.environ.pop("HF_HUB_OFFLINE", None)
            else:
                os.environ["HF_HUB_OFFLINE"] = previous
        return self.status()

    # --- sessions --------------------------------------------------------

    def _sessions(self):
        with self._lock:
            if self._detector is not None:
                return self._detector, self._recognizer
            import onnxruntime
            missing = self.missing()
            if missing:
                raise ValueError("Face models are not installed yet. Install them from the Faces tab first.")
            available = onnxruntime.get_available_providers()
            order = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in available and (not self._cpu_fallback or p != "CUDAExecutionProvider")]
            options = onnxruntime.SessionOptions()
            options.log_severity_level = 3
            # Detection and recognition each create a thread pool. Letting
            # both use every physical core oversubscribes hybrid desktop CPUs.
            # Six threads was faster on the 12-core i7-12700K; 0 opts back into
            # ONNX Runtime's automatic policy on other machines.
            options.intra_op_num_threads = min(settings.face_intra_op_threads, os.cpu_count() or 1)
            detector = recognizer = None
            try:
                detector = onnxruntime.InferenceSession(str(root() / "det_10g.onnx"), options, providers=order)
                recognizer = onnxruntime.InferenceSession(str(root() / "w600k_r50.onnx"), options, providers=order)
            except Exception:
                detector = recognizer = None
                if "CUDAExecutionProvider" not in order or "CPUExecutionProvider" not in available:
                    raise
                # Initialization only: retry once on a supported CPU provider.
                # Commit the pair atomically so a failed recognizer never leaves
                # a half-initialized detector that is reused on the next request.
                detector = onnxruntime.InferenceSession(str(root() / "det_10g.onnx"), options, providers=["CPUExecutionProvider"])
                recognizer = onnxruntime.InferenceSession(str(root() / "w600k_r50.onnx"), options, providers=["CPUExecutionProvider"])
                self._cpu_fallback = True
            self._detector, self._recognizer = detector, recognizer
            self._device = "cuda" if "CUDAExecutionProvider" in self._detector.get_providers() else "cpu"
            return self._detector, self._recognizer

    @property
    def device(self):
        return self._device

    def uses_gpu(self):
        """Whether a run would claim the shared GPU lease."""
        if self._detector is not None or self._cpu_fallback:
            return self._device == "cuda"
        try:
            import onnxruntime
            return "CUDAExecutionProvider" in onnxruntime.get_available_providers()
        except (ImportError, OSError, RuntimeError):
            return False

    def unload(self):
        with self._lock:
            had = self._detector is not None
            self._detector = self._recognizer = None
            return had

    # --- detection -------------------------------------------------------

    def detect(self, image, cancelled=None, threshold=0.5, max_faces=64):
        detector, recognizer = self._sessions()
        source = image.convert("RGB")
        width, height = source.size
        scale = min(DETECT_SIZE / max(width, 1), DETECT_SIZE / max(height, 1), 1.0)
        resized = source.resize((max(1, int(round(width * scale))), max(1, int(round(height * scale)))), Image.BILINEAR)
        canvas = np.zeros((DETECT_SIZE, DETECT_SIZE, 3), dtype=np.uint8)
        canvas[:resized.height, :resized.width] = np.asarray(resized)
        blob = ((canvas.astype(np.float32) - 127.5) / 128.0).transpose(2, 0, 1)[None]
        outputs = detector.run(None, {detector.get_inputs()[0].name: blob})
        if cancelled and cancelled():
            raise InterruptedError("Face detection cancelled")

        boxes, scores, points = [], [], []
        levels = len(STRIDES)
        for index, stride in enumerate(STRIDES):
            level_scores = outputs[index].reshape(-1)
            deltas = outputs[index + levels].reshape(-1, 4) * stride
            keypoints = outputs[index + levels * 2].reshape(-1, 10) * stride
            size = DETECT_SIZE // stride
            grid = np.stack(np.mgrid[:size, :size][::-1], axis=-1).astype(np.float32) * stride
            centers = np.repeat(grid.reshape(-1, 2), ANCHORS, axis=0)
            chosen = np.where(level_scores >= threshold)[0]
            if not chosen.size:
                continue
            center = centers[chosen]
            boxes.append(np.stack([center[:, 0] - deltas[chosen, 0], center[:, 1] - deltas[chosen, 1],
                                   center[:, 0] + deltas[chosen, 2], center[:, 1] + deltas[chosen, 3]], axis=-1))
            points.append(center[:, None, :] + keypoints[chosen].reshape(-1, 5, 2))
            scores.append(level_scores[chosen])
        if not boxes:
            return []
        boxes = np.concatenate(boxes) / scale
        points = np.concatenate(points) / scale
        scores = np.concatenate(scores)
        keep = nms(boxes, scores)[:max_faces]

        found = []
        for index in keep:
            box = (float(np.clip(boxes[index, 0], 0, width)), float(np.clip(boxes[index, 1], 0, height)),
                   float(np.clip(boxes[index, 2], 0, width)), float(np.clip(boxes[index, 3], 0, height)))
            if box[2] - box[0] < 2 or box[3] - box[1] < 2:
                continue
            landmarks = tuple((float(x), float(y)) for x, y in points[index])
            embedding = self._embed(recognizer, source, points[index])
            found.append(DetectedFace(box, float(scores[index]), landmarks, embedding))
        # Stable order so a face index means the same face on a re-run.
        found.sort(key=lambda face: (round(face.box[1], 1), round(face.box[0], 1)))
        return found

    def _embed(self, recognizer, source, landmarks):
        matrix = similarity_transform(np.asarray(landmarks, dtype=np.float32), ARCFACE_TEMPLATE)
        # PIL wants the inverse map (destination -> source), row-major.
        inverse = np.linalg.inv(matrix)
        aligned = source.transform((112, 112), Image.AFFINE, tuple(inverse[:2].reshape(-1)), resample=Image.BILINEAR)
        blob = ((np.asarray(aligned, dtype=np.float32) - 127.5) / 127.5).transpose(2, 0, 1)[None]
        vector = recognizer.run(None, {recognizer.get_inputs()[0].name: blob})[0].reshape(-1)
        norm = float(np.linalg.norm(vector))
        # Unit vectors make cosine similarity a plain dot product everywhere else.
        return tuple(float(value) for value in (vector / norm if norm > 1e-9 else vector))


provider = InsightOnnxProvider()
register(provider)
