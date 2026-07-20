// DEPRECATED SHIM — see supabase/functions/qbo-worker/index.ts
//
// This function used to trust `tenant_id` from the request body and write
// directly into qbo_entity_mapping. That was a cross-tenant write hazard.
//
// Behavior now:
//   1. Require an authenticated Bearer token.
//   2. Reject any body-supplied tenant_id / realm_id (returns them in an
//      X-Rejected-Body-Fields response header for observability).
//   3. Forward to qbo-worker with op = "syncProject" (which upserts the
//      QBO Customer + Sub-Customer/Project mapping for the caller's tenant).
//
// The frontend caller expected `{ qbo_customer_id }`; qbo-worker's
// syncProject returns `{ qbo_customer_id, ... }` in its data envelope so
// the response shape is compatible.

import {
  corsHeaders,
  jsonResponse,
  requireAuthedUser,
  stripTenantAndRealm,
  forwardToQboWorker,
  readJsonBody,
} from "../_shared/qbo-shim.ts";

const LEGACY_NAME = "qbo-customer-sync";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAuthedUser(req);
  if (!auth.ok) return auth.res;

  const raw = await readJsonBody(req);
  const { clean, rejected } = stripTenantAndRealm(raw);

  // Legacy contract: { contact_id, tenant_id }. Contact is looked up server-side
  // via the project relationship inside qbo-worker.syncProject, so if caller
  // still hands us a contact_id we ignore it and require a project reference.
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
          "qbo-customer-sync is deprecated. Call qbo-worker with { op: 'syncProject', args: { project_id } } — tenant is derived server-side from the JWT.",
        rejected_fields: rejected,
      },
      400,
      { "X-Rejected-Body-Fields": rejected.join(",") || "" },
    );
  }

  return forwardToQboWorker(
    auth.bearer,
    "syncProject",
    { project_id: projectId },
    LEGACY_NAME,
    rejected,
  );
});
