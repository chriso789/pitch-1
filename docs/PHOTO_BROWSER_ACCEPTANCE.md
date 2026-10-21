# Ten-photo browser acceptance

## Current release status

The preview provides developer-only Test first 10 in browser, a frozen private selection, per-photo transactional save/read-back, persisted history on reopen and selectable photo overlays. New attempts preserve prior proposal rows and never write training labels. Same test/photo retries return the stored outcome. Execution failures and failed saves are distinct. Analysis resolution is the model input resolution, not original camera resolution.

Signed-in real-photo acceptance is **not completed**: this project's external Supabase session cannot be restored or minted by the sandbox. No customer photograph was processed in this change. No example image, recognition score, inspector approval or production deployment is claimed. Publication is conditional on that acceptance and is not requested yet.

## Required staging evidence

1. Authorized developer opens Image Trainer → Shared Training; a company user/reviewer cannot invoke browser-test routes.
2. Start ten consented originals, inspect all per-photo statuses and generated outlines. Capture one private example only in the authorized browser.
3. Reload: the saved ordinal, analysis resolution, usable/invalid counts, timing, failures and outlines must match exactly.
4. Retry the same test/photo save: unchanged result and unchanged proposal count. A new test must preserve existing approved labels and proposals.
5. Withdraw consent: original access and result saving are refused; hidden withdrawn results must not be reconstructed in the UI.
6. Visually review ten originals before enabling any larger batch. Only after acceptance and a security scan may the production button be published.

## Central background activation, separately

The existing Python pull executor is code, not a verified running service. Later activation needs an authorized centrally hosted CPU/container environment, Python dependencies from worker/training/requirements.txt, all three ONNX files with trusted SHA-256 hashes, outbound HTTPS to Supabase, and server-only INTERNAL_WORKER_SECRET plus the ai-worker control URL. A scheduler invokes the runner (at most ten claims); provide heartbeat/monitoring, timeout/lease recovery, consent rechecks and cancellation verification. Verify original access, result persistence and interruption/resumption against real consented photos before declaring operational. Reuse already authorized hosting only after capacity is verified. No purchases or services were enabled. Actual model training is separate and still requires independently approved labels and unseen-property evaluation.

## Verification limits

Unit tests cover authorization, ten-item selection, consent/access withdrawal, invalid polygon exclusion and failed-save partial progress with simulated inputs. They are not real-image acceptance or recognition evidence. Database grants deny app roles access to the new private result table/RPC; service endpoints recheck developer access and current consent. Existing security findings remain a separate remediation backlog.