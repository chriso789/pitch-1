## Root cause

The Create Invoice dialog says **"No estimate found. Add line items manually."** even though the project has a valid $13,929.80 estimate in `enhanced_estimates` with full materials/labor line items.

The bug is in the Supabase query filter inside `src/components/estimates/PaymentsTab.tsx`:

```ts
.not('status', 'in', '(void,cancelled,rejected)')
```

`status` on `enhanced_estimates` (and `estimates`) is a Postgres enum `estimate_status`. The valid values are:

```
draft, preview, sent, approved, rejected, expired, signed
```

`'void'` and `'cancelled'` are **not** members of the enum. Postgres rejects the query with:

```
invalid input value for enum estimate_status: "void"
```

PostgREST returns an error, React Query swallows it, `enhancedEstimates` falls back to `[]`, the legacy query also fails for the same reason, and the dialog shows the empty state. The estimate is never read — so the line items, totals, and pricing never populate.

This affects every project, not just the one in the screenshot.

## Fix

Replace the invalid enum values in both queries (lines 78 and 94 of `src/components/estimates/PaymentsTab.tsx`) with the actually-existing values that should exclude an estimate from invoicing:

```ts
.not('status', 'in', '(rejected,expired)')
```

This keeps `draft`, `preview`, `sent`, `approved`, and `signed` eligible — which matches the original intent (skip dead estimates, use the latest live one).

No DB migration, no schema change, no UI change — just two one-line filter fixes. The existing auto-populate logic in `useEffect` (lines 312–349) already handles materials + labor parsing, contract scaling for partial invoices, and selected-line tracking correctly; it simply never gets data today.

## Acceptance

- Open Create Invoice on the project from the screenshot ($13,929.80 contract).
- Dialog shows the 9 material lines + 3 labor lines auto-selected.
- Invoice Total shows $13,929.80 (or the remaining balance if prior payments/invoices exist).
- "No estimate found" empty state only appears when the project genuinely has no eligible estimate.
