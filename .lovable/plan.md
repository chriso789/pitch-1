## Audit: current state (what I found)

**Flow today (Push to Supplier):**
`estimate_line_items` → `ProjectMaterialsTab` maps rows to `{item_name, description, quantity, unit, unit_cost, srs_item_code}` → `PushToSupplierDialog` → client builds `srs_order_items` rows → `srs-api-proxy` submits.

**Confirmed defects — every place the selected color can be lost or guessed:**

1. `supabase/functions/resolve-supplier-skus/index.ts` — Jaccard fuzzy match at **score ≥ 0.5** returns an orderable `vendor_sku`. Color is never an input. This alone can order the wrong color.
2. `src/components/orders/PushToSupplierDialog.tsx` `autoFillSrsCatalogSkus` — accepts a catalog hit at **score ≥ 0.72** and writes it as `srs_item_code`. Description-based guessing.
3. `src/components/orders/catalogMatching.ts` — token/synonym scoring used as an authorization path, not a suggestion path.
4. Color is **free text**: `color_specs` is hydrated by string-scanning the item name/notes against `shingleBrandColors.ts`. No manufacturer ID, product-line ID, color ID, profile, dimensions or packaging exist anywhere.
5. `ProjectMaterialsTab` drops color entirely — the item list handed to the dialog has no color field.
6. **Client builds the payload**: the browser inserts `srs_order_items` (`srs_product_id`, `product_option`, `product_color`) and then invokes the proxy. Item code, color, UOM and account are all client-supplied and overridable.
7. Color reaches SRS as a **string** appended to the description plus `product_option`/`product_color` text — not a catalog-resolved variant.
8. No branch/location scoping on any mapping; ABC and SRS codes are stored in the **same** `srs_item_code` field, so a resolution for one supplier is reused for the other.
9. `material_supplier_skus` uniqueness is `(tenant, material, supplier, supplier_item_number)` — it cannot distinguish product line / color / profile / UOM, and has no branch, active-state, effective-dating or approval workflow.
10. No preflight gate, no pre-send resolution preview, no immutable submission snapshot, no response reconciliation.
11. UOM defaults to `'EA'` in `ProjectMaterialsTab`.

## Plan

### Phase A — Canonical identity + mapping model (migration)
New tenant-scoped tables:
- `mfr_manufacturers`, `mfr_product_lines`, `mfr_product_variants` (profile, dimensions, packaging, canonical UOM), `mfr_colors` (manufacturer color code + canonical name, scoped to product line).
- `supplier_item_mappings` — the authoritative mapping. Unique on `(tenant_id, supplier, supplier_connection_id, branch_code, variant_id, color_id, supplier_uom)`. Columns: supplier item number, supplier catalog item id, supplier description/color as returned, status (`active|inactive|discontinued|superseded`), `superseded_by`, `mapping_source` (`api|catalog_import|manual_approved`), approval state + approver, `effective_from/to`, `catalog_fingerprint`, `validated_at`, revision number.
- `supplier_item_mapping_revisions` — history.
- `supplier_order_submissions` — immutable snapshot (selections, resolved codes, mapping revisions, payload, payload hash, idempotency key, redacted response, line results).
RLS: tenant + connection isolation, service_role for edge functions.

### Phase B — Server-side resolver
New route in `supplier-api`: `POST /resolve` taking `{supplier, connection_id, branch_code, lines:[{variant_id, color_id, uom, qty}]}`. Returns exact match or a typed failure: `no_mapping | ambiguous | inactive | uom_mismatch | branch_mismatch | stale_validation`. **No fuzzy path.** Fuzzy scoring is demoted to `POST /suggest` for admin review only. `resolve-supplier-skus` becomes suggestion-only.

### Phase C — Order-line persistence
Material order lines store the full canonical tuple (manufacturer/line/variant/color/UOM/qty) plus the resolved supplier mapping id + revision. Changing supplier, branch, account, color, variant or UOM invalidates the resolution and forces re-resolve. Accessories (ridge cap, drip edge, valley metal, boots, vents, closures, trims) each resolve independently; template color propagation sets the color, never the SKU.

### Phase D — UI
Cascading Manufacturer → Product line → Variant → Color selectors in the material-order page. Per-line resolved supplier item number, supplier description/color, UOM, availability. Pre-send **resolution preview table** (Pitch product / manufacturer / line / color / supplier / item code / supplier description+color / branch / qty / UOM / status). Send disabled until every line is verified.

### Phase E — Preflight gate + server payload build
`POST /orders/preflight` runs all 13 checks; submission refuses unless all lines pass. Payload is assembled server-side from saved validated lines only — the browser cannot supply item code, account, branch, color, UOM, price or validation result. Internal traceability fields persisted alongside the outbound payload.

### Phase F — Reconciliation
After submit, refresh the supplier order, compare returned item codes/qty/UOM/branch against the snapshot, re-query the catalog when the response omits color, and only then mark `verified`.

### Phase G — Tests
Vitest suite covering all 23 listed cases (cross-manufacturer and cross-product-line color collisions, supplier switch invalidation, branch invalidation, field vs ridge cap, template propagation, each blocking failure mode, tenant/connection/location isolation, client payload tampering, stale validation, outbound fixture assertions, idempotency, reconciliation mismatch). GAF Timberline HDZ and OC Duration fixtures built from real sandbox catalog responses only.

### Phase H — Acceptance orders
ABC sandbox order prepared and shown as a resolution table + redacted payload for your approval before any submit. Equivalent controlled SRS test after that. Neither is sent without explicit approval.

## Technical notes
- Fuzzy matching survives only as an admin suggestion surface; it can never authorize a line.
- ABC and SRS codes get separate mapping rows — `srs_item_code` on estimate lines is deprecated to a display-only legacy field.
- Real item numbers are only ever written from live catalog responses or an approved manual mapping; no invented codes in fixtures used for production mappings.

I'd like to start with Phase A + B, since the migration needs your approval anyway and everything else depends on it.
