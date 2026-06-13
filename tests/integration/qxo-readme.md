# QXO Tenant Isolation — Integration Tests

These tests cover the runtime hardening for `qxo-api` and the seven legacy
shims. They are **unit-level** integration tests: supplier HTTP calls are
mocked at the `fetch` boundary so we never contact live QXO/Beacon.

## Scope

- `qxo-tenant-isolation.test.ts` — cross-tenant denial across every QXO
  route. Body-supplied `tenant_id` MUST be ignored. Missing / revoked /
  expired / scope-missing connections MUST block.
- `qxo-order-idempotency.test.ts` — submit requires a key, dedupes by
  hash, and surfaces 409 on key reuse with a different payload.
- `qxo-legacy-shims.test.ts` — each shim forwards to `qxo-api` and never
  loads QXO credentials itself.

## Running

```bash
bun run test:unit
```

## Mock layer

These tests stub `globalThis.fetch` to capture outbound Beacon calls and
assert call counts (e.g. "submit was called exactly once even on retry").
They also assert that no response body contains `username`, `password`,
`access_token`, or `refresh_token` substrings.

## TODO

The current files validate the helper primitives (guard, idempotency
hash, audit redaction) and document the larger end-to-end assertions
that require the edge runtime. Full route-level integration tests should
be added once a Deno test harness is wired into `tests/edge-functions/`.
