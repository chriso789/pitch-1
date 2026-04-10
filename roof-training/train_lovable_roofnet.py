"""
LovableRoofNet — U-Net (ResNet34 encoder) for roof segmentation + regression.

6-channel segmentation: footprint, ridge, hip, valley, eave, rake
7-value regression: total_area_sqft, ridge_ft, hip_ft, valley_ft, eave_ft, rake_ft, predominant_pitch

Usage:
  export ROOF_DATASET_ROOT=/path/to/roof-training
  python train_lovable_roofnet.py
"""

import os
import json
import math
import random
from pathlib import Path
from typing import Dict, List, Tuple, Optional

import numpy as np
from PIL import Image, ImageDraw

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from torchvision.models import resnet34

# =========================
# CONFIG
# =========================

DATASET_ROOT = Path(os.environ.get("ROOF_DATASET_ROOT", "./roof-training"))
DEVICE = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")

IMAGE_SIZE = int(os.environ.get("ROOF_IMAGE_SIZE", "512"))
BATCH_SIZE = int(os.environ.get("ROOF_BATCH_SIZE", "6"))
EPOCHS = int(os.environ.get("ROOF_EPOCHS", "40"))
LR = float(os.environ.get("ROOF_LR", "0.0003"))
NUM_WORKERS = int(os.environ.get("ROOF_NUM_WORKERS", "0"))
SEED = int(os.environ.get("ROOF_SEED", "42"))
MIN_ALIGNMENT_QUALITY = float(os.environ.get("ROOF_MIN_ALIGNMENT_QUALITY", "0.50"))
SAVE_DIR = DATASET_ROOT / "exports" / "checkpoints"
PREVIEW_DIR = DATASET_ROOT / "exports" / "previews"
METRIC_DIR = DATASET_ROOT / "exports" / "metrics"

SEG_CLASSES = ["footprint", "ridge", "hip", "valley", "eave", "rake"]
REG_TARGETS = [
    "total_area_sqft",
    "ridge_ft",
    "hip_ft",
    "valley_ft",
    "eave_ft",
    "rake_ft",
    "predominant_pitch",
]

SAVE_DIR.mkdir(parents=True, exist_ok=True)
PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
METRIC_DIR.mkdir(parents=True, exist_ok=True)

random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)


# =========================
# HELPERS
# =========================

def load_txt_ids(path: Path) -> List[str]:
    with open(path, "r", encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip()]


def image_to_tensor(img: Image.Image) -> torch.Tensor:
    t = transforms.Compose([
        transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
        transforms.ToTensor(),
    ])
    return t(img)


def mask_to_tensor(img: Image.Image) -> torch.Tensor:
    img = img.resize((IMAGE_SIZE, IMAGE_SIZE), Image.NEAREST)
    arr = np.array(img).astype(np.float32)
    if arr.max() > 1:
        arr = arr / 255.0
    arr = (arr > 0.5).astype(np.float32)
    return torch.from_numpy(arr)


def normalize_regression(values: Dict[str, float]) -> torch.Tensor:
    normalized = [
        values["total_area_sqft"] / 10000.0,
        values["ridge_ft"] / 500.0,
        values["hip_ft"] / 500.0,
        values["valley_ft"] / 500.0,
        values["eave_ft"] / 1000.0,
        values["rake_ft"] / 500.0,
        values["predominant_pitch"] / 12.0,
    ]
    return torch.tensor(normalized, dtype=torch.float32)


def denormalize_regression(x: torch.Tensor) -> torch.Tensor:
    scales = torch.tensor([10000.0, 500.0, 500.0, 500.0, 1000.0, 500.0, 12.0], device=x.device)
    return x * scales


def dice_loss(logits: torch.Tensor, targets: torch.Tensor, eps: float = 1e-6) -> torch.Tensor:
    probs = torch.sigmoid(logits)
    probs = probs.view(probs.size(0), probs.size(1), -1)
    targets = targets.view(targets.size(0), targets.size(1), -1)
    intersection = (probs * targets).sum(-1)
    union = probs.sum(-1) + targets.sum(-1)
    dice = (2.0 * intersection + eps) / (union + eps)
    return 1.0 - dice.mean()


