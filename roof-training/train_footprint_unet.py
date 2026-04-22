"""Footprint-only U-Net training.

Trains a single-channel binary segmentation model on footprint masks. This is
the first stage of the multi-class roof segmentation curriculum: nail footprint
detection before adding ridge/hip/valley/eave/rake heads.

Usage:
  python roof-training/train_footprint_unet.py
"""

from __future__ import annotations

import json
import os
import random
from pathlib import Path
from typing import List

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms
from torchvision.models import resnet34

DATASET_ROOT = Path(os.environ.get("ROOF_DATASET_ROOT", "./roof-training"))
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
IMAGE_SIZE = int(os.environ.get("ROOF_IMAGE_SIZE", "512"))
BATCH_SIZE = int(os.environ.get("ROOF_BATCH_SIZE", "8"))
EPOCHS = int(os.environ.get("ROOF_EPOCHS", "30"))
LR = float(os.environ.get("ROOF_LR", "3e-4"))
SEED = 42
MIN_ALIGN = float(os.environ.get("ROOF_MIN_ALIGNMENT_QUALITY", "0.50"))
SAVE_DIR = DATASET_ROOT / "exports" / "checkpoints"
SAVE_DIR.mkdir(parents=True, exist_ok=True)
random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)


def _load_ids(split: str) -> List[str]:
    p = DATASET_ROOT / "splits" / f"{split}.txt"
    if not p.exists():
        return []
    return [l.strip() for l in p.read_text().splitlines() if l.strip()]


class FootprintDataset(Dataset):
    def __init__(self, ids: List[str], augment: bool = False):
        self.augment = augment
        self.image_dir = DATASET_ROOT / "images"
        self.mask_dir = DATASET_ROOT / "masks" / "footprint"
        self.label_dir = DATASET_ROOT / "labels"

        valid = []
        for sid in ids:
            img = self.image_dir / f"{sid}.png"
            msk = self.mask_dir / f"{sid}.png"
            lbl = self.label_dir / f"{sid}.json"
            if not (img.exists() and msk.exists() and lbl.exists()):
                continue
            quality = json.loads(lbl.read_text()).get("quality", {}).get("alignment_quality", 0.0)
            if float(quality) >= MIN_ALIGN:
                valid.append(sid)
        self.ids = valid

    def __len__(self):
        return len(self.ids)

    def _to_tensors(self, img: Image.Image, mask: Image.Image):
        img = img.resize((IMAGE_SIZE, IMAGE_SIZE))
        mask = mask.resize((IMAGE_SIZE, IMAGE_SIZE), Image.NEAREST)
        if self.augment:
            if random.random() < 0.5:
                img = img.transpose(Image.FLIP_LEFT_RIGHT)
                mask = mask.transpose(Image.FLIP_LEFT_RIGHT)
            if random.random() < 0.5:
                img = img.transpose(Image.FLIP_TOP_BOTTOM)
                mask = mask.transpose(Image.FLIP_TOP_BOTTOM)
        x = transforms.ToTensor()(img)
        y = torch.from_numpy((np.array(mask) > 127).astype(np.float32)).unsqueeze(0)
        return x, y

    def __getitem__(self, i):
        sid = self.ids[i]
        img = Image.open(self.image_dir / f"{sid}.png").convert("RGB")
        msk = Image.open(self.mask_dir / f"{sid}.png").convert("L")
        x, y = self._to_tensors(img, msk)
        return {"id": sid, "image": x, "mask": y}


# ---- U-Net (ResNet34 encoder, single output channel) ----

class ConvBlock(nn.Module):
    def __init__(self, ic, oc):
        super().__init__()
        self.b = nn.Sequential(
            nn.Conv2d(ic, oc, 3, padding=1, bias=False), nn.BatchNorm2d(oc), nn.ReLU(True),
            nn.Conv2d(oc, oc, 3, padding=1, bias=False), nn.BatchNorm2d(oc), nn.ReLU(True),
        )
    def forward(self, x): return self.b(x)


class UpBlock(nn.Module):
    def __init__(self, ic, sk, oc):
        super().__init__()
        self.c = ConvBlock(ic + sk, oc)
    def forward(self, x, s):
        x = F.interpolate(x, size=s.shape[-2:], mode="bilinear", align_corners=False)
        return self.c(torch.cat([x, s], 1))


