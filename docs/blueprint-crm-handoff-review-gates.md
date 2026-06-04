# Blueprint Importer v2 — CRM Handoff Review Gates

**Status:** Docs only. Companion to `blueprint-importer-phase-5-crm-handoff-contract.md` and `blueprint-crm-estimate-integration-inventory.md`. Defines the **blocker** and **warning** gate matrices that Phase 6 (handoff preview) and Phase 7 (live CRM estimate write) must enforce. Phase 5 does not implement any of these — it fixes the contract.

Gate severity legend:

- **BLOCK** = candidate cannot be pushed live until resolved.
- **WARN** = candidate may be pushed live, but the warning must be visible in the preview UI and persisted in audit/provenance.

Every gate row carries a stable **machine code** so Phase 6/7 can attach it to `handoff_blockers` / `warning_review_flag_ids` per the handoff contract §4.

---

## 1. Provenance gates

| Code | Severity | Trigger | Resolution |
|---|---|---|---|
| `MISSING_PLAN_PATH` | BLOCK | `plan_path_ids` empty on candidate. | Re-run Phase 4 generation; never bypass. |
| `MISSING_SOURCE_MEASUREMENT_IDS` | BLOCK | `source_measurement_ids` empty. | Re-run Phase 3 measurement extraction. |
| `MISSING_ACCEPTED_TRADE_ID` | BLOCK | Candidate has no `accepted_trade_id`. | User must accept the trade in Phase 3 UI. |
| `MISSING_SOURCE_DOCUMENT_IDS` | BLOCK | PlanPath has no `source_document` step. | Re-run Phase 3; do not synthesize provenance. |
| `PROVENANCE_TENANT_MISMATCH` | BLOCK | Any provenance row's `tenant_id` ≠ session tenant. | Hard fail; investigate before reuse. |

---

## 2. Trade scope gates

| Code | Severity | Trigger | Resolution |
|---|---|---|---|
| `WINDOWS_DOORS_STANDALONE_TRADE` | BLOCK | Candidate's `trade_id = 'windows_doors'` and the trade is treated as standalone. | `windows_doors` is `measurement_object_only` per Phase 0 catalog. Only allowed as a measurement object feeding another trade. |
| `FUTURE_SUPPORTED_TRADE` | BLOCK | Trade marked `future_supported` in trade catalog. | Wait for trade promotion via Phase F* (per phase plan §4). |
| `UNSUPPORTED_TRADE` | BLOCK | Trade not in trade catalog or marked unsupported. | Reject. |
| `PAINT_WITHOUT_SIDING_SOURCE` | BLOCK | `trade_id = 'paint_coatings'` without a valid `exterior_walls_siding` source. | Add siding source upstream; paint is derived. |

---

## 3. Catalog gates

| Code | Severity | Trigger | Resolution |
|---|---|---|---|
| `CATALOG_UNRESOLVED_LIVE_HANDOFF` | BLOCK (Mode A) / WARN (Mode B with user approval) / BLOCK (Mode C / preview-only default) | `catalog_resolution_status = 'unresolved'` and the active catalog mode forbids live write. | Resolve to `materials.id` / `labor_rates.id`, or explicitly choose Mode B per handoff contract §6. |
| `CATALOG_RESOLVED_COST_MISSING` | WARN | Catalog item resolved but `base_cost` null/zero. | User confirms quantity-only handoff, or supplies cost. |
| `CATALOG_TENANT_MISMATCH` | BLOCK | Resolved `materials.tenant_id` / `labor_rates.tenant_id` ≠ session tenant. | Hard fail; never cross-tenant. |
| `CUSTOM_LINE_WITHOUT_USER_APPROVAL` | BLOCK | Mode B candidate without explicit user approval per line. | User must approve each custom line. |
| `CUSTOM_LINE_PROVENANCE_DROPPED` | BLOCK | Mode B candidate missing source draft id, PlanPath, formula key, or warning flags. | Re-derive — never strip provenance to "simplify" a custom line. |

---

## 4. Pricing gates