def bce_dice_loss(logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
    bce = F.binary_cross_entropy_with_logits(logits, targets)
    d = dice_loss(logits, targets)
    return 0.5 * bce + 0.5 * d


def multilabel_iou(logits: torch.Tensor, targets: torch.Tensor, threshold: float = 0.5, eps: float = 1e-6) -> float:
    probs = torch.sigmoid(logits)
    preds = (probs > threshold).float()
    targets = (targets > 0.5).float()
    intersection = (preds * targets).sum(dim=(2, 3))
    union = ((preds + targets) > 0).float().sum(dim=(2, 3))
    iou = (intersection + eps) / (union + eps)
    return iou.mean().item()


# =========================
# DATASET
# =========================

class RoofDataset(Dataset):
    def __init__(self, ids: List[str], augment: bool = False):
        self.ids = ids
        self.augment = augment
        self.image_dir = DATASET_ROOT / "images"
        self.mask_dir = DATASET_ROOT / "masks"
        self.label_dir = DATASET_ROOT / "labels"

        self.filtered_ids = []
        for sample_id in self.ids:
            label_path = self.label_dir / f"{sample_id}.json"
            image_path = self.image_dir / f"{sample_id}.png"
            if not label_path.exists() or not image_path.exists():
                continue
            with open(label_path, "r", encoding="utf-8") as f:
                label = json.load(f)
            quality = label.get("quality", {})
            alignment_quality = float(quality.get("alignment_quality", 0.0))
            targets = label.get("targets", {})
            required_targets_present = all(k in targets and targets[k] is not None for k in REG_TARGETS)
            if alignment_quality >= MIN_ALIGNMENT_QUALITY and required_targets_present:
                self.filtered_ids.append(sample_id)

    def __len__(self):
        return len(self.filtered_ids)

    def _augment_pair(self, image: Image.Image, masks: List[Image.Image]) -> Tuple[Image.Image, List[Image.Image]]:
        if random.random() < 0.5:
            image = image.transpose(Image.FLIP_LEFT_RIGHT)
            masks = [m.transpose(Image.FLIP_LEFT_RIGHT) for m in masks]
        if random.random() < 0.5:
            image = image.transpose(Image.FLIP_TOP_BOTTOM)
            masks = [m.transpose(Image.FLIP_TOP_BOTTOM) for m in masks]
        if random.random() < 0.5:
            angle = random.choice([0, 90, 180, 270])
            image = image.rotate(angle)
            masks = [m.rotate(angle) for m in masks]
        return image, masks

    def __getitem__(self, idx: int):
        sample_id = self.filtered_ids[idx]
        image_path = self.image_dir / f"{sample_id}.png"
        label_path = self.label_dir / f"{sample_id}.json"

        image = Image.open(image_path).convert("RGB")
        masks = []
        for cls in SEG_CLASSES:
            mask_path = self.mask_dir / cls / f"{sample_id}.png"
            if mask_path.exists():
                mask = Image.open(mask_path).convert("L")
            else:
                mask = Image.new("L", image.size, 0)
            masks.append(mask)

        if self.augment:
            image, masks = self._augment_pair(image, masks)

        x = image_to_tensor(image)
        y_seg = torch.stack([mask_to_tensor(m) for m in masks], dim=0)

        with open(label_path, "r", encoding="utf-8") as f:
            label = json.load(f)
        y_reg = normalize_regression(label["targets"])

        return {
            "id": sample_id,
            "image": x,
            "seg": y_seg,
            "reg": y_reg,
        }


# =========================
# MODEL
# =========================

class ConvBlock(nn.Module):
    def __init__(self, in_ch: int, out_ch: int):
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv2d(in_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
        )

    def forward(self, x):
        return self.block(x)


class UpBlock(nn.Module):
    def __init__(self, in_ch: int, skip_ch: int, out_ch: int):
        super().__init__()
        self.conv = ConvBlock(in_ch + skip_ch, out_ch)

    def forward(self, x, skip):
        x = F.interpolate(x, size=skip.shape[-2:], mode="bilinear", align_corners=False)
        x = torch.cat([x, skip], dim=1)
        return self.conv(x)


class LovableRoofNet(nn.Module):
    def __init__(self, seg_classes: int = 6, reg_outputs: int = 7):
        super().__init__()
        backbone = resnet34(weights=None)
        self.stem = nn.Sequential(backbone.conv1, backbone.bn1, backbone.relu)
        self.pool = backbone.maxpool
        self.enc1 = backbone.layer1
        self.enc2 = backbone.layer2
        self.enc3 = backbone.layer3
        self.enc4 = backbone.layer4

        self.center = ConvBlock(512, 512)

        self.up4 = UpBlock(512, 256, 256)
        self.up3 = UpBlock(256, 128, 128)
        self.up2 = UpBlock(128, 64, 64)
        self.up1 = UpBlock(64, 64, 32)

        self.seg_head = nn.Conv2d(32, seg_classes, kernel_size=1)

        self.reg_head = nn.Sequential(
            nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Linear(512, 256),
            nn.ReLU(inplace=True),
            nn.Dropout(0.2),
            nn.Linear(256, reg_outputs),
        )

    def forward(self, x):
        s0 = self.stem(x)
        s1 = self.enc1(self.pool(s0))
        s2 = self.enc2(s1)
        s3 = self.enc3(s2)
        s4 = self.enc4(s3)

        center = self.center(s4)
        seg = self.up4(center, s3)
        seg = self.up3(seg, s2)
        seg = self.up2(seg, s1)
        seg = self.up1(seg, s0)
        seg = self.seg_head(seg)

        reg = self.reg_head(center)
        return seg, reg


# =========================
# TRAIN
# =========================

def save_preview(model, batch, epoch: int, out_dir: Path):
    model.eval()
    with torch.no_grad():
        images = batch["image"].to(DEVICE)
        ids = batch["id"]
        seg_logits, _ = model(images)
        seg_probs = torch.sigmoid(seg_logits).cpu()

    colors = {
        "footprint": (0, 255, 0, 90),
        "ridge": (255, 0, 0, 160),
        "hip": (255, 165, 0, 160),
        "valley": (0, 0, 255, 160),
        "eave": (255, 255, 0, 160),
        "rake": (255, 0, 255, 160),
    }

    for i in range(min(2, images.size(0))):
        img = images[i].cpu().permute(1, 2, 0).numpy()
        img = (img * 255).clip(0, 255).astype(np.uint8)
        base = Image.fromarray(img).convert("RGBA")
        overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))

        for c, cls in enumerate(SEG_CLASSES):
            mask = (seg_probs[i, c].numpy() > 0.5).astype(np.uint8) * 255
            mask_img = Image.fromarray(mask).resize(base.size, Image.NEAREST)
            colored = Image.new("RGBA", base.size, colors[cls])
            overlay = Image.composite(colored, overlay, mask_img)

        preview = Image.alpha_composite(base, overlay)
        preview.save(out_dir / f"epoch_{epoch:03d}_{ids[i]}.png")


