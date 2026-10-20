# Photo Intelligence — Detailed Requirements

This document holds the detailed requirements summarized in the root `AGENTS.md`.
The compact rules in `AGENTS.md` remain authoritative; this file is the full text
they point to. Date: 2026-10-19.

## 1. Component recognition (DINOv2 reference classifier)

- Component names come only from the DINOv2 nearest-prototype reference
  classifier (`src/lib/photo-intelligence/components/referenceLibrary.ts`).
- A match requires BOTH:
  1. **Similarity threshold** — cosine similarity to the best prototype must
     meet the calibrated threshold, and
  2. **Competing-class margin** — the best class must beat the runner-up class
     by the calibrated margin. A high-similarity match with no clear margin is
     rejected.
- **Uncertain matches return `unknown`**, never a guessed component. Classes
  outside the verified class list are always `unknown`
  (`componentRecognition.ts` enforces this).
- **Hard negatives stay separate.** Shadows, debris, repairs and normal color
  variations are distinct hard-negative example categories; they never
  auto-dismiss a finding and never relabel a region as another component.
- Thresholds come only from leave-one-property-out calibration with adequate
  cross-property evidence (`calibration.ts`); defaults are unvalidated.

## 2. Original-photo integrity (canvassing)

- Canvassing photos keep their original storage references
  (`{tenant_id}/{property_id}/{sha256}.{ext}`), company ownership, and capture
  metadata. See `docs/PHOTO_CONDITION_STAGING.md` and
  `docs/canvass-training-schema.sql`.
- Originals are immutable: no AI result, annotation, label or training
  operation may overwrite an original photograph. Edits create new records
  linked to the original.
- Trusted SHA-256 identity (`canvassOriginalIdentity`) ties every original to
  its company and property; offline retries re-use the same identity and never
  create duplicates.
- Links between originals and inspector-approved findings are preserved;
  rep observations stay preliminary and are never promoted to labels.

## 3. Independent inspector approval

- Every label and reference example requires approval by a second inspector
  who is not the labeler. Self-approval, anonymous review, cross-company
  review, repeat review and reasonless rejection are blocked server-side
  (`review_reference_candidate` RPC; see `tests/database/review-reference-candidate.sql`).
- Direct table updates that would bypass review are revoked; all review goes
  through the checked RPC.
- Corrected labels require fresh independent approval.

## 4. Company-level training opt-in

- Shared platform training is off by default. A company administrator must
  explicitly agree to the data-use terms (`TRAINING_TERMS_VERSION`) to opt in,
  and may withdraw at any time. Companies are never enrolled automatically.
- Only opted-in companies contribute; withdrawn and never-enrolled companies
  are excluded from future datasets (`contributesToTraining`).
- Opt-in/withdraw actions are recorded in
  `photo_training_contribution_events` (audit log).

## 5. Platform-wide counts-only visibility

- The cross-company overview (`platform_training_overview`) returns counts
  only: never photos, links, embeddings, addresses or company names.
- Original photos stay private to each company.

## 6. Cross-company training authorization and audit logging

- Cross-company visibility is authorized only through the opt-in RPC
  (`set_photo_training_contribution`) and is audit-logged per company.
- Platform-admin promotion of shared reference examples is separate from
  tenant-level review and is also approval-gated.

## 7. Training dataset provenance and model evaluation

- Training requires independently approved labels and property-isolated
  splits: photos from one property never appear in both training and
  evaluation sets.
- Datasets track provenance: source photo hash, company, property, labeler,
  approver, and model/embedding version.
- Hard negatives, normal/maintenance/uncertain classes are explicit dataset
  categories; uncertain examples stay review-only and never enter optimizer
  updates or held-out predictions.
- Model promotion requires measured gates (benchmark scores on unseen
  properties); registry activation is bookkeeping only and does not install
  weights or authorize deployment. See `worker/training/README.md`.

## 8. Pattern analysis limits

- Untrained pattern analysis yields pending `possible_anomaly` regions only —
  never damage. Poor-quality images become not-assessable; no unusual region
  means no finding. Every anomaly requires inspector review.

## 9. Image Trainer access split

- The Image Trainer (labeling, independent label review, datasets, model
  registry, benchmark sets, reference libraries, triage and region proposals)
  is a platform-internal tool. Company users — including company owners —
  have no route, menu link, API or database access to it.
- Two platform roles exist in `user_roles` (roles are never stored on
  profiles): `platform_training_reviewer` may label, review and triage;
  `platform_developer` additionally controls dataset creation, model
  registration, evaluation, promotion and rollback. Master users hold
  developer-level access. Authorization is always server-side: the
  `has_training_access` security-definer function plus RLS policies on every
  trainer table; UI gating only hides links and is never the enforcement.
- Company admins see exactly one training-related control: the contribution
  opt-in (Settings → AI Training), which decides whether their independently
  approved examples may be used in shared training. It is audit-logged and
  withdrawable; it grants no visibility into the trainer.
- Customer-facing Photo Intelligence (photo reports, inspector review of
  findings) remains available to company users and is unaffected. A
  customer's approval of a finding on a report is separate from training
  label approval and never creates a training example by itself.

## 10. Existing CRM shared-photo preparation

- Training service inventory, batch and save routes require a verified platform developer. The inventory RPC is service-only; its cross-company implementation lives in a private schema. Access is logged.
- Only current `pitch-photo-training-v1` opt-ins with recorded authorizer/date and no withdrawal enter the batch. Unknown terms versions are excluded; companies are never automatically enrolled.
- The initial batch is capped at 100 and round-robins properties across authorized companies. Unassigned images are excluded. Customer photograph counts and other image records stay separate; documents can duplicate photos and not all images show roofs.
- Five-minute original access requires tenant-prefixed storage ownership. Local quality, duplicate, DINOv2 and SAM preparation refreshes consent before each photo; saves recheck consent. Originals stay unchanged, proposals unknown/unverified. Existing company Reference library controls handle bulk labeling and independent review.
- External Supabase provides no developer session in this sandbox. Real-photo processing and signed-in acceptance remain unverified; zero processed photos never establishes a model result.
