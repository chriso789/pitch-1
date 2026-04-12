import os, json, math, argparse, random
from pathlib import Path
from typing import List, Dict

import numpy as np
from PIL import Image, ImageDraw

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from torchvision.models import resnet18

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


def set_seed(seed: int = 42):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def load_ids(path: Path) -> List[str]:
    if not path.exists():
        return []
    return [x.strip() for x in path.read_text().splitlines() if x.strip()]


def normalize_targets(t: Dict[str, float]) -> torch.Tensor:
    vals = [
        float(t["total_area_sqft"]) / 10000.0,
        float(t["ridge_ft"]) / 500.0,
        float(t["hip_ft"]) / 500.0,
        float(t["valley_ft"]) / 500.0,
        float(t["eave_ft"]) / 1000.0,
        float(t["rake_ft"]) / 500.0,
        float(t["predominant_pitch"]) / 12.0,
    ]
    return torch.tensor(vals, dtype=torch.float32)


def denormalize_targets(x: torch.Tensor) -> torch.Tensor:
    scales = torch.tensor([10000.0, 500.0, 500.0, 500.0, 1000.0, 500.0, 12.0], device=x.device)
    return x * scales


class RoofDataset(Dataset):
    def __init__(self, root: Path, ids: List[str], image_size: int = 512, augment: bool = False):
        self.root = root
        self.ids = ids
        self.image_size = image_size
        self.augment = augment
        self.tf = transforms.Compose([
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
        ])

        self.valid_ids = []
        for sid in ids:
            img = root / "images" / f"{sid}.png"
            lbl = root / "labels" / f"{sid}.json"
            meta = root / "metadata" / f"{sid}.json"
            fp = root / "masks" / "footprint" / f"{sid}.png"
            if img.exists() and lbl.exists() and meta.exists() and fp.exists():
                self.valid_ids.append(sid)

    def __len__(self):
        return len(self.valid_ids)

    def _load_mask(self, cls: str, sid: str, size):
        p = self.root / "masks" / cls / f"{sid}.png"
        if p.exists():
            img = Image.open(p).convert("L").resize((self.image_size, self.image_size), Image.NEAREST)
            arr = (np.array(img) > 0).astype(np.float32)
        else:
            arr = np.zeros((self.image_size, self.image_size), dtype=np.float32)
        return torch.from_numpy(arr)

    def __getitem__(self, idx):
        sid = self.valid_ids[idx]
        img = Image.open(self.root / "images" / f"{sid}.png").convert("RGB")
        x = self.tf(img)

        masks = [self._load_mask(cls, sid, img.size) for cls in SEG_CLASSES]
        y_seg = torch.stack(masks, dim=0)

        label = json.loads((self.root / "labels" / f"{sid}.json").read_text())
        y_reg = normalize_targets(label)
        return {"id": sid, "image": x, "seg": y_seg, "reg": y_reg}


class ConvBlock(nn.Module):
    def __init__(self, in_ch, out_ch):
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
    def __init__(self, in_ch, skip_ch, out_ch):
        super().__init__()
        self.conv = ConvBlock(in_ch + skip_ch, out_ch)

    def forward(self, x, skip):
        x = F.interpolate(x, size=skip.shape[-2:], mode="bilinear", align_corners=False)
        x = torch.cat([x, skip], dim=1)
        return self.conv(x)


