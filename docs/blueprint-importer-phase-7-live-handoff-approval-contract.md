# Blueprint Importer v2 — Phase 7: Live Handoff Approval Contract

**Status:** Docs-only. No code, no DB migration, no endpoint changes, no worker changes, no UI changes, no shared TS/Python contract changes, no JSON schema changes. No live writes of any kind.

**Scope:** Defines the final approval contract that must be in place before any Phase 8 live-write implementation may begin. Companion documents:

- [`blueprint-live-handoff-status-mapping.md`](./blueprint-live-handoff-status-mapping.md)
- [`blueprint-existing-line-resolution-policy.md`](./blueprint-existing-line-resolution-policy.md)
- [`blueprint-provenance-bridge-live-write-contract.md`](./blueprint-provenance-bridge-live-write-contract.md)
- [`blueprint-catalog-resolver-requirements.md`](./blueprint-catalog-resolver-requirements.md)

Phase 6 docs re-read: yes. Phase 5.5 docs re-read: yes. `enhanced_estimates`, `estimate_line_items`, `blueprint_estimate_line_provenance`, `blueprint_estimate_line_candidates`, and `blueprint_estimate_handoff_batches` schemas inspected via `information_schema`.

---

## 1. Phase 7 scope

Phase 7 settles five contract questions that block any live handoff path:

1. `enhanced_estimates` status mapping for live-write eligibility.
2. Existing-line / deterministic-key resolution policy.
3. Provenance bridge write rule (`blueprint_estimate_line_provenance` + `estimate_line_items` transactional contract).
4. Explicit user approval gate.
5. Catalog resolver requirement (material + labor) and pricing boundary.

Phase 7 also resolves the three Phase 6 deviations:

- session-wide `source_draft_hash` must be inside the batch-key inputs.
- `TARGET_ESTIMATE_LOCKED` must map to actual `enhanced_estimates.status` values.
- `EXISTING_LINE_AT_KEY_NEEDS_DECISION` is resolved by the policy in §3.

## 2. Non-goals

Phase 7 does NOT:

- Implement Push to Estimate.
- Write `estimate_line_items`, mutate `enhanced_estimates`, or write `proposal_tier_items`, proposals, work orders, purchase orders, production tasks, or invoices.
- Write `blueprint_estimate_line_provenance`.
- Build a catalog resolver, labor-rate resolver, or pricing engine.
- Enable custom (non-catalog) line approval.
- Add new endpoints, modify document-worker routes, change the worker, or change UI.
- Add new DB columns, new tables, new triggers, or new RLS policies.
- Alter shared TS or Python contracts or JSON schemas.

If any Phase 7 review surfaces a need for schema/migration work, that work is deferred to a Phase 7.5 schema-hardening proposal.

## 3. Live-write preconditions (summary)

A future Phase 8 live write of a single candidate to `estimate_line_items` is allowed only if **all** of these hold for that candidate's batch and row:

1. Auth + tenant resolved server-side; `tenant_id` matches across user, batch, candidate, target estimate, and source draft rows.
2. Target `enhanced_estimates` row exists, belongs to the same `tenant_id`, and its `status` is `can_live_write=true` per the status mapping (§4 of the status-mapping doc).
3. Handoff batch is the most recent non-superseded batch for `(tenant_id, import_session_id, target_enhanced_estimate_id)` and its `source_draft_hash` matches the current session draft hash.
4. Candidate `user_review_status` is in the "approved" terminal state defined by the user approval gate; `handoff_allowed=true`; `blocking_review_flag_ids` is empty.
5. Catalog mode for the batch is satisfied by the candidate (see catalog resolver requirements doc).
6. Pricing mode for the batch is satisfied by the candidate (see §10 below).
7. No deterministic-handoff-key collision exists that is not resolved per the existing-line resolution policy.
8. Approval object (§7) for the batch is complete, signed by an authorized user, and its `deterministic_approval_hash` matches the recomputed hash.
9. Provenance bridge write contract (companion doc) can be satisfied transactionally.

Failure of any precondition emits a blocker code from §11 and prevents the live write.

## 4. Target `enhanced_estimates` status mapping

Full table in [`blueprint-live-handoff-status-mapping.md`](./blueprint-live-handoff-status-mapping.md).

DB evidence (current production statuses observed): `draft`, `sent`, `signed`. The schema's `status` column is plain `text` with no CHECK constraint enumerating the lifecycle, so unknown future values are possible and must be treated conservatively.

Default mapping for Phase 8:

