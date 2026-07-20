// DEPRECATED SHIM — see supabase/functions/qbo-worker/index.ts (op: createInvoiceFromEstimates)
//
// Original function trusted `tenant_id` from the request body and queried
// `job_type_qbo_mapping` (which no longer exists). It also fanned out to
// qbo-customer-sync using a service-role Supabase client, which meant
// callers could invoice against another tenant's realm.
//
// Behavior now:
//   1. Require an authenticated Bearer token.
//   2. Reject body-supplied tenant_id / realm_id.
//   3. Forward to qbo-worker (op = "createInvoiceFromEstimates").
//      qbo-worker derives tenant from the JWT, resolves the tenant-scoped
//      active connection, upserts the Customer + Sub-Customer/Job, and
//      writes qbo_entity_mapping + invoice_ar_mirror rows scoped by
//      (tenant_id, qbo_connection_id, realm_id).

import {
  corsHeaders,
  jsonResponse,
  requireAuthedUser,
  stripTenantAndRealm,
  forwardToQboWorker,
  readJsonBody,
} from "../_shared/qbo-shim.ts";

const LEGACY_NAME = "qbo-invoice-create";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAuthedUser(req);
  if (!auth.ok) return auth.res;

  const raw = await readJsonBody(req);
  const { clean, rejected } = stripTenantAndRealm(raw);

  const projectId =
    (clean.project_id as string | undefined) ??
    (clean.projectId as string | undefined) ??
    (clean.job_id as string | undefined);

  if (!projectId) {
    return jsonResponse(
      {
        ok: false,
        error: "bad_request",
        code: "project_id_required",
        message:
          "qbo-invoice-create is deprecated. Call qbo-worker with { op: 'createInvoiceFromEstimates', args: { project_id } }.",
        rejected_fields: rejected,
      },
      400,
      { "X-Rejected-Body-Fields": rejected.join(",") || "" },
    );
  }

  return forwardToQboWorker(
    auth.bearer,
    "createInvoiceFromEstimates",
    { project_id: projectId },
    LEGACY_NAME,
    rejected,
  );
});
