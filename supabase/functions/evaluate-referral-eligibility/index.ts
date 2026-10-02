const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage, x-pitch-tenant, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};
import {
  adminClient,
  createPendingPayoutIfEligible,
  evaluateEligibility,
  getUserFromRequest,
  userHasTenantAccess,
} from "../_shared/referral-automation.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const submissionId = body.referral_submission_id;
    const createPending = body.create_pending_payout === true;
    if (!submissionId) throw new Error("referral_submission_id required");

    const client = adminClient();

    const { data: sub } = await client
      .from("referral_submissions")
      .select("tenant_id")
      .eq("id", submissionId)
      .maybeSingle();
    if (!sub) throw new Error("Submission not found");

    const ok = await userHasTenantAccess(client, user.id, sub.tenant_id);
    if (!ok) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = createPending
      ? await createPendingPayoutIfEligible(client, submissionId)
      : (() => {
          // Pure evaluation, then strip internals.
          return evaluateEligibility(client, submissionId).then((r) => {
            const { submission: _s, settings: _t, ...rest } = r;
            return rest;
          });
        })();

    const finalRes = await result;
    return new Response(JSON.stringify({ success: true, ...finalRes }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