| `enhanced_estimates.status` | `can_preview` | `can_live_write` | Blocker code if blocked |
|---|---|---|---|
| `draft` | yes | **yes** | — |
| `sent` | yes | no | `TARGET_ESTIMATE_SENT` |
| `signed` | yes | no | `TARGET_ESTIMATE_APPROVED` |
| any other value | yes | no | `TARGET_ESTIMATE_STATUS_UNKNOWN` |
| row missing | no | no | `TARGET_ESTIMATE_MISSING` |
| `tenant_id` mismatch | no | no | `TARGET_ESTIMATE_TENANT_MISMATCH` |

Phase 7 recommendation: a Phase 7.5 status-hardening migration should add a CHECK constraint (or enum) on `enhanced_estimates.status` so unknown values cannot silently appear. Phase 7 itself does **not** make that change.

## 5. Existing-line / deterministic-key resolution policy

Full policy in [`blueprint-existing-line-resolution-policy.md`](./blueprint-existing-line-resolution-policy.md).

Phase 7 default policy summary:

- Identical preview/live candidate → **skip**.
- Live line user-edited after handoff → **block** (`EXISTING_LINE_USER_EDITED`).
- Quantity or `formula_inputs` changed → **require user choice** (no silent overwrite).
- Source draft changed → **version / supersede** the prior candidate; live line is not touched without explicit approval.
- Tenant mismatch on any side → **hard block**.
- Live line exists but provenance bridge row missing → **hard block** (`PROVENANCE_BRIDGE_REQUIRED`).
- Destructive overwrite of a live line is never automatic.

## 6. Provenance bridge write rule

Full contract in [`blueprint-provenance-bridge-live-write-contract.md`](./blueprint-provenance-bridge-live-write-contract.md).

Phase 7 invariants:

- `estimate_line_items` insert and `blueprint_estimate_line_provenance` insert MUST occur in one transaction; either both commit or both roll back.
- `blueprint_estimate_line_provenance` is never written during preview.
- Every Blueprint-Importer-originated `estimate_line_items` row MUST have exactly one bridge row.
- `deterministic_handoff_key` is unique per `tenant_id`.
- If bridge guarantee cannot be made for a given candidate, emit `PROVENANCE_BRIDGE_REQUIRED` and block the live write.

## 7. User approval gate

A live write is allowed only after a complete deterministic approval object exists for the batch.

Required approval sequence (must be linear, server-enforced in Phase 8):

1. User selects target `enhanced_estimates`.
2. User generates handoff preview.
3. User reviews material candidates.
4. User reviews labor candidates.
5. User resolves all blocking flags.
6. User acknowledges all non-blocking warnings.
7. User confirms `catalog_mode`.
8. User confirms `pricing_mode`.
9. User confirms `custom_line_mode` (must be `disabled` for MVP — see catalog doc).
10. User confirms included/excluded candidate ids.
11. User confirms quantity basis (preview-derived quantities, not invented).
12. User confirms no final pricing is being invented.
13. User confirms live handoff target id.
14. User performs final explicit Push to Estimate approval.

Required approval object fields (logical; Phase 7 does not create the storage column):

- `approved_by`
- `approved_at`
- `import_session_id`
- `handoff_batch_id`
- `target_enhanced_estimate_id`
- `included_candidate_ids[]`
- `excluded_candidate_ids[]`
- `acknowledged_warning_ids[]`
- `resolved_blocker_ids[]`
- `catalog_mode`
- `pricing_mode`
- `custom_line_mode`
- `deterministic_approval_hash` (SHA-256 over the canonicalized object minus `approved_by`/`approved_at`)
- `approval_statement_version`

Rule: if `deterministic_approval_hash` recomputed at write-time differs from the stored hash, the live write is blocked with `USER_APPROVAL_HASH_MISMATCH`.

## 8. Catalog resolver requirement

Full requirements in [`blueprint-catalog-resolver-requirements.md`](./blueprint-catalog-resolver-requirements.md).

Phase 7 default for MVP live handoff: `catalog_mode = catalog_resolved_only`.

- Material candidates with `catalog_resolution_status != 'resolved'` cannot live-write; preview remains visible.
- Labor candidates with `pricing_status='labor_rate_missing'` (or equivalent) cannot final-price; quantity-only handoff still requires §10 approval.
- `custom_line_mode` is `disabled` for MVP and may be re-considered only in a separate approval cycle.

If no safe resolver exists in the repo today, the catalog doc explicitly recommends a Phase 7.5 catalog resolver schema/contract before any Phase 8 live write.

## 9. `source_draft_hash` requirement

Phase 6 deviation closure. Future Phase 8 deterministic live-handoff batch key inputs MUST include:

- `tenant_id`
- `import_session_id`
- target `enhanced_estimates_id`
- hash of `accepted_trade_ids`
- hash of material draft ids
- hash of labor draft ids
- hash of `template_binding` ids
- `source_draft_hash` (session-wide)
- hash of `user_assumptions`
- `pricing_mode`
- `catalog_mode`
- `custom_line_mode`
- `approval_statement_version`

