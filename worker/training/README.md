# Local roof-condition training

## Durable photo preparation (existing host only)

`prepare_photos.py` is a bounded command-line runner, not a new server. A developer queues ten photos in Image Trainer; the database persists progress, single-flight leases, consent checks, cancellations and delayed retries. An authorized existing CPU host can then run:

```sh
python worker/training/prepare_photos.py --models /secure/pitch-models --max-items 10
```

Install the training requirements in that host's isolated environment. Provision the three audited ONNX files named in `MODEL_FILES`; set trusted `PITCH_DINO_SHA256`, `PITCH_ENCODER_SHA256`, `PITCH_DECODER_SHA256` hashes, `PITCH_PREPARATION_CONTROL_URL` to the HTTPS `/functions/v1/ai-worker` endpoint, and `INTERNAL_WORKER_SECRET` through the host's secret manager. Never commit those secrets. The runner validates files before claiming work, uses two CPU threads, one image at a time and at most ten items per invocation. Configure an existing host scheduler to invoke it later for pending/retry work; the browser is not required after job creation. No scheduler/host has been provisioned or verified by this change.

Storage references are signed only after current consent and tenant path verification. Original downloads stop at 15 MB; decoding caps images at 40 million pixels. Failures clear the lease, transient download failures get at most three database-controlled attempts with backoff; terminal errors do not retry. Missing models fail before claiming a photo. Interrupted processes are recovered after the ten-minute lease expires. Model output is feature embeddings plus unknown outlines, not roofing recognition.

**Operational blocker:** the configured Supabase secrets include `INTERNAL_WORKER_SECRET` but no verified preparation host, model mounts or scheduler. Running a local synthetic test does not establish hosted processing, original-photo access, or recognition accuracy.

TorchVision code uses BSD-3-Clause (https://github.com/pytorch/vision/blob/main/LICENSE). No pretrained weights are fetched: both model and backbone weights are `None`. Dataset/photo rights still require independent review. This replaces the previous AGPL Ultralytics path; no commercial license was purchased. This is not legal advice.

Export an independently approved dataset from Photo Intelligence → Training readiness, unzip it, install `requirements.txt` in an isolated training environment, then run:

```sh
python worker/training/train_detector.py --data export/v1 --out runs/v1 --epochs 1 --device cpu
python worker/training/train_detector.py --data export/v1 --out runs/v1 --epochs 1 --device cpu --resume
```

Only explicitly authorized GPU hosts should use `--device cuda`. Inputs are original SHA-256-verified photos; labels must have a second inspector's approval. The manifest controls class order (background ID 0, damage IDs 1..N). Property-isolated test images never enter optimizer updates. Negatives use empty targets. Checkpoints retain optimizer/configuration/dataset identity; prediction export is computed from held-out photos only and can be imported into the registry for server-computed metrics.

Normal component groups and maintenance regions are explicit detector targets alongside visible defects; one approved group can support a provisional internal experiment. Photos containing uncertain/not-assessable regions remain review-only and are excluded from optimizer updates and held-out predictions, not converted to healthy background. The model is still a joint detector, not a validated material→component→condition pipeline. Bounding boxes are evaluated, not verified segmentation. A small experiment does not satisfy production support/precision/recall gates.

Local held-out evaluation (no paid service):

```sh
bun worker/training/evaluate_conditions.ts export/v1/manifest.json runs/v1/heldout_predictions.json runs/v1/evaluation.json
```

Reports separate roof systems/classes and normal/damage/maintenance metrics, false defect predictions on normal photographs, missed defects, bbox IoU, confidence calibration and review-only exclusions. Material and component stages are explicitly untrained. Condition registry SQL changes are pending staging approval; do not import these results as production approval.

`--smoke-test --size 64` uses a small Faster R-CNN backbone for synthetic software execution only, not a production model or accuracy evidence. All checkpoints remain unvalidated. Registry activation is bookkeeping only: it does not install weights, switch the worker, publish the app or authorize a customer deployment. ONNX export and native/ONNX parity remain a release gate until performed against a real trained checkpoint. The current worker's legacy class map is not compatible with this dataset map and must not consume these checkpoints as-is.