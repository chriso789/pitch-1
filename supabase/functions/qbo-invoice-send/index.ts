// DEPRECATED SHIM — see supabase/functions/qbo-worker/index.ts (op: toggleOnlinePayments)
//
// Original function accepted an `invoice_id` (invoice_ar_mirror row id) plus a
// body `tenant_id`, and used that tenant to open the QBO connection and mutate
// the QBO invoice. That path let a caller flip online-payment flags on another
// tenant's invoice if they knew the mirror row id.
//
// Behavior now:
//   1. Require an authenticated Bearer token.
//   2. Reject body-supplied tenant_id / realm_id.
//   3. Resolve the caller's tenant from the JWT (done inside qbo-worker).
//   4. qbo-worker verifies the QBO invoice is mapped to the caller's tenant
//      before calling QBO. Cross-tenant invoice ids return 404.

import {
  corsHeaders,
  jsonResponse,
  requireAuthedUser,
  stripTenantAndRealm,
  forwardToQboWorker,
  readJsonBody,
} from "../_shared/qbo-shim.ts";

const LEGACY_NAME = "qbo-invoice-send";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAuthedUser(req);
  if (!auth.ok) return auth.res;

  const raw = await readJsonBody(req);
  const { clean, rejected } = stripTenantAndRealm(raw);

  const qboInvoiceId = clean.qbo_invoice_id as string | undefined;
  if (!qboInvoiceId) {
    return jsonResponse(
      {
        ok: false,
        error: "bad_request",
        code: "qbo_invoice_id_required",
        message:
          "qbo-invoice-send is deprecated. Call qbo-worker { op: 'toggleOnlinePayments', args: { qbo_invoice_id, allow_credit_card, allow_ach, send_email } }. Passing a mirror-row `invoice_id` is no longer accepted because it could not be tenant-verified.",
        rejected_fields: rejected,
      },
      400,
      { "X-Rejected-Body-Fields": rejected.join(",") || "" },
    );
  }

  return forwardToQboWorker(
    auth.bearer,
    "toggleOnlinePayments",
    {
      qbo_invoice_id: qboInvoiceId,
      allow_credit_card: clean.allow_credit_card ?? true,
      allow_ach: clean.allow_ach ?? true,
      send_email: clean.send_email ?? false,
    },
    LEGACY_NAME,
    rejected,
  );
});