Rules:

- If `source_draft_hash` changes between preview and Push to Estimate, the prior batch is `superseded` and a fresh preview + approval cycle is required.
- Candidate-level deterministic keys MUST remain stable for unchanged draft rows so duplicate work is not generated.
- Live handoff MUST block with `PREVIEW_BATCH_STALE` if `batches.source_draft_hash` differs from the session's current hash at write-time.

Phase 7 documents this requirement only; no code change.

## 10. Pricing boundary

Default Phase 8 stance: **block live handoff until pricing contract is approved**, unless the existing `enhanced_estimates` / `estimate_line_items` flow demonstrably supports quantity-only draft lines without corrupting proposal totals, profit center, or tier math.

Hard rules:

- Do NOT invent `unit_cost`.
- Do NOT infer `labor_rate_id` or labor rate values.
- Do NOT infer markup, margin, tax, or discount.
- Do NOT convert complexity flags into pricing multipliers.
- Any future pricing values must originate from approved catalog, supplier-catalog, or labor-rate tables for the active tenant.

Evidence collected from `estimate_line_items`: it has `unit_cost`, `extended_cost`, `markup_percent`, `markup_amount`, `total_price`, `material_id`, `labor_rate_id`, and ABC-specific pricing columns. Nullability and whether downstream totals tolerate `NULL` pricing values is **not verified in Phase 7** — Phase 8 readiness requires that verification (see §13).

## 11. Final live-write precondition matrix (blockers)

The following blocker codes are reserved for Phase 8 live-write evaluation. Codes already used by Phase 6 preview are noted.

- `TARGET_ESTIMATE_MISSING`
- `TARGET_ESTIMATE_TENANT_MISMATCH`
- `TARGET_ESTIMATE_LOCKED` *(reserved — currently `enhanced_estimates` has no `locked` status; maps from any future lock semantics)*
- `TARGET_ESTIMATE_SENT`
- `TARGET_ESTIMATE_APPROVED` *(maps from `signed` today)*
- `TARGET_ESTIMATE_ARCHIVED` *(reserved)*
- `TARGET_ESTIMATE_CANCELLED` *(reserved)*
- `TARGET_ESTIMATE_STATUS_UNKNOWN`
- `TARGET_ESTIMATE_TIER_MAPPING_REQUIRED`
- `PREVIEW_BATCH_MISSING`
- `PREVIEW_BATCH_STALE`
- `PREVIEW_BATCH_SUPERSEDED`
- `SOURCE_DRAFT_HASH_CHANGED`
- `CANDIDATE_MISSING`
- `CANDIDATE_SUPERSEDED`
- `CANDIDATE_NOT_USER_APPROVED`
- `CANDIDATE_HANDOFF_NOT_ALLOWED`
- `MISSING_PLAN_PATH`
- `MISSING_SOURCE_MEASUREMENT_IDS`
- `MISSING_SOURCE_DOCUMENT_IDS`
- `MISSING_ACCEPTED_TRADE_ID`
- `WINDOWS_DOORS_STANDALONE_CANDIDATE`
- `FUTURE_SUPPORTED_TRADE_CANDIDATE`
- `UNSUPPORTED_TRADE_CANDIDATE`
- `PAINT_WITHOUT_WALL_SOURCE`
- `UNRESOLVED_BLOCKING_REVIEW_FLAGS`
- `CATALOG_UNRESOLVED_LIVE_HANDOFF` *(Phase 6)*
- `PRICING_REQUIRED_BUT_UNAVAILABLE`
- `FINAL_PRICING_NOT_APPROVED`
- `PROVENANCE_BRIDGE_REQUIRED`
- `EXISTING_LINE_AT_KEY_NEEDS_DECISION`
- `EXISTING_LINE_USER_EDITED`
- `DETERMINISTIC_HANDOFF_KEY_COLLISION`
- `TENANT_MISMATCH`
- `USER_APPROVAL_MISSING`
- `USER_APPROVAL_HASH_MISMATCH`

## 12. Warning matrix

These are non-blocking but MUST be acknowledged in the approval object:

- `FIELD_VERIFICATION_REQUIRED`
- `WALL_IMAGE_OBSTRUCTION_WARNING`
- `WALL_SOFFIT_ASSUMPTION_WARNING`
- `ROOF_PENETRATION_FIELD_VERIFICATION_REQUIRED`
- `CATALOG_UNRESOLVED_PREVIEW_ONLY`
- `QUANTITY_GENERATED_FROM_ASSUMPTION`
- `QUANTITY_GENERATED_FROM_REPORT_WASTE_TABLE`
- `QUANTITY_GENERATED_FROM_FORMULA`
- `COST_UNRESOLVED`
- `LABOR_RATE_MISSING`
- `CUSTOM_LINE_MODE_NOT_ENABLED`
- `LIVE_HANDOFF_REQUIRES_FINAL_APPROVAL`

