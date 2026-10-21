"""Bounded CPU preparation runner for an EXISTING authorized host, not a server.

The database owns consent, cancellation, single-flight leases and retries. This
process never labels components, trains a model, or activates customer inference.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import os
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

MODEL_FILES = {
    'dino': 'dinov2-small.onnx',
    'encoder': 'sam2.1-tiny-vision-encoder.onnx',
    'decoder': 'sam2.1-tiny-mask-decoder.onnx',
}


def model_paths(root: Path):
    """Require locally provisioned files AND trusted operator SHA-256 values."""
    paths = {}
    for name, filename in MODEL_FILES.items():
        path = root / filename
        expected = os.environ.get(f'PITCH_{name.upper()}_SHA256', '')
        if len(expected) != 64 or not path.is_file():
            raise ValueError('Verified local DINOv2 and SAM ONNX files are required')
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('Local model integrity check failed')
        paths[name] = path
    return paths


def quality(image):
    rgb = np.asarray(image.resize((256, 256), Image.Resampling.NEAREST), dtype=np.float32)
    lum = rgb @ np.array([.299, .587, .114], dtype=np.float32)
    lap = lum[1:-1, :-2] + lum[1:-1, 2:] + lum[:-2, 1:-1] + lum[2:, 1:-1] - 4 * lum[1:-1, 1:-1]
    brightness, sharpness = float(lum.mean()), float(lap.var())
    issues = []
    if brightness < 35: issues.append('Too dark to assess')
    if brightness > 230: issues.append('Overexposed; detail lost')
    if float(lum.std()) < 8: issues.append('Very low contrast')
    if sharpness < 15: issues.append('Blurry; surface detail not resolvable')
    small = np.asarray(image.convert('L').resize((9, 8)), dtype=np.float32)
    bits = (small[:, 1:] > small[:, :-1]).flatten()
    dhash = f"{sum(int(v) << n for n, v in enumerate(bits)):016x}"
    return {'assessable': not issues, 'brightness': brightness, 'sharpness': sharpness, 'issues': issues, 'dhash': dhash}


def tensor(image, side):
    rgb = np.asarray(image.resize((side, side), Image.Resampling.NEAREST), dtype=np.float32) / 255
    rgb = (rgb - np.array([.485, .456, .406], dtype=np.float32)) / np.array([.229, .224, .225], dtype=np.float32)
    return rgb.transpose(2, 0, 1)[None].astype(np.float32)


def polygon_from_mask(mask):
    from scipy.spatial import ConvexHull
    on = mask > 0
    ys, xs = np.where(on)
    if len(xs) < 16: return None
    # Same conservative convex-hull outline contract as the browser path.
    points = np.unique(np.concatenate([np.column_stack((xs, ys)), np.column_stack((xs + 1, ys + 1))]), axis=0)
    try: hull = points[ConvexHull(points).vertices] / mask.shape[0]
    except Exception: return None
    area = abs(np.dot(hull[:, 0], np.roll(hull[:, 1], 1)) - np.dot(hull[:, 1], np.roll(hull[:, 0], 1))) / 2
    if area < .0005: return None
    return [{'x': float(x), 'y': float(y)} for x, y in hull]


def pool_embedding(patches, polygon):
    from matplotlib.path import Path as PolygonPath
    points = np.array([[(x + .5) / 16, (y + .5) / 16] for y in range(16) for x in range(16)])
    selected = PolygonPath([(p['x'], p['y']) for p in polygon]).contains_points(points)
    if not selected.any(): return None
    emb = patches[selected].mean(axis=0)
    norm = np.linalg.norm(emb)
    if norm <= 0 or not np.isfinite(emb).all(): return None
    return (emb / norm).tolist()


class LocalProcessor:
    def __init__(self, paths):
        import onnxruntime as ort
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        self.sessions = {k: ort.InferenceSession(str(p), sess_options=options, providers=['CPUExecutionProvider']) for k, p in paths.items()}

    def prepare(self, raw):
        started = time.monotonic()
        Image.MAX_IMAGE_PIXELS = 40_000_000
        with Image.open(io.BytesIO(raw)) as source:
            image = ImageOps.exif_transpose(source).convert('RGB')
        image.thumbnail((512, 512))
        q = quality(image)
        result = {'sha256': hashlib.sha256(raw).hexdigest(), 'quality': q, 'width': image.width, 'height': image.height, 'regions': [], 'invalidRegions': 0, 'timingsMs': {}, 'status': 'unassessable'}
        if not q['assessable']:
            result['durationMs'] = round((time.monotonic() - started) * 1000)
            return result
        t = time.monotonic()
        dino = self.sessions['dino']
        features = dino.run(None, {dino.get_inputs()[0].name: tensor(image, 224)})[0]
        if features.shape != (1, 257, 384): raise ValueError('Unsupported DINOv2 output contract')
        patches = features[0, 1:]
        result['timingsMs']['embed'] = round((time.monotonic() - t) * 1000)
        t = time.monotonic()
        enc = self.sessions['encoder']
        encoded = dict(zip([o.name for o in enc.get_outputs()], enc.run(None, {'pixel_values': tensor(image, 1024)})))
        dec = self.sessions['decoder']
        seen = []
        # Decode one box at a time: never replicate embeddings 16 times in RAM.
        for y in range(4):
            for x in range(4):
                feeds = {'input_points': np.zeros((1, 1, 1, 2), dtype=np.float32), 'input_labels': np.zeros((1, 1, 1), dtype=np.int64), 'input_boxes': np.array([[[x*256, y*256, (x+1)*256, (y+1)*256]]], dtype=np.float32)}
                feeds.update({f'image_embeddings.{n}': encoded[f'image_embeddings.{n}'] for n in range(3)})
                output = dict(zip([o.name for o in dec.get_outputs()], dec.run(None, feeds)))
                scores = output['iou_scores'].reshape(-1)
                best = int(scores.argmax())
                if scores[best] < .7: continue
                masks = output['pred_masks'].reshape(3, 256, 256)
                polygon = polygon_from_mask(masks[best])
                if not polygon:
                    result['invalidRegions'] += 1
                    continue
                box = np.array([[p['x'], p['y']] for p in polygon])
                bounds = (box.min(axis=0), box.max(axis=0))
                if any(np.max(np.abs(bounds[0] - lo)) < .05 and np.max(np.abs(bounds[1] - hi)) < .05 for lo, hi in seen): continue
                emb = pool_embedding(patches, polygon)
                if emb is None:
                    result['invalidRegions'] += 1
                    continue
                seen.append(bounds)
                result['regions'].append({'polygon': polygon, 'embedding': emb})
        result.update(status='completed' if result['regions'] else 'no_useful_regions', segmenter='sam2.1-hiera-tiny', embedder='dinov2-small', durationMs=round((time.monotonic() - started) * 1000))
        result['timingsMs']['segment'] = round((time.monotonic() - t) * 1000)
        return result


def run(root: Path, max_items=10):
    import httpx
    base = os.environ.get('PITCH_PREPARATION_CONTROL_URL', '')
    secret = os.environ.get('INTERNAL_WORKER_SECRET', '')
    if not base.startswith('https://') or not secret: raise ValueError('Authenticated HTTPS preparation control URL and worker secret are required')
    # Validate configuration before claiming work; absent models never consume a lease.
    processor = LocalProcessor(model_paths(root))
    if not 1 <= max_items <= 10: raise ValueError('Each run processes between 1 and 10 photos')
    headers = {'x-internal-worker-secret': secret, 'Content-Type': 'application/json'}
    with httpx.Client(timeout=60, follow_redirects=False) as client:
        for _ in range(max_items):
            claimed = client.post(base, headers={**headers, 'x-route': '/photos/claim'}, json={})
            claimed.raise_for_status()
            item = claimed.json()['data']['item']
            if not item: break
            try:
                raw = bytearray()
                with client.stream('GET', item['url']) as response:
                    response.raise_for_status()
                    for chunk in response.iter_bytes():
                        raw.extend(chunk)
                        if len(raw) > 15 * 1024 * 1024: raise ValueError('Original exceeds the 15 MB preparation limit')
                result = processor.prepare(bytes(raw))
            except httpx.HTTPStatusError as exc:
                code = exc.response.status_code
                result = {'status': 'failed', 'retryable': code == 429 or code >= 500, 'error': f'Original download failed (HTTP {code})'}
            except httpx.TransportError:
                result = {'status': 'failed', 'retryable': True, 'error': 'Original download was interrupted'}
            except Exception:
                result = {'status': 'failed', 'retryable': False, 'error': 'Original decode or local model execution failed; inspect host configuration'}
            saved = client.post(base, headers={**headers, 'x-route': '/photos/finish'}, json={'itemId': item['itemId'], 'leaseToken': item['leaseToken'], 'result': result})
            saved.raise_for_status()  # Never swallow rejected persistence or replay it immediately.
            print(json.dumps({'status': result['status'], 'regions': len(result.get('regions', [])), 'durationMs': result.get('durationMs')}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--max-items', type=int, default=10)
    args = parser.parse_args()
    run(args.models, args.max_items)