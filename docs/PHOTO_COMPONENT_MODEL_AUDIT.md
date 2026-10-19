# Photo Intelligence — Phase 1: Pretrained Model & License Audit

Date: 2026-10-19. Scope: locally runnable (ONNX) pretrained vision models for
component recognition. "Compatible" means published commercial-compatible
licensing, **not** a legal warranty and **not** evidence of roofing accuracy.

## Decisions

| Role | Choice | Weights license | Size (FP32) | Notes |
|---|---|---|---|---|
| Feature extraction / similarity | **DINOv2 Small** (Meta) | Apache-2.0 (code + weights, explicit) | ~84 MB | Best-cleared general visual features; needs downstream heads for classification/segmentation |
| Segmentation (component boundaries) | **SAM 2.1 Tiny** (Meta) | Apache-2.0 (code + checkpoints, explicit) | ~156 MB | Promptable masks, no semantic labels; ONNX export is integration work — worker preferred |
| Object detection (backup) | **DETR R50** (Meta) | Apache-2.0 | ~166 MB | Export needed; worker preferred |
| Material classification (domain lead) | **RoofSense** (ResNet18-D + DeepLabV3+) | Code MIT, weights CC-BY-4.0 | — | Roofing-material segmentation; verify input bands (multimodal/LiDAR) fit ordinary CRM photos before adoption |
| Zero-shot / text-image similarity (optional) | **CLIP** (OpenAI) | MIT | image encoder ~350 MB | No masks; model card requires context-specific evaluation |

ONNX Runtime is MIT; `onnxruntime-web` bundles in Vite (WASM assets ~11–14 MB
standard SIMD; ~22–28 MB JSEP — ship only one backend, lazy-load models,
self-host assets, pin JS/WASM versions).

## Held out — not used without explicit approval

- **Ultralytics YOLOv8/YOLO11** — AGPL-3.0 or paid Enterprise; ONNX conversion does not remove obligations. Existing YOLO licensing review stays open.
- **SegFormer** — NVIDIA license limits use to research/evaluation; the Apache Transformers implementation does not relicense the pretrained weights.
- **Torchvision weights** (MobileNetV3, EfficientNet, ResNet, DeepLabV3, Mask R-CNN) — BSD code, but torchvision warns pretrained weights "may have their own licenses or terms derived from the dataset". No blanket clearance.
- **FastViT** — Apple custom license, no patent grant. **MobileSAM** — no explicit separate weights statement.
- **Roofpedia / RID / RoofNet** — dataset/weight rights unclear; research leads only.

## Installed

- **DINOv2-Small** (quantized ONNX, Xenova export of Meta's Apache-2.0 weights), stored in the asset store (24,451,943 bytes), served from a PITCH-controlled URL. Loaded lazily by `src/lib/photo-intelligence/components/onnxModel.ts`. **Validated by execution (2026-10-19):** input `pixel_values` [1,3,224,224], output `last_hidden_state` [1,257,384] (1 CLS + 256 patch tokens = 16×16 grid, 384-dim embeddings); a real CPU inference run succeeded. Used for feature extraction + neighbour similarity only — `dinov2SimilarityModel.segment()` returns zero regions because no verified segmentation head exists.

## Open before Phase 2 integration

1. Download and hash chosen checkpoints; preserve LICENSE/NOTICE files.
2. Device-level proof of concept (opset, browser operator coverage, memory, latency) before any UI wiring.
3. Roofing fit validation — none of these are pretrained roof-condition estimators; component classes PITCH reports come only from a verified class list, everything else is `unknown` (enforced in `src/lib/photo-intelligence/components/componentRecognition.ts`).

Sources: github.com/facebookresearch/dinov2, /sam2, /detr, /segment-anything;
github.com/openai/CLIP; github.com/NVlabs/SegFormer (LICENSE §3.3);
ultralytics.com/license; docs.pytorch.org/vision (pretrained-weights warning);
github.com/DimitrisMantas/RoofSense; huggingface.co/DimitrisMantas/RoofSense;
github.com/apple/ml-fastvit; github.com/ChaoningZhang/MobileSAM;
onnxruntime.ai/docs (web build/deploy); github.com/microsoft/onnxruntime (MIT).