| Code | Severity | Trigger | Resolution |
|---|---|---|---|
| `PRICING_REQUIRED_BUT_UNAVAILABLE` | BLOCK | Pricing mode requires cost but `pricing_status ∈ { cost_unresolved, labor_rate_missing, catalog_resolved_cost_missing }`. | Resolve catalog/labor rate or switch to `quantity_only` handoff (where allowed). |
| `FINAL_PRICING_NOT_APPROVED` | BLOCK | Candidate flagged as priced but user has not completed the pricing-review step. | User must complete pricing review (Phase 7 only). |
| `LABOR_RATE_LOOKUP_INPUTS_MISSING` | BLOCK | Labor candidate missing `job_type` / `skill_level` / `location_zone` required to look up `labor_rates`. | User must confirm those inputs in Phase 6/7 UI. |
| `INVENTED_PRICING_DETECTED` | BLOCK | Unit cost / labor rate / margin / markup / tax / discount value was not sourced from existing catalog or explicit user entry. | Reject — pricing must be sourced or user-entered, never invented. |
| `COMPLEXITY_MULTIPLIER_AS_PRICE` | BLOCK | Phase 4 complexity multiplier was treated as a price multiplier instead of a quantity/labor-hour modifier. | Reject — pricing contract for multipliers is not yet approved. |

---

## 5. Input/assumption gates

| Code | Severity | Trigger | Resolution |
|---|---|---|---|
| `MISSING_REQUIRED_ASSUMPTION` | BLOCK | Template formula required a tenant/user assumption (e.g. waste %, coverage, paint coats, soffit depth) that is absent. | User supplies the assumption in Phase 6/7 UI. |
| `MISSING_QUANTITY` | BLOCK | Candidate `quantity` is null/NaN. | Re-run Phase 4. |
| `MISSING_UNIT` | BLOCK | Candidate `unit` is empty. | Re-run Phase 4. |
| `QUANTITY_FROM_ASSUMPTION` | WARN | Quantity was generated from a user/template assumption rather than a measured value. | Visible in preview UI; carry in provenance. |
| `QUANTITY_FROM_REPORT_WASTE_TABLE` | WARN | Quantity uses a vendor waste table (e.g. Roofr / EagleView) rather than measured area. | Visible; carry in provenance. |
| `QUANTITY_FROM_FORMULA_OVERRIDES_REPORT` | WARN | Phase 4 formula was used even though the report provided a suggestion that disagrees. | Visible; carry in provenance + diff in preview. |

---

## 6. Trade-specific gates

### 6.1 Roofing

| Code | Severity | Trigger |
|---|---|---|
| `ROOF_PENETRATION_FIELD_VERIFY` | WARN | Vendor report flagged penetrations require field verification. |
| `ROOF_WASTE_EXCLUDES_RIDGE_HIP_VALLEY_STARTER` | WARN | Per EagleView waste-table semantics — waste covers area only; ridge/hip/valley/starter accessory material is additive. |
| `ROOF_FLAT_AREA_EXCLUDED` | WARN | Per Roofr semantics — calculations are based on pitched area; flat area excluded. |

### 6.2 Exterior walls / siding

| Code | Severity | Trigger |
|---|---|---|
| `WALL_IMAGE_OBSTRUCTION` | WARN | Vendor wall report flagged image obstructions over wall planes. |
| `WALL_SOFFIT_ASSUMPTION` | WARN | Soffit depth derived from default rather than measured. |
| `WALL_FIELD_VERIFY_REQUIRED` | WARN | Vendor flagged field verification required for at least one elevation. |

### 6.3 Windows / doors

| Code | Severity | Trigger |
|---|---|---|
| `WINDOWS_DOORS_NOT_A_TRADE` | BLOCK | Attempt to push `windows_doors` as a standalone live estimate trade. |

### 6.4 Paint / coatings

| Code | Severity | Trigger |
|---|---|---|
| `PAINT_REQUIRES_WALL_OR_SIDING_SOURCE` | BLOCK | Paint candidate without valid `exterior_walls_siding` measurement source. |
| `PAINT_COATS_ASSUMED` | WARN | Coat count came from assumption rather than spec/contract input. |

### 6.5 Gutters / fascia / trim

| Code | Severity | Trigger |
|---|---|---|
| `GUTTER_PROFILE_ASSUMED` | WARN | Profile defaulted instead of being user/spec-selected. |
| `EAVES_RAKES_FROM_ROOF_REPORT` | WARN | Linear feet were sourced from the roof report; user should confirm vs. wall report. |

