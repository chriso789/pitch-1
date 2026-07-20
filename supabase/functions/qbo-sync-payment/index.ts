// DEPRECATED SHIM — see supabase/functions/qbo-worker/index.ts (op: syncPaymentStatus / refreshAr)
//
// Original function accepted { payment_id, tenant_id, realm_id } and used the
// caller-supplied tenant to look up a QBO connection. That let any authenticated
// user pull payment data for another tenant's connection.
//
// Behavior now:
//   1. Require an authenticated Bearer token.
//   2. Reject body-supplied tenant_id / realm_id.
//   3. Forward to qbo-worker with the invoice-based syncPaymentStatus op.
//      Payment-level refresh loops belong to the webhook processor, not to a
//      client-invoked endpoint.

import {
  corsHeaders,
  jsonResponse,
  requireAuthedUser,
  stripTenantAndRealm,
  forwardToQboWorker,
  readJsonBody,
} from "../_shared/qbo-shim.ts";

const LEGACY_NAME = "qbo-sync-payment";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAuthedUser(req);
  if (!auth.ok) return auth.res;

  const raw = await readJsonBody(req);
  const { clean, rejected } = stripTenantAndRealm(raw);

  // Prefer invoice-based refresh via qbo-worker.syncPaymentStatus.
  const qboInvoiceId =
    (clean.qbo_invoice_id as string | undefined) ??
    (clean.invoice_id as string | undefined);

  if (qboInvoiceId) {
    return forwardToQboWorker(
      auth.bearer,
      "syncPaymentStatus",
      { qbo_invoice_id: qboInvoiceId },
      LEGACY_NAME,
      rejected,
    );
  }

  // Fall back to project-level AR refresh (still scoped server-side).
  const projectId = clean.project_id as string | undefined;
  if (projectId) {
    return forwardToQboWorker(
      auth.bearer,
      "refreshAr",
      { project_id: projectId },
      LEGACY_NAME,
      rejected,
    );
  }

  return jsonResponse(
    {
      ok: false,
      error: "bad_request",
      code: "invoice_or_project_required",
      message:
        "qbo-sync-payment is deprecated. Call qbo-worker { op: 'syncPaymentStatus', args: { qbo_invoice_id } } or { op: 'refreshAr', args: { project_id } }.",
      rejected_fields: rejected,
    },
    400,
    { "X-Rejected-Body-Fields": rejected.join(",") || "" },
  );
});
