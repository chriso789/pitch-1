# Damage-only local training

TorchVision code uses BSD-3-Clause (https://github.com/pytorch/vision/blob/main/LICENSE). No pretrained weights are fetched: both model and backbone weights are `None`. Dataset/photo rights still require independent review. This replaces the previous AGPL Ultralytics path; no commercial license was purchased. This is not legal advice.

Export an independently approved dataset from Photo Intelligence → Training readiness, unzip it, install `requirements.txt` in an isolated training environment, then run:

```sh
python worker/training/train_detector.py --data export/v1 --out runs/v1 --epochs 1 --device cpu
python worker/training/train_detector.py --data export/v1 --out runs/v1 --epochs 1 --device cpu --resume
```

Only explicitly authorized GPU hosts should use `--device cuda`. Inputs are original SHA-256-verified photos; labels must have a second inspector's approval. The manifest controls class order (background ID 0, damage IDs 1..N). Property-isolated test images never enter optimizer updates. Negatives use empty targets. Checkpoints retain optimizer/configuration/dataset identity; prediction export is computed from held-out photos only and can be imported into the registry for server-computed metrics.

`--smoke-test --size 64` uses a small Faster R-CNN backbone for synthetic software execution only, not a production model or accuracy evidence. All checkpoints remain unvalidated. Registry activation is bookkeeping only: it does not install weights, switch the worker, publish the app or authorize a customer deployment. ONNX export and native/ONNX parity remain a release gate until performed against a real trained checkpoint. The current worker's legacy class map is not compatible with this dataset map and must not consume these checkpoints as-is.