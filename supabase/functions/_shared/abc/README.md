# Shared ABC Core (`_shared/abc/`)

Phase 1A of the ABC integration hardening plan. This package is the single
source of truth for reusable ABC business logic that both handlers will
eventually consume:

- `supabase/functions/abc-api-proxy/handler.ts` (legacy — still the
  production execution path for estimates, Push-to-Supplier, order creation,
  settings, template supplier pricing, and scheduled price refreshes)
- `supabase/functions/supplier-api/abc-proxy-handler.ts` (v2 — currently
  driven mostly by the validation/debug tooling)

## Contract

Neither handler imports this package yet. Extraction happens in Phase 1B, and
only after Phase 1C proves byte-for-byte equivalence between the two handlers
against the same authenticated tenant / Ship-To / Branch / request pair.

The modules below were copied **verbatim** from the identical code that
already exists in both handlers. Do not edit them without updating both
handler call sites and re-running Phase 1C equivalence tests.

## Modules

| Status | Module | Responsibility |
| --- | --- | --- |
| ✅ shipped | `env.ts` | ABC OAuth + API base URLs, `Env`, `normalizeEnv`, `AUTH_URLS`, `DEFAULT_SCOPES`, `canonicalRedirectUri()` |
| ✅ shipped | `pkce.ts` | `b64url`, `pkce()` for the OAuth PKCE flow |
| ✅ shipped | `waf.ts` | `detectWaf()` — Imperva/Incapsula challenge detector |
| ✅ shipped | `errors.ts` | `mapAbcError()`, `interpretAbcError()`, `AbcErrorCode` union |
| ✅ shipped | `http.ts` | `callAbc()` — authenticated ABC HTTP client that folds WAF hits into the `499` sentinel |
| ✅ shipped | `types.ts` | `TokenLookup`, `CommonAbcAction`, `CommonProxyRequest`, `AbcPriceLineInput`, `AbcOrderLineInput` |
| ⏳ next | `productNormalizer.ts` | Product API → canonical `AbcCatalogItem` (itemNumber, family, color, valid UOMs) |
| ⏳ next | `familyResolver.ts` | Resolve color-specific `itemNumber` from a base family + color spec |
| ⏳ next | `uomValidator.ts` | Validate requested UOM against Product API result |
| ⏳ next | `branchVerifier.ts` | Confirm Ship-To / Branch pair against `abc_ship_to_accounts` + `abc_account_branches` |
| ⏳ next | `availabilityParser.ts` | Parse `/inventory/v1/...` responses into `AbcAvailabilityRow` |
| ⏳ next | `pricingParser.ts` | Parse `/pricing/v2/prices` into `SupplierPriceState` values (contract-zero vs unpriced) |
| ⏳ next | `mappingResolver.ts` | Resolve `product_option` / `product_color` into ABC `itemNumber` |
| ⏳ next | `orderPayloadBuilder.ts` | Build the ABC `/order/v2/orders` JSON-array payload |

Each `⏳` module ships in its own PR with paired unit tests under
`supabase/functions/_shared/abc/__tests__/`. Handler wiring (Phase 1B) is
deliberately deferred until every `⏳` slot is filled and covered by tests.

## Non-goals

- **No routing changes.** Handlers keep their entry points and their own
  auth/tenant resolution until Phase 1D.
- **No behaviour changes.** Extraction is a pure move-and-import. Any bug
  fix that changes the response shape or error code goes through its own PR
  gated by Phase 1C equivalence tests.
- **Does not touch QXO or SRS.** Scope is ABC only.

## Tests

Unit tests live in `supabase/functions/_shared/abc/__tests__/` and use
Deno's built-in test runner. Run via the `supabase--test_edge_functions`
tool or:

```
deno test --allow-none supabase/functions/_shared/abc
```
