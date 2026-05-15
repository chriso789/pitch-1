import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  adminClient,
  createPendingPayoutIfEligible,
  getUserFromRequest,
  syncSubmissionFromJob,
  syncSubmissionFromLead,
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
    const type = body.type;
    const client = adminClient();

    let submissionIds: string[] = [];
    let syncResults: any = null;

    if (type === "lead") {
      if (!body.lead_id) throw new Error("lead_id required");
      syncResults = await syncSubmissionFromLead(client, body.lead_id);
      submissionIds = (syncResults || []).map((r: any) => r.submissionId);
    } else if (type === "job") {
      if (!body.job_id) throw new Error("job_id required");
      syncResults = await syncSubmissionFromJob(client, body.job_id);
      submissionIds = (syncResults || []).map((r: any) => r.submissionId);
    } else if (type === "referral_submission") {
      if (!body.referral_submission_id) throw new Error("referral_submission_id required");
      submissionIds = [body.referral_submission_id];
    } else {
      throw new Error("type must be lead | job | referral_submission");
    }

    // Validate user has access for each submission's tenant.
    const out: any[] = [];
    for (const sid of submissionIds) {
      const { data: sub } = await client
        .from("referral_submissions")
        .select("tenant_id, status, payout_eligible, payout_eligibility_reason")
        .eq("id", sid)
        .maybeSingle();
      if (!sub) continue;
      const ok = await userHasTenantAccess(client, user.id, sub.tenant_id);
      if (!ok) continue;

      const evalRes = await createPendingPayoutIfEligible(client, sid);
      out.push({
        referral_submission_id: sid,
        old_status: syncResults?.find((r: any) => r.submissionId === sid)?.oldStatus ?? sub.status,
        new_status: syncResults?.find((r: any) => r.submissionId === sid)?.newStatus ?? sub.status,
        payout_eligible: evalRes.eligible,
        payout_eligibility_reason: evalRes.reason,
        pending_payout_created: evalRes.pendingPayoutCreated,
      });
    }

    return new Response(JSON.stringify({ success: true, results: out }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
