"""Local damage-only training using BSD-licensed TorchVision, no pretrained weights.

python worker/training/train_detector.py --data export --out runs/v1 --epochs 1
Synthetic runs validate software only, never recognition accuracy. No deployment.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path


def load_manifest(root):
    manifest = json.loads((root / 'manifest.json').read_text())
    properties = {}
    seen = set()
    for p in manifest['photos']:
        split = manifest['split'][p['photoId']]
        if split not in ('train', 'val', 'test'):
            raise ValueError('Invalid dataset partition')
        if properties.setdefault(p['propertyId'], split) != split:
            raise ValueError('Property leakage between partitions')
        if p['status'] != 'approved' or not p.get('approvedBy') or p['approvedBy'] == p['labeledBy']:
            raise ValueError('Independent inspector approval required')
        if p['sha256'] in seen:
            raise ValueError('Duplicate original')
        seen.add(p['sha256'])
        path = (root / 'images' / p['fileName']).resolve()
        if not path.is_relative_to((root / 'images').resolve()):
            raise ValueError('Unsafe original filename')
        if hashlib.sha256(path.read_bytes()).hexdigest() != p['sha256']:
            raise ValueError('Original image integrity mismatch')
    return manifest


def create_model(classes, size=320, smoke=False):
    from torchvision.models.detection import fasterrcnn_resnet50_fpn, FasterRCNN
    if smoke:
        import torch
        from torchvision.models.detection.rpn import AnchorGenerator
        from torchvision.ops import MultiScaleRoIAlign
        backbone = torch.nn.Sequential(torch.nn.Conv2d(3, 16, 3, stride=2, padding=1), torch.nn.ReLU())
        backbone.out_channels = 16
        return FasterRCNN(backbone, num_classes=classes + 1, min_size=size, max_size=size,
                         rpn_anchor_generator=AnchorGenerator(((8, 16, 32),), ((0.5, 1.0, 2.0),)),
                         box_roi_pool=MultiScaleRoIAlign(['0'], 7, 2), rpn_pre_nms_top_n_train=100,
                         rpn_post_nms_top_n_train=50, rpn_pre_nms_top_n_test=100, rpn_post_nms_top_n_test=50)
    return fasterrcnn_resnet50_fpn(weights=None, weights_backbone=None, num_classes=classes + 1,
                                   min_size=size, max_size=size)


def image_tensor(root, photo):
    from PIL import Image, ImageOps
    from torchvision.transforms.functional import pil_to_tensor
    with Image.open(root / 'images' / photo['fileName']) as img:
        img = ImageOps.exif_transpose(img).convert('RGB')
        if img.size != (photo['width'], photo['height']):
            raise ValueError('Image dimensions differ from approved labels')
        return pil_to_tensor(img).float() / 255


def train(root, out, epochs=1, device='cpu', resume=False, size=320, smoke=False):
    import torch
    torch.manual_seed(0)
    torch.set_num_threads(2)
    ds = load_manifest(root)
    train_photos = [p for p in ds['photos'] if ds['split'][p['photoId']] == 'train']
    if not train_photos or not ds['classes']:
        raise ValueError('Approved training photos and damage classes required')
    model = create_model(len(ds['classes']), size, smoke).to(device)
    optimizer = torch.optim.SGD(model.parameters(), lr=0.001, momentum=0.9)
    out.mkdir(parents=True, exist_ok=True)
    checkpoint = out / 'checkpoint.pt'
    start = 0
    if resume:
        saved = torch.load(checkpoint, map_location=device, weights_only=True)
        if saved['dataset_version'] != ds['version'] or saved['classes'] != ds['classes'] or saved['smoke'] != smoke:
            raise ValueError('Checkpoint does not match the dataset/model configuration')
        model.load_state_dict(saved['model'])
        optimizer.load_state_dict(saved['optimizer'])
        start = saved['epochs']
    losses = []
    for epoch in range(start, start + epochs):
        model.train()
        for p in train_photos:
            image = image_tensor(root, p).to(device)
            boxes, labels = [], []
            for r in p['regions']:
                xs = [q['x'] for q in r['polygon']]; ys = [q['y'] for q in r['polygon']]
                boxes.append([min(xs)*p['width'], min(ys)*p['height'], max(xs)*p['width'], max(ys)*p['height']])
                labels.append(ds['classes'].index(r['cls']) + 1)
            target = {'boxes': torch.tensor(boxes, dtype=torch.float32, device=device).reshape(-1, 4),
                      'labels': torch.tensor(labels, dtype=torch.int64, device=device)}
            loss = sum(model([image], [target]).values())
            if not torch.isfinite(loss):
                raise ValueError('Non-finite training loss')
            optimizer.zero_grad(); loss.backward(); optimizer.step(); losses.append(float(loss.detach()))
        torch.save({'model': model.state_dict(), 'optimizer': optimizer.state_dict(), 'epochs': epoch + 1,
                    'dataset_version': ds['version'], 'classes': ds['classes'], 'size': size, 'smoke': smoke}, checkpoint)
    model.eval()
    predictions = []
    with torch.no_grad():
        for p in ds['photos']:
            if ds['split'][p['photoId']] != 'test':
                continue
            result = model([image_tensor(root, p).to(device)])[0]
            for b, score, label in zip(result['boxes'].cpu(), result['scores'].cpu(), result['labels'].cpu()):
                idx = int(label) - 1
                if not 0 <= idx < len(ds['classes']) or float(score) < 0.5:
                    continue
                predictions.append({'photoId': p['photoId'], 'cls': ds['classes'][idx], 'confidence': float(score),
                    'box': dict(zip(('x0','y0','x1','y1'), [float(b[0])/p['width'],float(b[1])/p['height'],float(b[2])/p['width'],float(b[3])/p['height']]))})
    digest = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
    report = {'checkpoint_sha256': digest, 'predictions': predictions, 'partition': 'test'}
    (out / 'heldout_predictions.json').write_text(json.dumps(report, indent=2))
    manifest = {'framework': 'torchvision-fasterrcnn', 'pretrained_weights': 'none', 'dataset_version': ds['version'],
                'classes': ds['classes'], 'label_offset': 1, 'checkpoint_sha256': digest, 'checkpoint_path': str(checkpoint),
                'status': 'synthetic_software_test' if smoke else 'trained_unvalidated', 'epochs': start+epochs,
                'size': size, 'device': device, 'losses': losses, 'code_license': 'BSD-3-Clause',
                'customer_deployment': False, 'onnx_export_verified': False}
    (out / 'pitch_model_manifest.json').write_text(json.dumps(manifest, indent=2))
    return manifest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True, type=Path); ap.add_argument('--out', required=True, type=Path)
    ap.add_argument('--epochs', type=int, default=1); ap.add_argument('--device', default='cpu')
    ap.add_argument('--size', type=int, default=320); ap.add_argument('--resume', action='store_true')
    ap.add_argument('--smoke-test', action='store_true')
    a = ap.parse_args()
    if a.epochs < 1 or a.size < 64: ap.error('Positive epochs and size >=64 required')
    print(json.dumps(train(a.data, a.out, a.epochs, a.device, a.resume, a.size, a.smoke_test), indent=2))


if __name__ == '__main__':
    main()