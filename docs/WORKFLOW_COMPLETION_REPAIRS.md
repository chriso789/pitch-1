# Workflow completion repairs

This branch repairs the November 10 audit findings. It does not deploy functions or apply database changes.

## Changed behavior

- Billtrust price sync returns an explicit unavailable error without changing cached prices. A real Billtrust pricing contract is still required; verified supplier integrations/imports remain the source of costs. Historical cache entries require a separate provenance audit before they can be trusted.
- Job financials read the linked project/lead's contract scopes or estimate, project cost ledger, payments, and approved/paid commissions. Amounts aggregate in cents. Missing source data blocks the summary and payment entry. The payment tab uses the persisted payment recorder rather than the simulated credit-card form. This records receipts; it does not charge a card.
- Proposal delivery resolves the linked customer's email and only reports sent after the email service accepts the request. Proposal request/response adapters now match the existing backend; required edge lengths must be supplied instead of assuming zero quantities.
- Portal invitations call the existing invitation service. The server checks company access before creating a portal token; provider failures return errors.
- Client-list SMS and email now call the existing messaging/email services. Drafts survive delivery failures, SMS history reloads from persisted communication records, and the selected company scopes delivery and branding.
- Automation reminders create dated tasks; escalations create manager tasks; document requests send customer emails; company message templates can send email/SMS using linked contact fields. Unsupported or unresolved template tags fail explicitly. Template names must match a company message_templates row. Provider configuration and a company SMS sender are prerequisites.
- Automation claims use one atomic SQL statement with row locks. Only the service role can claim queued runs. Skips/errors cannot report parent success. Existing mismatched task/log field names are corrected. Interrupted running runs are not automatically replayed: inspect provider effects before any manual retry to avoid duplicate sends. This is exclusive dequeueing, not a claim of exactly-once distributed delivery.
- Crew requirements/checklists load for the assigned company/job. Responses persist, proof photos must belong to that assignment, all required checklists participate in completion, and upload failures no longer show success. Legacy assignment-id photo records are normalized to the real job id.
- Permit applications fill mapped AcroForm fields with read-back validation. Checklists are real PDFs and packets are ZIPs containing real attachment bytes. Missing authority templates, field maps, required inputs, or attachments block generation. Product approvals and authority templates must be configured and verified by the company; the repair does not invent those details.
- Reward claims atomically acknowledge sent/delivered rewards owned by the current user/company. They do not authorize a payout. CSV export uses scoped records and escapes spreadsheet formulas.
- npm lockfile and compatible dependency versions restore deterministic installation. Typechecking explicitly checks app and Node projects. CI receives a larger Node heap and runs the isolated workflow regressions.

## Deployment order

1. Review and apply `20261111180000_complete_workflow_operations.sql`. Test on a staging copy first; inspect existing crew photo identifiers and schema before production migration.
2. Deploy modified shared modules and the automation worker, supplier-api/billtrust-pricing shim, generate-proposal, homeowner-portal-invite, send-email, telnyx-send-sms, permit_build_case and permit_generate_documents.
3. Deploy the frontend from the same branch. The crew/automation/reward paths require the new RPCs, so deploy the migration before the frontend/worker.
4. Verify mail/SMS secrets and company senders; configure message templates and authority PDFs/field maps. Run test-tenant acceptance checks for delivery, saved read-back, company switching, required crew proof and real permit files before release.

## Validation and limits

- Clean npm installation succeeded; application production build and explicit app/Node typechecks passed during implementation.
- `npm run test:workflows`: 18 isolated checks pass. These include in-process PostgreSQL migration execution, disjoint automation claims, RPC permissions, company boundaries, proof requirements, multiple checklist completion, idempotent reward claims, valid PDF/ZIP bytes, financial arithmetic/refunds, and rejected provider results. The migration fixture is targeted; it is not a replay of the complete historical production schema.
- Changed edge entrypoints bundle successfully. Full Deno typechecking was blocked by dependency-host/network resolution in this environment; bundling is not equivalent to a Deno typecheck.
- The unit command now separates integration/database/Deno/archive tests from Vitest unit tests and runs the new workflow regressions separately. The offline unit run reports 597 passed, 2 failed, 7 skipped. An isolated checkout of the original base commit, using the same dependencies and offline safeguards, reports the identical result and the same two PDF failures. The full suite is not represented as passing.
- Repository-wide lint fails with the existing large backlog; it is not represented as passing.
- Unit tests now refuse unmocked fetch requests and alias the generated Supabase client to a local-only fixture, preventing the production client URL/key from entering unit tests.
- The broad unit suite was stopped after automatic safety review identified requests to an unverified live Supabase destination. Do not rerun against that live destination without explicit authorization. The isolated workflow suite uses local fixtures/mocked provider responses and does not access live tenants.
- No production migrations, provider deliveries, charges, reward payouts, production database changes, deployment, or merge were performed.
