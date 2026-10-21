# GitHub gap closure — 2026-10-21

## Corrected deployed execution audit — 2026-10-21

- All three exact existing asset URLs on `https://pitch-crm.ai` and the hosted preview returned binary `206 application/octet-stream` range responses with expected sizes: DINOv2 24,451,943 bytes; SAM encoder 53,002,825; SAM decoder 8,942,627. Earlier localhost HTML fallback does not establish a deployed delivery failure.
- Executed the published application's actual ONNX module in Chromium on the production origin, without a customer session or customer-photo access. DINOv2 loaded and returned 256 finite patch similarity values; model load 5.16s, inference 0.53s. SAM loaded and executed; load 1.18s, inference 13.75s, nine unknown outlines, zero verified classes. Input was synthetic texture: this verifies deployed execution, NOT roofing recognition or customer-photo acceptance.
- The published version currently exposes “Prepare up to 100 authorized photos”; it is foreground browser preparation, not the durable worker queue. Current source had replaced this with a queue-only action. Restored a separate “Test first 10 in browser” action, bounded before downloads and inference, with current consent/access refresh and per-photo results. Changes are preview/source only; production was not published.
- Signed-in ten-customer-photo download → inference → save → read-back remains unverified here because external unmanaged Supabase sessions are unavailable. A signed-in platform developer can use the browser action independently of background-worker availability; company owners without platform developer permission cannot.
- Background jobs have a real pull-executor implementation (`prepare_photos.py`) and authenticated claim/finish integration, but no verified centrally running process, scheduler, model mounts or heartbeat. Queue rows alone do not execute models. `workerConfigured: false` is a conservative hardcoded declaration, not health detection.
- Recommended central architecture: existing authorized container/CPU compute, if available and suitable → bounded scheduled pull runner → Supabase lease claim → short-lived original → ONNX CPU execution → atomic finish. Supabase remains authority for permissions, consent, retries and progress. Existing measurement Docker configuration does not package or schedule preparation; no authorized hosting connection was established, so no deployment/provisioning was performed. Edge Functions remain the control plane, not the heavy model executor. Train checkpoints separately only with approved labels, evaluation data and authorization.

The sections below describe the earlier implementation audit; localhost-only asset conclusions and employee-machine wording are superseded by this deployed audit.

## Observed live data

Read-only database counts: 457 customer photos from 3 companies and 41 properties; 234 currently consented photos from 1 company and 11 properties. Two photo-owning companies have no current shared-training consent. Eligible storage references matched stored objects (0 missing references); signed download/read access remains unverified.

Processed photos: 0. Saved outlines: 0. Independently approved reference candidates: 0. Shared reference examples: 0. Approved condition-training labels: 0. Registered model versions: 0. Held-out recognition results: unavailable. No count or polygon is treated as a recognition result.

The developer-authenticated inventory endpoint could not be exercised from this sandbox because this project's external Supabase session cannot be minted here. Counts above are read-only database observations, not a signed-in customer acceptance test.

## Implemented in this change

- Durable database preparation jobs/items; developer-only creation/management and reads; property-diverse initial batch of ten, maximum 100.
- Internal `ai-worker` claim/finish routes with server-derived company/photo identity, current-consent checks, five-minute original links, global single-flight ten-minute leases, maximum three attempts with delayed transient retries, cancellation and atomic result persistence.
- Bounded existing-host CPU runner using audited DINOv2/SAM files with trusted hash checks, image quality filtering, duplicate suppression, embeddings and unknown outlines. Missing host/model configuration is not disguised as processing success.
- Developer UI queues jobs, reads durable progress/errors/timing and can cancel/resume. Browser closure no longer loses the queue; computation still needs an existing host running the CLI.
- Versioned shared reference publication derives labels/approval/provenance from independently reviewed candidates, not caller-provided reviewer identifiers. Future reads recheck consent. Customer inference receives anonymous example handles and embeddings, not source photos/region/customer/inspector identifiers. Direct authenticated table access revoked.
- Eight legacy `training-data-api` 501 routes audited with no identified live callers. They remain explicitly unimplemented; they are not the Photo Intelligence inventory/job/library routes, and roof geometry training remains separate.

## Not executed / blocked

- First ten real-photo processing: no verified CPU preparation host, model installation or scheduler; no developer browser session. No hosting purchased. The runner can operate on an existing authorized machine after configuration.
- Training/checkpoints and held-out accuracy: no independently approved dataset exists. Existing offline trainer remains experimental; no real training was executed.
- Condition ONNX export, dataset-compatible model loading, native-versus-deployed parity and staged installed-weight activation/rollback remain incomplete. Existing registry controls are not a functioning weights deployment. Do not install dataset-ordered checkpoints into the legacy fixed-class worker.
- Shared publication has no approved examples to distribute. Zero examples published is not a classifier.
- GitHub remote verification failed with credential rejection. Observed starting checkout: `8b13e5dc2e8874452bbced94c54981a9dea235f5`; later platform-managed commit/sync not claimed.
- Observed platform-managed implementation checkpoint: `031bcb9b9cf6f13a47dec4d804808d3f78f975af`; remote synchronization remains unverified.
- Local ONNX asset requests returned HTTP 200 with 4,088-byte HTML, not the expected model binaries. The runner therefore did not execute DINOv2 or SAM. Asset delivery/model provisioning is an additional explicit blocker; no alternate model substituted.
- 256 pre-existing database security findings are outside this change. New privileged operations moved behind non-definer public wrappers; the new migration warnings were resolved.

## Acceptance

Automated tests check quality gating, model integrity requirement, browser-compatible normalization, region pooling, shared-library privacy, model-space isolation and rejection of caller-supplied approval. These use synthetic inputs and do not establish accuracy. Database assertions check anonymous/worker privilege boundaries and unsigned mutation rejection. Signed-in two-inspector labeling, real processing, cross-company inference and trained-model acceptance remain unverified.

Executed: 20 JavaScript tests and 5 Python tests passed; live migration security assertions passed; deployed job creation rejected an invalid bearer token with 401 and internal claim rejected missing worker authorization with 403. Latest preview log showed build OK. Queue claim/finish transaction behavior with a real authorized job is not yet tested end-to-end and is not certified operational.