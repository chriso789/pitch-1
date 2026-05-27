## Scope (this turn only)

Wire real handlers for `**canvass-api` `/auth` and `/pin/sync**` off the 501 scaffolds, with mobile/offline + tenant-isolation guarantees. Nothing else — `/route/plan`, `/document/sync`, `/estimate/sync` stay 501.

Out of scope (deferred, with a follow-up note added to `.lovable/plan.md`):

- `send-account-deactivation` and `send-user-invitation` still hardcode platform support email — needs the same `tenants.support_email` cleanup we did for onboarding. Logged, not touched.

---

## Part 1 — `/auth` (JWT-trusted identity bootstrap)

The mobile/canvass client today hits `canvass-auth` with an API key + rep email, gets a long-lived `session_token`, and uses it for `pin-sync`. That model is incompatible with the routed function (which already enforces `requireAuth` + `requireTenant`). Migration:

**Behavior**

- `POST /auth` runs behind `requireAuth` + `requireTenant`, so identity comes from the Supabase JWT, not the request body. Any `user_id`/`tenant_id`/`role` in the body is ignored.
- Resolves from trusted server-side data:
  - `user_id` ← JWT `sub`
  - `tenant_id` ← `requireTenant` middleware (membership-based, already in `_shared/router.ts`)
  - `role` + `is_active` ← `profiles` row joined to `user_company_access` for the active tenant
- Returns the bootstrap payload the mobile app needs:
  ```json
  {
    "rep": { "id", "name", "email", "role", "tenant_id", "is_active", "territories": [...] },
    "dispositions": [...],
    "server_time": "<iso>"
  }
  ```
- Rejects with `403 inactive_user` if the user is disabled at the tenant level.
- No new `canvass_sessions` row is minted — the JWT IS the session. `validate_canvass_token` RPC stays in place for the legacy `canvass-pin-sync` shim until callers are flipped, but the new route does not touch it.

**Frontend follow-up (small, in same slice):**

- Update the one mobile call site to call `edgeApi("canvass-api", "/auth", {})` (JWT auto-attached by `supabase.functions.invoke` under the hood). Will grep `canvass-auth` references in `src/` first and migrate them; if the call surface is larger than 2-3 sites, the legacy `canvass-auth` function stays as-is for now and only the new route is wired — flagged in the response.

---

## Part 2 — `/pin/sync` (batched, idempotent, tenant-safe)

Mirrors the legacy `canvass-pin-sync` contract but enforces tenant from JWT and adds idempotency.

**Request shape**

```ts
POST /pin/sync
{
  pins: Array<{
    client_mutation_id: string,   // REQUIRED — UUID from device; idempotency key
    client_created_at: string,    // ISO — device clock (informational, not trusted)
    latitude: number,
    longitude: number,
    address?: { street, city, state, zip },
    property_details?: { homeowner_first_name?, homeowner_last_name?, ... },
    disposition_id?: string,
    notes?: string,
    pin_metadata?: Record<string, unknown>
  }>
}
```

**Server behavior**

1. Auth + tenant resolved by middleware. `tenant_id` from request body — ignored.
2. Zod validation on each pin. Invalid pins → `{ client_mutation_id, ok: false, code: "invalid_pin", details }` in response array; valid pins continue.
3. For each valid pin, idempotency lookup in `canvass_pin_mutations` by `(tenant_id, client_mutation_id)`:
  - **Hit** → return stored `{ contact_id, server_created_at, replayed: true }`. No DB write.
  - **Miss** → insert `contacts` row (tenant-scoped, server-set `tenant_id`, `created_by = userId`), then insert mutation ledger row inside the same transaction. If `disposition_id` provided, validate it belongs to the same `tenant_id` before updating `qualification_status`.
