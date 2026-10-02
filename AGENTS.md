# Architecture Decisions

- Final paid-in-full invoices generate a concise homeowner-facing Work Performed summary through `estimate-scope-narrative`; they never expose raw estimate line items as the invoice description.- Commercial budgets are created only by the `commercial_award_version` RPC from an approved estimate version's snapshot; awards and original budget values are immutable, and later changes must go through budget/change records, never edits to the estimate or originals.
