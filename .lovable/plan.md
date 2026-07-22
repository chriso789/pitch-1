# Phase 1B — Slice 3B: Production Order Unification

Goal: every production ABC order (`place_order`, `submit_order`) in **both** `abc-api-proxy` and `supplier-api/abc-proxy-handler` flows through
`mappingResolver → orderService.buildAbcOrderPayload → orderPayloadBuilder`. No inline ABC payload construction, no client-trusted supplier identity, no unresolved-price fallbacks, no `body.order` bypass on the tenant path.

## In-scope files

- `supabase/functions/_shared/abc/orderService.ts` — new exported helper `assembleProductionAbcOrder(ctx)` that does the trusted server-side reload + `resolveAbcMapping` per line + calls `buildAbcOrderPayload`. Returns `{ valid, orderRequest, payloadHash, idempotencyKey, lineProofs, warnings, errors }`.
- `supabase/functions/_shared/abc/orderIdempotency.ts` — new small helper: `findExistingAbcOrder(supabase, tenant_id, env, payloadHash|idempotencyKey)` returns prior `abc_orders` row when hash matches.
- `supabase/functions/_shared/abc/pricingFreshness.ts` — new: `loadFreshPricingForLine(...)` reads latest `abc_price_cache` / `supplier_price_history` entry for the (tenant, env, branch, shipTo, itemNumber, uom); rejects with `pricing_expired` when older than the configured TTL (default 24h, overridable via `ABC_PRICING_MAX_AGE_MINUTES`).
- `supabase/functions/abc-api-proxy/handler.ts` — replace the entire `place_order|submit_order` block (lines ~1614–1845) with a thin caller of `assembleProductionAbcOrder` + `callAbc` + persistence.
- `supabase/functions/supplier-api/abc-proxy-handler.ts` — same replacement (lines ~1720–1940).
- `supabase/functions/_shared/abc/__tests__/orderProductionEquivalence.test.ts` — new equivalence tests running the same trusted-reload fixture through both handler modules and asserting identical `orderRequest`, `payloadHash`, `idempotencyKey`, and persistence input.

## Migration (persistence extension only — no schema redesign)

```sql
ALTER TABLE public.abc_orders
  ADD COLUMN IF NOT EXISTS payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS pricing_run_id TEXT,
  ADD COLUMN IF NOT EXISTS mapping_snapshot JSONB DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS abc_orders_tenant_env_idempotency_uniq
  ON public.abc_orders (tenant_id, environment, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.abc_order_lines
  ADD COLUMN IF NOT EXISTS approved_mapping_id TEXT,
  ADD COLUMN IF NOT EXISTS approved_pricing_run_id TEXT,
  ADD COLUMN IF NOT EXISTS line_proof JSONB DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
```

RLS: unchanged — new columns inherit existing `abc_orders` / `abc_order_lines` tenant policies.

## Behaviour changes (production `place_order` / `submit_order`)

1. **`body.order` bypass removed.** If `body.order` is present and the caller is not the master-only sandbox debug route, respond `400 { error: "pre_shaped_order_forbidden" }`. The sandbox `submit_test_order` action keeps its existing single-item shared-builder path (already migrated in Slice 3A).
2. **Trusted server-side reload.** Handler ignores `body.shipToNumber`, `body.branchNumber`, `body.unit_cost`, `body.delivery_address`, `body.customer_name`, `body.jobsite_contact` when building the payload. Everything is reloaded from `abc_connections` (branch, ship-to), `projects` / `contacts` (address, jobsite contact), `template_item_supplier_mappings` (approved ABC mapping), and `abc_price_cache` / `supplier_price_history` (pricing).
3. **Validated address gate.** Reject with `order_address_not_validated` if the reloaded project/property address is missing a validated `validated_addresses` row (or is missing line1/city/state/postal). Sandbox `submit_test_order` retains its fixed demo address.
4. **Approved-mapping gate per line.** For each `body.items[i]`, resolve mapping via `resolveAbcMapping`. Refuse the whole order if any line is not `state === "approved" && canOrder === true` — response `{ error: "line_mapping_not_approved", lineId, reason }`.
5. **Pricing freshness gate.** For each approved line, load latest pricing row from persistence. If the row is older than `ABC_PRICING_MAX_AGE_MINUTES` (default 1440), reject with `pricing_expired` (no silent refresh). If no row exists, `unresolved_sku_pricing`.
6. **No unsafe identifier fallbacks.** `item_name` and `srs_item_code` may not become an ABC `itemNumber` — only `approvedItemNumber` from the resolver. Default `EA` UOM removed; UOM must come from the approved mapping/child.
7. **Multi-line support.** All lines pass through `buildAbcOrderPayload` in one payload. One invalid line blocks the whole order. No partial submissions.
8. **Idempotency.** Before the HTTP call, look up `abc_orders` by `(tenant_id, environment, idempotency_key)`. Return the existing order row (200 with `duplicate: true, existingOrder`) instead of re-submitting.
9. **Persistence.** Extend the existing `abc_orders` insert to write `payload_hash`, `idempotency_key`, `pricing_run_id` (from line proofs when consistent, else null), `mapping_snapshot` (compact snapshot of approved mappings used). Extend `abc_order_lines` insert to write `approved_mapping_id`, `approved_pricing_run_id`, `line_proof` from `lineProofs[i]`.
10. **Equivalence.** Both handlers call `assembleProductionAbcOrder` with the same reload result and produce byte-identical `orderRequest`, `payloadHash`, `idempotencyKey`, and identical persistence input objects.

## Not in this slice (per brief)

- No frontend changes.
- No route cutover.
- No `abc-api-proxy` shim.
- No sandbox helpers removed.
- No pricing/catalog logic changes.

## Deliverables (in the response after execution)

1. Files changed.
2. Legacy code deleted (line ranges).
3. Shared builder integration diff summary.
4. `body.order` removal proof (grep result).
5. Multi-line handling summary.
6. Idempotency implementation summary.
7. Persistence changes summary.
8. Equivalence test results (`deno test`).
9. Any remaining duplicated code with justification.

Approve and I'll execute in this order: migration → shared helpers (`assembleProductionAbcOrder`, `orderIdempotency`, `pricingFreshness`) → handler swaps (abc-api-proxy first, then supplier-api) → equivalence tests → run tests.