4. Server timestamps preserved: `server_created_at = now()` on contact + ledger; client clock never overwrites.
5. Conflict detection: if a contact with the same `(tenant_id, address_hash)` already exists AND was created by a different `client_mutation_id`, the response includes `code: "address_conflict"` and `existing_contact_id`. Insert is skipped; ledger row is still written pointing at the existing contact so future replays of the same `client_mutation_id` are stable.
6. Response:
  ```json
   {
     "results": [
       { "client_mutation_id": "...", "ok": true, "contact_id": "...", "replayed": false, "server_created_at": "..." },
       { "client_mutation_id": "...", "ok": false, "code": "invalid_pin", "error": "..." }
     ],
     "server_time": "<iso>"
   }
  ```
7. All DB access uses service-role client but with explicit `.eq('tenant_id', resolvedTenantId)` on every read/write. No body-supplied tenant_id, ever.

---

## Part 3 — DB migration (idempotency ledger + safeguards)

```sql
CREATE TABLE IF NOT EXISTS public.canvass_pin_mutations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  client_mutation_id text NOT NULL,
  contact_id uuid,
  result_code text NOT NULL,           -- 'created' | 'address_conflict' | 'invalid'
  result_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_created_at timestamptz,
  server_created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, client_mutation_id)
);

GRANT SELECT ON public.canvass_pin_mutations TO authenticated;
GRANT ALL    ON public.canvass_pin_mutations TO service_role;

ALTER TABLE public.canvass_pin_mutations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read own pin mutations"
  ON public.canvass_pin_mutations FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- No INSERT/UPDATE/DELETE policy → only service_role (edge function) writes.

CREATE INDEX IF NOT EXISTS idx_canvass_pin_mutations_tenant_created
  ON public.canvass_pin_mutations (tenant_id, server_created_at DESC);

NOTIFY pgrst, 'reload schema';
```

If `public.get_user_tenant_id(auth.uid())` doesn't exist in this project under that exact name, the policy will use whatever the existing tenant-resolver SECURITY DEFINER is (verified in build mode before submitting the migration — same one used by other tenant-scoped tables).

---

## Part 4 — Tests (Deno, run via `supabase--test_edge_functions`)

`supabase/functions/canvass-api/index_test.ts` covering:

1. `**/auth` success** — valid JWT returns rep + dispositions + tenant.
2. `**/auth` no token** — 401 `unauthorized`.
3. `**/auth` cross-tenant** — JWT for tenant A never returns tenant B's dispositions/territories.
4. `**/pin/sync` happy path** — 3 valid pins → 3 `ok: true` results, 3 contacts inserted, 3 ledger rows.
5. `**/pin/sync` replay** — same batch posted twice → second response all `replayed: true`, no new contacts.
6. `**/pin/sync` tenant isolation** — pin batch from tenant A user cannot read/overwrite tenant B's contact rows; body-supplied `tenant_id` ignored.
7. `**/pin/sync` invalid payload** — missing `client_mutation_id` / bad lat/lng → per-pin `ok: false, code: "invalid_pin"`; other valid pins still succeed.
8. `**/pin/sync` disposition cross-tenant** — `disposition_id` from another tenant → pin succeeds but disposition update is skipped with `code: "disposition_rejected"` on the result.

---

## Part 5 — Deploy + follow-up note

