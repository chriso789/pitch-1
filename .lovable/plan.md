# Edge Function Audit & Consolidation Plan

## Goal
Reduce deployed Supabase Edge Functions from ~499 to under 150 without breaking production. **No deletions in this pass** — audit first, consolidate second, delete only after references are proven dead.

## Phase 1 — Build the Audit (read-only, no code changes)

Produce `/mnt/documents/edge-function-audit.csv` with one row per function with columns:

- `function_name`
- `exists_in_repo` (does `supabase/functions/<name>/index.ts` exist)
- `frontend_refs` (count of `supabase.functions.invoke("name")` + `/functions/v1/name` + hardcoded URLs in `src/`)
- `backend_refs` (count of cross-references from other edge functions)
- `docs_only_refs` (count from `docs/`, `*.md`, `README`)
- `is_public_webhook` (heuristic: no JWT verification, or name contains `webhook`/`inbound`/`callback`)
- `last_modified` (git log)
- `category` (sms, email, measurement, pdf, qbo, qxo, srs, abc, canvass, ai, signature, payments, auth, mobile, misc)
- `recommendation` (KEEP / CONSOLIDATE / DELETE_CANDIDATE / UNKNOWN)
- `target_consolidated_function`
- `referencing_files` (top 5 paths)

Method:
1. `ls supabase/functions/` → master list of repo functions
2. `rg -n 'functions\.invoke\(|/functions/v1/' src/ supabase/functions/ docs/` to build reference index
3. Cross-join with the user-provided deployed list (paste as input)
4. Classify each row by name prefix into category buckets
5. Apply rules:
   - 0 frontend + 0 backend refs + not a webhook → `DELETE_CANDIDATE`
   - Webhook with 0 refs → `UNKNOWN` (needs provider dashboard check)
   - Matches a known duplicate group (sms/email/measurement/pdf/qxo/srs/qbo/signature/ai) → `CONSOLIDATE` with target

## Phase 2 — Output Reports

Three companion files in `/mnt/documents/`:

1. `delete-candidates.md` — functions with **zero references anywhere**, grouped by category, with the exact reference scan output for each. These are safe to delete after a human glance.
2. `consolidation-groups.md` — the 10 duplicate groups from your message, each listing source functions → target consolidated function → which still have live refs.
3. `webhook-risk.md` — every public webhook function (asterisk-*, twilio-*, telnyx-*-webhook, resend-webhook, stripe-*-webhook, docusign-webhook, qbo-webhook-handler, etc.) with a checklist of provider dashboards that must be verified before deletion.

## Phase 3 — Consolidation Skeletons (separate follow-up plan)

For each target consolidated function (`messaging-api`, `email-api`, `measurement-api`, etc.), create the routed-by-action skeleton:

```ts
const { action } = await req.json();
switch (action) {
  case "send_sms": ...
  case "send_blast": ...
}
```

Then migrate frontend `invoke()` call sites one group at a time, leaving the legacy function deployed until refs hit zero, then delete.

**This plan covers Phase 1 + 2 only.** Phase 3 is a separate plan per consolidation group so we don't break working features in one giant patch.

## Out of Scope
- No edge function deletions in this pass
- No frontend rewiring in this pass
- No Supabase dashboard deletions — the `supabase--delete_edge_functions` tool is only invoked after a follow-up plan is approved per group

## Deliverables
- `/mnt/documents/edge-function-audit.csv`
- `/mnt/documents/delete-candidates.md`
- `/mnt/documents/consolidation-groups.md`
- `/mnt/documents/webhook-risk.md`

## Open Questions
1. Do you want me to also pull the **live deployed list** via `supabase` tooling, or should I work from the 499-function list you'll paste/upload? (The repo `supabase/functions/` dir may not match what's actually deployed.)
2. For the `KEEP` set, do you want me to enforce JWT verification audit too, or strictly scope to "is it referenced?"