### 6.6 Future / unsupported trades

| Code | Severity | Trigger |
|---|---|---|
| `DRYWALL_FRAMING_MEP_BLOCKED` | BLOCK | Any draft for drywall, framing, insulation, flooring, concrete, electrical, plumbing, or HVAC. |

---

## 7. Target estimate gates

| Code | Severity | Trigger | Resolution |
|---|---|---|---|
| `TARGET_ESTIMATE_NOT_SELECTED` | BLOCK | User has not chosen a target `pipeline_entry_id` / `project_id` / estimate header. | User selects target. |
| `TARGET_ESTIMATE_TENANT_MISMATCH` | BLOCK | `target_estimate.tenant_id` ≠ session tenant. | Hard fail. |
| `TARGET_ESTIMATE_LOCKED` | BLOCK | Target estimate status indicates locked / approved / sent / signed (per existing `estimates.status` enum). | User must clone or version target; never overwrite a sent/signed estimate. |
| `TARGET_HEADER_TABLE_UNDECIDED` | BLOCK | Canonical header (`estimates` vs `enhanced_estimates`) not picked. | Resolved by Phase 5.5. |
| `TARGET_PROVENANCE_SURFACE_MISSING` | BLOCK | Target `estimate_line_items` lacks provenance column / linking table. | Resolved by Phase 5.5 / Phase 6.5 migration. |

---

## 8. Tenant / security gates

| Code | Severity | Trigger |
|---|---|---|
| `TENANT_MISMATCH_CANDIDATE_VS_SESSION` | BLOCK | Candidate `tenant_id` ≠ source session `tenant_id`. |
| `TENANT_FROM_REQUEST_BODY_REJECTED` | BLOCK | Any Phase 6/7 route accepting `tenant_id` from request body instead of resolving via JWT + membership. Enforced at code-review time. |
| `SERVICE_ROLE_WITHOUT_TENANT_FILTER` | BLOCK | Any service-role write that does not include `.eq('tenant_id', resolvedCompanyId)` and an audit log. |
| `AUDIT_EVENT_MISSING` | BLOCK | Lifecycle transition without an `_shared/audit.ts` write. |

---

## 9. Stale / supersession gates

| Code | Severity | Trigger | Resolution |
|---|---|---|---|
| `STALE_IMPORT_SESSION` | BLOCK | Candidate references an `import_session_id` whose status is `superseded` or `cancelled`. | Regenerate from active session. |
| `DRAFT_ROW_SUPERSEDED` | BLOCK | Candidate's `source_draft_line_id` has been superseded by a newer Phase 4 generation. | Regenerate candidate from new draft. |
| `DETERMINISTIC_KEY_COLLISION` | BLOCK | Two distinct candidates resolved to the same `deterministic_handoff_key`. | Investigate Phase 4 generator; never coerce-merge. |
| `EXISTING_LINE_AT_KEY_NEEDS_DECISION` | BLOCK | A live `estimate_line_items` row already exists for the deterministic handoff key. | User must explicitly choose **skip** / **update** / **version** per handoff contract §9.2. |

---

## 10. User approval gates

| Code | Severity | Trigger |
|---|---|---|
| `USER_APPROVAL_PENDING` | BLOCK | Candidate `user_review_status ≠ 'approved'`. |
| `USER_APPROVAL_STALE` | BLOCK | Approval was granted but the candidate inputs changed afterwards (deterministic key drift). |
| `BULK_APPROVAL_WITHOUT_PER_LINE_REVIEW` | BLOCK | Phase 7 attempted bulk write without per-line review trail. |
| `FINAL_PUSH_NOT_INVOKED` | BLOCK | "Push to Estimate" final approval not invoked by an authorized user. |

---

## 11. Aggregate (derived) flags

These are convenience aggregates — they do not introduce new ground truth. If granular flags already explain the blocker (per Phase 4 accepted-deviation rule), aggregate emission is optional.

| Code | Severity | Derivation |
|---|---|---|
| `ANY_BLOCKER_PRESENT` | BLOCK | At least one BLOCK row in §1–§10 is active. |
| `ANY_WARNING_PRESENT` | WARN | At least one WARN row is active. |
| `HANDOFF_READY` | informational | All BLOCK rows resolved **and** user approval granted. |
