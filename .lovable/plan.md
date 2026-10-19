# Image Trainer — Developer-Only Access Control

Make the Photo Intelligence Image Trainer a platform-developer tool. Customer-facing Photo Intelligence (upload, analysis, findings review, reports) is unchanged.

## Database (one staged migration)

1. **New roles**: add `platform_developer` and `platform_training_reviewer` to the `app_role` enum. Assigned only by master users through the existing user_roles flow.
2. **Helper**: `public.has_training_access(_user_id, _min_role)` — SECURITY DEFINER, `SET search_path = public`, returns true for `master`/`platform_developer`, and for read/label-review operations also `platform_training_reviewer`.
3. **Lock trainer tables** (developer-only; drop the current "any company member" policies and replace with `has_training_access` policies):
   - `photo_training_originals`, `photo_training_labels`, `photo_training_datasets`, `photo_training_events`
   - `photo_damage_models`, `photo_damage_deployments`
   - `photo_reference_candidates`, `photo_reference_reviews`, `photo_triage_results`, `photo_region_proposals`
   - `photo_benchmark_sets`, `photo_benchmark_items`
   - `photo_reference_examples` keeps its existing platform-admin-only management policy; the broad "signed-in users can read" SELECT policy is replaced with `has_training_access`.
   - `platform_training_access_log` unchanged (already platform-admin only).
4. **RPC guards** (all are non-definer, so they inherit the new RLS; add an explicit `has_training_access(auth.uid())` check at the top of each so misuse fails with a clear error, not a silent row filter):
   - `photo_training_label_save`, `photo_training_label_review`, `photo_training_dataset_create`, `photo_training_original_add`
   - `photo_damage_model_register/evaluate/review/activate` — `activate` (promote/rollback) additionally requires `platform_developer`/`master`, not `platform_training_reviewer`.
   - `review_reference_candidate`, `platform_training_overview` — platform roles only (overview already platform-admin; align to the helper).
5. **Deliberately unchanged**:
   - `set_photo_training_contribution` and contribution tables — company admins still opt their company in/out; only the platform can aggregate.
   - `photo_training_canvass_register` (SECURITY DEFINER, called by the customer canvass flow) — stays company-accessible; it only registers immutable originals.
   - `photo_findings`, `photo_finding_reviews`, `photo_finding_evidence`, `photo_intelligence_reports`, `photo_proposal_runs` — customer-facing inference/review, stays tenant-scoped. Customer report approval never creates training labels (already true; add a test).

## Frontend

- Route `/photo-intelligence/training` wrapped in a new `RequirePlatformTrainingAccess` guard that queries `user_roles` server-side (no localStorage/frontend-only checks); non-developers are redirected with a notice.
- The "Labeling & model training" link on the Photo Intelligence review page renders only for platform developers (same server-checked hook).
- Nav/sidebar: no trainer entry for company accounts (verify none exists today besides the review-page link).
- Company admins keep the Shared Training opt-in control — move that tab's `PlatformTrainingTab` contribution switch into a company-admin-visible location (company settings), leaving the cross-company analytics view developer-only.

## Docs & rules

- Update `docs/PHOTO_INTELLIGENCE_REQUIREMENTS.md` with the role split (developer vs company admin vs reps, the capability table from the brief).
- Update the compact Photo Intelligence rule in `AGENTS.md` within its byte budget.

## Verification

- New unit tests: role matrix (rep/company admin denied; reviewer can label-review but cannot activate a model; developer/master full access; contribution opt-in still works for company admins).
- Live DB checks after migration: as a non-privileged session, confirm denied SELECT/INSERT on trainer tables and denied RPC calls; confirm canvass registration still succeeds.

## Not in scope

- No new edge functions (architecture guard); all enforcement is RLS + RPC guards.
- YOLO licensing review and real-photo training remain open items.