class RoofNet(nn.Module):
    def __init__(self, seg_classes=6, reg_outputs=7):
        super().__init__()
        backbone = resnet18(weights=None)
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
        self.seg_head = nn.Conv2d(32, seg_classes, 1)
        self.reg_head = nn.Sequential(
            nn.AdaptiveAvgPool2d(1), nn.Flatten(), nn.Linear(512, 128), nn.ReLU(inplace=True), nn.Dropout(0.2), nn.Linear(128, reg_outputs)
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


def dice_loss(logits, targets, eps=1e-6):
    probs = torch.sigmoid(logits)
    probs = probs.flatten(2)
    targets = targets.flatten(2)
    inter = (probs * targets).sum(-1)
    union = probs.sum(-1) + targets.sum(-1)
    dice = (2 * inter + eps) / (union + eps)
    return 1 - dice.mean()


def seg_loss(logits, targets):
    return 0.5 * F.binary_cross_entropy_with_logits(logits, targets) + 0.5 * dice_loss(logits, targets)


def multilabel_iou(logits, targets, thr=0.5, eps=1e-6):
    probs = (torch.sigmoid(logits) > thr).float()
    targets = (targets > 0.5).float()
    inter = (probs * targets).sum(dim=(2,3))
    union = ((probs + targets) > 0).float().sum(dim=(2,3))
    return ((inter + eps) / (union + eps)).mean().item()


def evaluate(model, loader, device):
    model.eval()
    total_loss = total_iou = total_mae = 0.0
    mae_per = torch.zeros(len(REG_TARGETS), device=device)
    n = 0
    with torch.no_grad():
        for batch in loader:
            x = batch["image"].to(device)
            y_seg = batch["seg"].to(device)
            y_reg = batch["reg"].to(device)
            p_seg, p_reg = model(x)
            loss = 2.0 * seg_loss(p_seg, y_seg) + 0.5 * F.smooth_l1_loss(p_reg, y_reg)
            total_loss += loss.item()
            total_iou += multilabel_iou(p_seg, y_seg)
            mae = torch.abs(denormalize_targets(p_reg) - denormalize_targets(y_reg))
            mae_per += mae.mean(dim=0)
            total_mae += mae.mean().item()
            n += 1
    if n == 0:
        return {"loss": None, "iou": None, "mae": None, "mae_per_target": None}
    mae_per = (mae_per / n).detach().cpu().tolist()
    return {
        "loss": total_loss / n,
        "iou": total_iou / n,
        "mae": total_mae / n,
        "mae_per_target": dict(zip(REG_TARGETS, mae_per)),
    }


def save_preview(model, batch, device, out_dir: Path, epoch: int):
    out_dir.mkdir(parents=True, exist_ok=True)
    model.eval()
    with torch.no_grad():
        x = batch["image"].to(device)
        ids = batch["id"]
        p_seg, _ = model(x)
        probs = torch.sigmoid(p_seg).cpu().numpy()
    for i in range(min(2, len(ids))):
        arr = (x[i].cpu().permute(1,2,0).numpy() * 255).clip(0,255).astype(np.uint8)
        base = Image.fromarray(arr).convert("RGBA")
        overlay = Image.new("RGBA", base.size, (0,0,0,0))
        draw = ImageDraw.Draw(overlay)
        colors = {
            "footprint": (0,255,0,60),
            "ridge": (255,0,0,180),
            "hip": (255,165,0,180),
            "valley": (0,0,255,180),
            "eave": (0,180,0,180),
            "rake": (200,100,0,180),
        }
        for c, cls in enumerate(SEG_CLASSES):
            mask = (probs[i, c] > 0.5).astype(np.uint8) * 255
            m = Image.fromarray(mask).resize(base.size, Image.NEAREST)
            color = Image.new("RGBA", base.size, colors[cls])
            overlay = Image.composite(color, overlay, m)
        merged = Image.alpha_composite(base, overlay).convert("RGB")
        merged.save(out_dir / f"epoch_{epoch:03d}_{ids[i]}.png")


def classify_readiness(val_iou: float | None, test_iou: float | None, test_mae: float | None) -> str:
    if val_iou is None or test_iou is None or test_mae is None:
        return "not usable"
    if val_iou < 0.25 or test_iou < 0.20:
        return "not usable"
    if val_iou < 0.45:
        return "internal testing only"
    if val_iou < 0.65:
        return "guarded production capable"
    return "strong enough for primary inference"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data_dir", type=str, required=True)
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--batch_size", type=int, default=4)
    ap.add_argument("--image_size", type=int, default=512)
    ap.add_argument("--lr", type=float, default=3e-4)
    args = ap.parse_args()

    root = Path(args.data_dir)
    set_seed(42)
    device = "cuda" if torch.cuda.is_available() else "cpu"

    train_ids = load_ids(root / "splits" / "train.txt")
    val_ids = load_ids(root / "splits" / "val.txt")
    test_ids = load_ids(root / "splits" / "test.txt")

    train_ds = RoofDataset(root, train_ids, image_size=args.image_size, augment=True)
    val_ds = RoofDataset(root, val_ids, image_size=args.image_size, augment=False)
    test_ds = RoofDataset(root, test_ids, image_size=args.image_size, augment=False)

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, num_workers=2, pin_memory=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, num_workers=2, pin_memory=True)
    test_loader = DataLoader(test_ds, batch_size=args.batch_size, shuffle=False, num_workers=2, pin_memory=True)

    model = RoofNet(seg_classes=len(SEG_CLASSES), reg_outputs=len(REG_TARGETS)).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)

    ckpt_dir = root / "exports" / "checkpoints"
    metrics_dir = root / "exports" / "metrics"
    preview_dir = root / "exports" / "previews" / "validation_predictions"
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    metrics_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)

    history = []
    best_score = -1e9
    best_epoch = None

    for epoch in range(1, args.epochs + 1):
        model.train()
        total_train = 0.0
        steps = 0
        for batch in train_loader:
            x = batch["image"].to(device)
            y_seg = batch["seg"].to(device)
            y_reg = batch["reg"].to(device)
            opt.zero_grad(set_to_none=True)
            p_seg, p_reg = model(x)
            loss = 2.0 * seg_loss(p_seg, y_seg) + 0.5 * F.smooth_l1_loss(p_reg, y_reg)
            loss.backward()
            opt.step()
            total_train += loss.item()
            steps += 1
        sched.step()

        val_metrics = evaluate(model, val_loader, device)
        train_loss = total_train / max(steps, 1)
        score = (val_metrics["iou"] or 0.0) - ((val_metrics["mae"] or 9999.0) / 1000.0)
        row = {
            "epoch": epoch,
            "train_loss": train_loss,
            "val_loss": val_metrics["loss"],
            "val_iou": val_metrics["iou"],
            "val_mae": val_metrics["mae"],
            "val_mae_per_target": val_metrics["mae_per_target"],
            "score": score,
        }
        history.append(row)
        print(json.dumps(row))

        if score > best_score:
            best_score = score
            best_epoch = epoch
            torch.save({
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "config": {
                    "image_size": args.image_size,
                    "seg_classes": SEG_CLASSES,
                    "reg_targets": REG_TARGETS,
                    "model": "RoofNet(resnet18)"
                },
                "metrics": row,
            }, ckpt_dir / "best_roofnet.pt")
            if len(val_ds) > 0:
                save_preview(model, next(iter(val_loader)), device, preview_dir, epoch)

        with open(metrics_dir / "history.json", "w") as f:
            json.dump(history, f, indent=2)

    ckpt = torch.load(ckpt_dir / "best_roofnet.pt", map_location=device)
    model.load_state_dict(ckpt["model_state_dict"])
    test_metrics = evaluate(model, test_loader, device)

    readiness = classify_readiness(
        next((h["val_iou"] for h in history if h["epoch"] == best_epoch), None),
        test_metrics["iou"],
        test_metrics["mae"],
    )

    training_summary = {
        "samples_used": {
            "train": len(train_ds),
            "val": len(val_ds),
            "test": len(test_ds),
            "total": len(train_ds) + len(val_ds) + len(test_ds),
        },
        "model": "RoofNet(resnet18)",
        "epochs": args.epochs,
        "best_epoch": best_epoch,
        "best_validation_metrics": next((h for h in history if h["epoch"] == best_epoch), None),
        "test_metrics": test_metrics,
        "checkpoint_path": str(ckpt_dir / "best_roofnet.pt"),
        "readiness_classification": readiness,
        "device": device,
    }

    with open(metrics_dir / "training_summary.json", "w") as f:
        json.dump(training_summary, f, indent=2)

    print("\n=== TRAINING SUMMARY ===")
    print(json.dumps(training_summary, indent=2))


if __name__ == "__main__":
    main()