- Redeploy ONLY `canvass-api` via `supabase--deploy_edge_functions`.
- Legacy `canvass-auth` and `canvass-pin-sync` standalone functions remain untouched this turn (still receive existing mobile traffic). Migration of frontend callers + replacing them with shims is a follow-up slice — flagged in `.lovable/plan.md`.
- Append to `.lovable/plan.md`:
  > **Follow-up — tenant support email cleanup:** `send-account-deactivation` and `send-user-invitation` still hardcode `support@pitch-crm.ai` (or O'Brien). Migrate to the same `tenants.support_email` lookup used by `send-company-onboarding` in a later slice.

---

## Execution order in build mode

1. Read `_shared/router.ts` `requireAuth`/`requireTenant`/`jsonOk`/`jsonErr` signatures (already in context); confirm exact tenant-resolver function name in `_shared/tenant.ts` and existing RLS helper used elsewhere.
2. Run migration for `canvass_pin_mutations`.
3. Implement `/auth` and `/pin/sync` handlers in `supabase/functions/canvass-api/` (split into `auth.ts` + `pin-sync.ts` modules, wired from `index.ts`).
4. Write `index_test.ts` for the 8 test cases.
5. `supabase--deploy_edge_functions(["canvass-api"])` → `supabase--test_edge_functions(["canvass-api"])`.
6. Update `.lovable/plan.md` with the follow-up note.

## Risks

- **Existing mobile clients still call legacy `canvass-auth` / `canvass-pin-sync**` with the session-token model. They will keep working — we are NOT deleting those functions this turn. The new routed `/auth` + `/pin/sync` are additive and depend on a real Supabase JWT, which the mobile app must hold for any other CRM call anyway.
- **Tenant-resolver function name** — if the project doesn't have `get_user_tenant_id(auth.uid())` under that exact name, I'll use the resolver other tenant-scoped policies in this repo use (verified at migration time, not guessed).
- `**address_hash**` — used for conflict detection. If `contacts` doesn't have it indexed, conflict detection falls back to `(tenant_id, latitude, longitude)` within a small tolerance. Will check the existing `contacts` schema before committing the conflict logic.  
  
Yes — that is exactly where this is heading, and you should make that **explicit in the roadmap** now:
  **Final goal:** Pitch should generate its own roof/wall measurements and reports so contractors do **not** need to order GAF Measure, Roofr, Hover, EagleView, or similar reports for normal estimating workflows.
  But don’t mix that into this canvass-api slice. The uploaded Lovable plan is for `/auth` and `/pin/sync` only, and it correctly says nothing else should be touched this turn.
  Add this to `.lovable/plan.md` as a future strategic milestone:
  ```

  ```
  ```
  Strategic milestone — Native Pitch Measurement Engine

  Final product goal:
  Pitch CRM should eventually eliminate the need for third-party measurement report orders such as GAF Measure, Roofr, Hover, EagleView, and similar paid report providers for standard roofing, siding, window, and exterior estimating workflows.

  Target capability:
  - User enters an address or drops a pin from canvass/mobile.
  - Pitch pulls available aerial/satellite imagery, parcel/property data, permit/property metadata, and prior internal project data.
  - Pitch generates roof and wall measurements internally:
    - roof area
    - facets
    - pitch
    - eaves
    - rakes
    - ridges
    - hips
    - valleys
    - flashing
    - penetrations
    - wall area
    - windows/doors where applicable
  - Pitch produces a contractor-ready report with measurements, diagrams, estimate-ready quantities, waste calculations, and confidence scoring.
  - Paid vendor reports remain optional fallback/verification sources, not required primary workflow.

  Architecture direction:
  - Existing vendor reports should be used as training/validation data.
  - Store parsed Roofr/EagleView/Hover/GAF measurements as normalized ground-truth records.
  - Use them to train and validate Pitch’s internal measurement engine.
  - Every generated internal report must include confidence score, image source, measurement source, and field-verification warnings.
  - Customer-facing reports should only be released once topology, DSM/imagery metadata, and measurement confidence pass validation thresholds.

  Do not combine this with canvass-api /auth or /pin/sync.
  This is a later AI measurement/product milestone.
  ```
  For the current Lovable plan, I would respond:
  ```

  ```
  ```
  Approve the canvass-api /auth and /pin/sync plan as written, with one addition only:

  Add a follow-up note to .lovable/plan.md for the long-term Native Pitch Measurement Engine goal: eliminating the need for GAF Measure, Roofr, Hover, EagleView, and similar paid measurement report orders for normal estimating workflows.

  Do not implement any measurement-engine changes in this canvass-api slice. Keep this turn limited to:
  - /auth
  - /pin/sync
  - canvass_pin_mutations migration
  - tests
  - deploy canvass-api only
  ```
  Strong opinion: this is the correct business direction. Third-party measurement reports are a margin leak. Pitch should eventually turn those into **training data**, not a permanent dependency.