def evaluate(model, loader):
    model.eval()
    total_loss = 0.0
    total_iou = 0.0
    total_mae = 0.0
    n = 0

    with torch.no_grad():
        for batch in loader:
            x = batch["image"].to(DEVICE)
            y_seg = batch["seg"].to(DEVICE)
            y_reg = batch["reg"].to(DEVICE)

            pred_seg, pred_reg = model(x)
            loss_seg = bce_dice_loss(pred_seg, y_seg)
            loss_reg = F.smooth_l1_loss(pred_reg, y_reg)
            loss = 2.0 * loss_seg + 0.5 * loss_reg

            iou = multilabel_iou(pred_seg, y_seg)
            mae = torch.mean(torch.abs(denormalize_regression(pred_reg) - denormalize_regression(y_reg))).item()

            total_loss += loss.item()
            total_iou += iou
            total_mae += mae
            n += 1

    return {
        "loss": total_loss / max(n, 1),
        "iou": total_iou / max(n, 1),
        "mae": total_mae / max(n, 1),
    }


def main():
    train_ids = load_txt_ids(DATASET_ROOT / "splits" / "train.txt")
    val_ids = load_txt_ids(DATASET_ROOT / "splits" / "val.txt")

    train_ds = RoofDataset(train_ids, augment=True)
    val_ds = RoofDataset(val_ids, augment=False)

    print(f"Using device: {DEVICE}")
    print(f"Train samples after filtering: {len(train_ds)}")
    print(f"Val samples after filtering: {len(val_ds)}")

    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True, num_workers=NUM_WORKERS)
    val_loader = DataLoader(val_ds, batch_size=BATCH_SIZE, shuffle=False, num_workers=NUM_WORKERS)

    model = LovableRoofNet(seg_classes=len(SEG_CLASSES), reg_outputs=len(REG_TARGETS)).to(DEVICE)
    optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=EPOCHS)

    best_score = -1e9
    history = []

    for epoch in range(1, EPOCHS + 1):
        model.train()
        running = 0.0

        for batch in train_loader:
            x = batch["image"].to(DEVICE)
            y_seg = batch["seg"].to(DEVICE)
            y_reg = batch["reg"].to(DEVICE)

            optimizer.zero_grad(set_to_none=True)
            pred_seg, pred_reg = model(x)

            loss_seg = bce_dice_loss(pred_seg, y_seg)
            loss_reg = F.smooth_l1_loss(pred_reg, y_reg)
            loss = 2.0 * loss_seg + 0.5 * loss_reg

            loss.backward()
            optimizer.step()
            running += loss.item()

        scheduler.step()

        val_metrics = evaluate(model, val_loader)
        train_loss = running / max(len(train_loader), 1)

        score = val_metrics["iou"] - (val_metrics["mae"] / 1000.0)

        row = {
            "epoch": epoch,
            "train_loss": train_loss,
            "val_loss": val_metrics["loss"],
            "val_iou": val_metrics["iou"],
            "val_mae": val_metrics["mae"],
            "score": score,
        }
        history.append(row)

        print(
            f"Epoch {epoch:03d} | "
            f"train_loss={train_loss:.4f} | "
            f"val_loss={val_metrics['loss']:.4f} | "
            f"val_iou={val_metrics['iou']:.4f} | "
            f"val_mae={val_metrics['mae']:.2f}"
        )

        if score > best_score:
            best_score = score
            checkpoint = {
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "config": {
                    "image_size": IMAGE_SIZE,
                    "seg_classes": SEG_CLASSES,
                    "reg_targets": REG_TARGETS,
                },
                "metrics": row,
            }
            torch.save(checkpoint, SAVE_DIR / "best_roofnet.pt")
            first_val_batch = next(iter(val_loader))
            save_preview(model, first_val_batch, epoch, PREVIEW_DIR)

        with open(METRIC_DIR / "history.json", "w", encoding="utf-8") as f:
            json.dump(history, f, indent=2)

    print(f"Best score: {best_score:.4f}")
    print(f"Saved checkpoint to: {SAVE_DIR / 'best_roofnet.pt'}")


if __name__ == "__main__":
    main()
