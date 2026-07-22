## ABC Catalog Mapping + Color-Specific SKU + Live Pricing UI Fix

Required by ABC Supply integration team. Replaces the placeholder-SKU/"Pending" table on `/supplier-verify/abc` with a real mapping workflow that ties each internal material to an exact ABC `itemNumber` (color-specific), verifies it at the selected branch, selects a valid Product API UOM, then prices via Price Items.

---

### Root causes (traced this turn)

1. `SupplierVerifyPricingPage.tsx` renders rows from `template_items` / `template_item_supplier_mappings` and treats the internal `item_code` (`ATLAS-PINNACLE`, etc.) as if it were the ABC `itemNumber`.
2. "Verify" calls the pricing route with that internal code, so ABC either returns no line or the parser flags it and the row stays generic "Pending".
3. There is no catalog-search / color-picker / branch-verification / UOM-selection step in the UI, so most rows can never legally be priced.
4. `abc-api` typed client still points at the stub for some helpers; production behavior lives in `abc-api-proxy` (`search_products`, `get_item`, `verify_catalog_item`, `price_items`) and the shared `_shared/abc/*` modules.

---

### Deliverables

**1. New mapping workflow UI** (`src/pages/SupplierVerifyPricingPage.tsx` split into a page + components under `src/components/supplier-verify/abc/`):
- Columns: Internal Code, Material, Requested Color, ABC Item, ABC Color, UOM, Branch Status, Live Price, Price Status, Last Checked, Actions.
- Row state machine (replaces "Pending"): `needs_abc_match`, `needs_product_selection`, `needs_color_selection`, `needs_uom_selection`, `needs_branch_verification`, `needs_review`, `approved`, `ready_to_price`, `pricing`, `priced`, `price_unavailable`, `unavailable_at_branch`, `stale_mapping`, `pricing_expired`, `waf_blocked`.
- Per-row actions: **Find ABC Match**, **Change ABC Match**, **Verify at Branch**, **Select UOM**, **Approve Mapping**, **Get Live Price**.

**2. Find ABC Match dialog** (`FindAbcMatchDialog.tsx`):
- Calls `abc-api-proxy` `search_products` with `familyItems=true`, `embed=branches,variations`.
- Renders every color variant as a **separate selectable row** with its own `itemNumber`, description, manufacturer, family, color, valid UOMs, branch availability, active flag.
- User picks the exact color-specific child; dialog then runs `verify_catalog_item` at the selected branch and forces UOM selection if >1 valid UOM (no EA default).
- Approve writes to `template_item_supplier_mappings` with: `supplier='abc'`, `itemNumber`, `itemDescription`, `familyId/familyName`, `colorName/colorCode`, `validUoms`, `selectedUom`, `branchNumber`, `branchVerifiedAt`, `mappingStatus='approved'`, raw catalog snapshot, `approved_by`, `approved_at`.

**3. Pricing wiring**:
- Replace current row-level Verify with a call routed through `abc-api-proxy` `price_items` using only the **approved** `itemNumber` + `selectedUom` + quantity + `shipToNumber` + `branchNumber` from `useAbcSetup`.
- Use `pricingResponseParser` to derive status (`priced`, `zero_price_contact_branch`, `unavailable`, `restricted`, `backorder`, `pricing_rejected`, `item_mismatch`, `uom_mismatch`, `missing_response_line`, `waf_blocked`).
- Persist to `supplier_pricing_runs` + `supplier_price_history` with exact itemNumber/UOM/color/branch/ShipTo/status/raw response.

**4. Refresh All Prices**:
- Only submits rows where `mappingResolver.canPrice === true`.
- Returns `{ requested, priced, skipped, failed, skippedReasons }` and renders the summary ("12 total · 7 priced · 3 need ABC match · 1 needs color · 1 unavailable at branch").

**5. Data cleanup migration**:
- Audit `template_item_supplier_mappings` where `supplier='abc'` AND `supplier_item_number = internal item_code` (and never verified through ABC Product API) → set `mapping_status='needs_review'`, clear `supplier_item_number`, keep internal codes intact.
- Add columns if missing on `template_item_supplier_mappings`: `abc_family_id`, `abc_family_name`, `abc_color_name`, `abc_color_code`, `abc_valid_uoms jsonb`, `abc_selected_uom`, `abc_branch_verified_at`, `abc_catalog_snapshot jsonb`, `mapping_status`.

**6. Tests** (the 25 cases listed in the brief) under `tests/components/supplier-verify/` and `tests/edge-functions/abc/`.

**7. Acceptance proof** doc `docs/abc-catalog-mapping-acceptance.md` with request/response payloads for a color-bearing product (Atlas Pinnacle Pristine — two colors), persisted mapping rows, pricing history rows, and screenshots. Any step blocked by ABC WAF is explicitly flagged, not passed.

---

### Technical scope

- Frontend: `src/pages/SupplierVerifyPricingPage.tsx`, new `src/components/supplier-verify/abc/*` (row, dialog, state chips, summary).
- Shared client: extend `src/lib/abc/abcApi.ts` with `searchProducts`, `getItem`, `verifyCatalogItem`, `priceItems` all routed through `abc-api-proxy` (not the `abc-api` stub).
- Backend: no new edge functions — reuse `abc-api-proxy` actions + `_shared/abc/{productNormalizer,familyColorResolver,uomValidator,branchVerifier,availabilityParser,pricingResponseParser,mappingResolver}`. Add any missing action wiring only if a gap is found while tracing.
- DB: one migration for the mapping-columns + cleanup UPDATE.

### Out of scope
QXO, SRS UI changes, supplier comparison, signed-estimate cost mutation, new price fabrication.

### Acceptance chain (must pass end-to-end)
internal material → ABC family search → color-specific child `itemNumber` → branch verification → Product API UOM → Price Items → visible live price with parsed status.
