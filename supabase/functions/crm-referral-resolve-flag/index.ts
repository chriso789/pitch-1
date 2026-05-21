import { corsHeaders, json, requireUser, svcClient, assertTenantAccess } from "../_shared/crm-referral.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const { userId, sb: usb, error } = await requireUser(req);
  if (error) return error;
  try {
    const { flag_id, resolution_notes, status = "resolved" } = await req.json();
    if (!flag_id) return json({ error: "flag_id required" }, 400);
    const sb = svcClient();
    const { data: f, error: e1 } = await sb.from("crm_referral_flags").select("*").eq("id", flag_id).single();
    if (e1) throw e1;
    if (!(await assertTenantAccess(usb!, f.tenant_id))) return json({ error: "Forbidden" }, 403);

    const { data, error: e2 } = await sb.from("crm_referral_flags").update({
      status, resolved_by: userId, resolved_at: new Date().toISOString(),
      resolution_notes: resolution_notes || null,
    }).eq("id", flag_id).select().single();
    if (e2) throw e2;
    return json({ success: true, flag: data });
  } catch (e) {
    console.error(e); return json({ error: (e as Error).message }, 500);
  }
});
