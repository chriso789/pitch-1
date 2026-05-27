## Scope (this turn)

Two slices, executed together:

1. **Onboarding email CC — Option B (multi-tenant clean)**
2. **CI/test quality gate** — npm scripts + GitHub Actions workflow

Remaining backend workstreams (canvass-api, billtrust-pricing, api-approve-job-from-lead, document model, OpenAPI) are explicitly **deferred** to subsequent turns in the order you listed.

---

## Part 1 — `companies.support_email` + tenant-scoped CC

### Migration
- `ALTER TABLE public.companies ADD COLUMN support_email text;`
- Add a CHECK that, when not null, matches a basic email regex.
- Backfill: `UPDATE public.companies SET support_email = 'support@obriencontractingusa.com' WHERE <O'Brien company match>;`
  - Need to confirm the match key — most likely `name ILIKE 'O%Brien%'` or a known `id`. Will read `companies` first in build mode to pick the exact predicate, and fall back to a no-op backfill + manual UI update if ambiguous.
- No RLS changes needed (column lives on an already-policied table); existing `authenticated`/`service_role` grants cover it.

### Edge function: `supabase/functions/send-company-onboarding/index.ts`
- Remove the hardcoded `ADMIN_BCC = 'support@obriencontractingusa.com'`.
- Resolve the target tenant (the company being onboarded — already in the payload as `company_id` / similar; verified from current file in build mode).
- Use the service-role client to `select support_email from companies where id = <tenant>` (read-only, single row, scoped by id — safe under service role).
- Build the Resend send call with:
  - `bcc: ['support@pitch-crm.ai']` (platform support, restored)
  - `cc: tenant.support_email ? [tenant.support_email] : []`
- Redeploy `send-company-onboarding`.

### Out of scope for this slice (call out, do not touch)
- `send-account-deactivation` and `send-user-invitation` have the same hardcoded pattern. Will be migrated to the same `companies.support_email` lookup in a follow-up turn — flagged but not changed here, per your "execute the onboarding CC fix" wording.

---

## Part 2 — CI/test quality gate

### `package.json` scripts
Add (without disturbing existing scripts):
- `"typecheck": "tsc --noEmit"`
- `"test": "vitest run"`
- `"test:unit": "vitest run --dir src"`
- `"test:e2e": "vitest run --dir tests/e2e"` (placeholder dir; real Playwright/E2E layer is a later turn)
- Keep existing `lint` / `build`.

### Vitest
- Confirm `vitest` is installed; if not, add `vitest` + `@vitest/ui` + `jsdom` + `@testing-library/react` as devDeps.
- Add a minimal `vitest.config.ts` (jsdom env, path alias `@` matching `vite.config.ts`).
- Add one smoke test under `src/__tests__/smoke.test.ts` so `test` exits 0 on a clean repo and CI has something real to run.

### GitHub Actions: `.github/workflows/ci.yml`
Single workflow, runs on `push` to any branch and on `pull_request`:
- Job `quality`:
  - `actions/checkout@v4`
  - `actions/setup-node@v4` (Node 20, npm cache)
  - `npm ci`
  - `npm run typecheck`
  - `npm run lint` (only if an `lint` script already exists; otherwise skip with a conditional step)
  - `npm run test`
  - `npm run build`
- Fails the PR if any step fails. No deploy steps — deploy stays with Lovable.

### Deno edge-function checks (lightweight, this turn)
- Add a second job `edge-functions-check`:
  - `denoland/setup-deno@v1`
  - `deno check supabase/functions/**/*.ts` (type-check only, no deploy).
- Deno tests via `supabase--test_edge_functions` remain the dev-time path; CI just guards against type regressions for now.

### Out of scope for this slice
- Playwright/browser E2E
- Coverage thresholds / Codecov
- Required-status-check branch protection (must be enabled in GitHub UI by you; I'll note this in the response)

---

## Execution order in build mode

1. Read `supabase/functions/send-company-onboarding/index.ts` and `companies` schema (one parallel batch).
2. Run the `companies.support_email` migration (with O'Brien backfill if a safe predicate exists; otherwise skip backfill and instruct UI update).
3. Edit + redeploy `send-company-onboarding`.
4. Edit `package.json`, add `vitest.config.ts`, add smoke test, add `.github/workflows/ci.yml`.
5. Run `npm run typecheck` + `npm run test` locally to confirm green before handing back.

## Risks / call-outs

- **O'Brien backfill predicate**: if `companies` has multiple O'Brien-like rows or none, I will skip the backfill rather than guess and tell you to set it via the Companies admin UI (one row, one field).
- **Sibling email functions** (`send-account-deactivation`, `send-user-invitation`) still hardcode the platform BCC. Multi-tenant fix will land in a follow-up turn unless you want them folded in now.
- **Branch protection**: the workflow exists after this turn, but GitHub won't *require* it on PRs until you flip "Require status checks to pass" in repo Settings → Branches.