class FootprintUNet(nn.Module):
    def __init__(self):
        super().__init__()
        b = resnet34(weights=None)
        self.stem = nn.Sequential(b.conv1, b.bn1, b.relu)
        self.pool = b.maxpool
        self.e1, self.e2, self.e3, self.e4 = b.layer1, b.layer2, b.layer3, b.layer4
        self.center = ConvBlock(512, 512)
        self.u4 = UpBlock(512, 256, 256)
        self.u3 = UpBlock(256, 128, 128)
        self.u2 = UpBlock(128, 64, 64)
        self.u1 = UpBlock(64, 64, 32)
        self.head = nn.Conv2d(32, 1, 1)

    def forward(self, x):
        s0 = self.stem(x); s1 = self.e1(self.pool(s0))
        s2 = self.e2(s1); s3 = self.e3(s2); s4 = self.e4(s3)
        c = self.center(s4)
        u = self.u4(c, s3); u = self.u3(u, s2); u = self.u2(u, s1); u = self.u1(u, s0)
        return self.head(u)


def dice_loss(logits, t, eps=1e-6):
    p = torch.sigmoid(logits).flatten(1)
    t = t.flatten(1)
    inter = (p * t).sum(1)
    return (1 - (2 * inter + eps) / (p.sum(1) + t.sum(1) + eps)).mean()


def bce_dice(logits, t):
    return 0.5 * F.binary_cross_entropy_with_logits(logits, t) + 0.5 * dice_loss(logits, t)


def iou(logits, t, thr=0.5, eps=1e-6):
    p = (torch.sigmoid(logits) > thr).float()
    t = (t > 0.5).float()
    inter = (p * t).sum(dim=(2, 3))
    union = ((p + t) > 0).float().sum(dim=(2, 3))
    return ((inter + eps) / (union + eps)).mean().item()


def main():
    train_ids = _load_ids("train")
    val_ids = _load_ids("val")

    train_ds = FootprintDataset(train_ids, augment=True)
    val_ds = FootprintDataset(val_ids, augment=False)
    print(f"Device: {DEVICE} | train={len(train_ds)} val={len(val_ds)}")
    if len(train_ds) == 0:
        print("No training samples. Run pipeline/run_pipeline.py first.")
        return

    tl = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True, num_workers=0)
    vl = DataLoader(val_ds, batch_size=BATCH_SIZE, shuffle=False, num_workers=0)

    model = FootprintUNet().to(DEVICE)
    opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=EPOCHS)

    best_iou = -1.0
    history = []

    for epoch in range(1, EPOCHS + 1):
        model.train()
        running = 0.0
        for batch in tl:
            x = batch["image"].to(DEVICE); y = batch["mask"].to(DEVICE)
            opt.zero_grad(set_to_none=True)
            logits = model(x)
            loss = bce_dice(logits, y)
            loss.backward()
            opt.step()
            running += loss.item()
        sched.step()

        # validate
        model.eval()
        v_loss, v_iou, n = 0.0, 0.0, 0
        with torch.no_grad():
            for batch in vl:
                x = batch["image"].to(DEVICE); y = batch["mask"].to(DEVICE)
                logits = model(x)
                v_loss += bce_dice(logits, y).item()
                v_iou += iou(logits, y)
                n += 1
        v_loss = v_loss / max(n, 1)
        v_iou = v_iou / max(n, 1)
        train_loss = running / max(len(tl), 1)
        history.append({"epoch": epoch, "train_loss": train_loss, "val_loss": v_loss, "val_iou": v_iou})
        print(f"epoch {epoch:03d} | train={train_loss:.4f} val={v_loss:.4f} iou={v_iou:.4f}")

        if v_iou > best_iou:
            best_iou = v_iou
            torch.save({
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "val_iou": v_iou,
                "config": {"image_size": IMAGE_SIZE, "stage": "footprint_only"},
            }, SAVE_DIR / "best_footprint.pt")

    (DATASET_ROOT / "exports" / "metrics").mkdir(parents=True, exist_ok=True)
    (DATASET_ROOT / "exports" / "metrics" / "footprint_history.json").write_text(json.dumps(history, indent=2))
    print(f"\nBest val IoU: {best_iou:.4f}")
    print(f"Checkpoint: {SAVE_DIR / 'best_footprint.pt'}")


if __name__ == "__main__":
    main()
