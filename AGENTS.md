# Architecture Decisions

- Final paid-in-full invoices generate a concise homeowner-facing Work Performed summary through `estimate-scope-narrative`; they never expose raw estimate line items as the invoice description.