Origin caveats reinforced by source reports: Roofr's material calculations are explicitly estimates that exclude flat area and require double-checking; EagleView roof waste tables exclude added ridge/hip/valley/starter; EagleView wall reports require field verification and call out image obstructions and soffit assumptions. The corresponding warnings above MUST surface on any candidate whose PlanPath references those sources.

## 13. Phase 8 readiness decision

**Status: blocked — Phase 7.5 required before Phase 8 live-write implementation.**

Blocking gaps:

1. `enhanced_estimates.status` has no CHECK constraint or enum; live-write status mapping is only safe once unknown statuses are structurally prevented. → Phase 7.5 status hardening.
2. No catalog resolver exists. Existing tables (`product_catalog`, `supplier_catalog_items`, `abc_catalog_items`, `material_item_match_rules`, `labor_rates`) cover storage but not the deterministic resolver, ambiguity policy, or inactive-item handling required by §8. → Phase 7.5 catalog resolver contract.
3. Pricing boundary cannot be cleared until `estimate_line_items` NULL-pricing tolerance is verified against the active estimate totals / profit center / tier math. → Phase 7.5 pricing-boundary verification.
4. Approval object has no storage column on `blueprint_estimate_handoff_batches`. Phase 7.5 must decide whether to add a column or persist the approval object in `metadata` with a documented JSON schema.
5. `source_draft_hash` is present on batches but not enforced as part of the deterministic batch key or as a live-write precondition. → Phase 7.5 contract update to `crm-handoff.ts` and matching docs (no live code change in 7.5 either, unless explicitly approved).

Once Phase 7.5 resolves these five items, Phase 8 (live handoff implementation) may be proposed.

## 14. Implementation gaps (Phase 7 view)

- No persisted approval object on handoff batches.
- No deterministic batch key field includes `source_draft_hash`, `pricing_mode`, `catalog_mode`, `custom_line_mode`, `approval_statement_version` simultaneously.
- No status-hardening on `enhanced_estimates.status`.
- No catalog resolver implementation.
- No labor-rate resolver implementation.
- No verified quantity-only pricing path for `estimate_line_items`.
- No UI for the 14-step approval sequence.
- No transactional helper guaranteeing `estimate_line_items` + `blueprint_estimate_line_provenance` are written together.
- No supersede/version semantics on `blueprint_estimate_line_candidates` for source-draft changes.

## 15. Stop conditions

Phase 7 review MUST stop and escalate if any of the following appear in Phase 8 proposals:

- A live write that bypasses the approval object.
- A live write that does not write the provenance bridge in the same transaction.
- Any path that writes `estimate_line_items` without a matching `blueprint_estimate_line_provenance` row.
- Any path that mutates `enhanced_estimates` totals/state outside its documented lifecycle.
- Any path that uses `pricing_mode != quantity_only` without an approved catalog/pricing resolver.
- Any path that resolves `tenant_id` from a client-supplied value.
- Any path that uses service role without an explicit `.eq('tenant_id', resolvedTenantId)` filter.
- Any path that writes the provenance bridge during preview.

## 16. Verification checklist

- [x] Phase 6 docs re-read
- [x] Phase 5.5 docs re-read
- [x] `enhanced_estimates` lifecycle inspected (statuses: `draft`, `sent`, `signed`; no CHECK constraint on `status`)
- [x] `estimate_line_items` columns inspected (pricing columns present; NULL tolerance NOT verified)
- [x] `blueprint_estimate_line_provenance` columns inspected
- [x] Status mapping written → companion doc
- [x] Existing-line resolution policy written → companion doc
- [x] Provenance bridge live-write contract written → companion doc
- [x] User approval gate written → §7
- [x] Catalog resolver requirement written → companion doc
- [x] `source_draft_hash` requirement written → §9
- [x] Pricing boundary written → §10
- [x] Phase 8 readiness decision: **Phase 7.5 required**
- [x] Code changed: no
- [x] DB changed: no
- [x] Endpoint behavior changed: no
- [x] Worker behavior changed: no
- [x] UI changed: no
- [x] Live CRM estimate writes implemented: no
- [x] `estimate_line_items` written: no
- [x] `enhanced_estimates` updated: no
- [x] `proposal_tier_items` written: no
- [x] Push to Estimate enabled: no

## 17. Recommended next phase

**Phase 7.5 — Schema hardening & resolver contracts (docs + minimal migrations only).** Phase 8 live handoff implementation is blocked until Phase 7.5 closes the five gaps in §13.
