// Public customer-closeout endpoints keyed by an invoice delivery UUID (opaque capability).
// Review clicks are analytics only — they never feed any reward or qualification logic.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders } from "./router.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function loadDelivery(d: string | null) {
  if (!d || !UUID.test(d)) return null;
  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data } = await service
    .from("invoice_email_deliveries")
    .select("id, tenant_id, project_id, contact_id")
    .eq("id", d)
    .maybeSingle();
  return data ? { service, delivery: data } : null;
}

export async function handleCloseoutView(req: Request) {
  const ctx = await loadDelivery(new URL(req.url).searchParams.get("d"));
  if (!ctx) return json({ ok: false, error: "not_found" }, 404);
  const { service, delivery } = ctx;
  const [{ data: settings }, { data: destinations }, { data: feedback }] = await Promise.all([
    service.from("company_reputation_settings").select("*").eq("tenant_id", delivery.tenant_id).maybeSingle(),
    service
      .from("review_destinations")
      .select("id, platform, label")
      .eq("tenant_id", delivery.tenant_id)
      .eq("active", true)
      .order("sort_order"),
    service.from("closeout_feedback").select("id").eq("delivery_id", delivery.id).maybeSingle(),
  ]);
  const enabled = settings ? settings.enabled && settings.show_on_invoice : true;
  return json({
    ok: true,
    enabled: enabled && ((destinations?.length ?? 0) > 0 || (settings?.feedback_enabled ?? true)),
    headline: settings?.headline ?? "Share your experience",
    message: settings?.message ?? "Your feedback helps other homeowners. We'd appreciate an honest review.",
    feedback_enabled: settings?.feedback_enabled ?? true,
    feedback_submitted: !!feedback,
    destinations: destinations ?? [],
  });
}

// GET /closeout/review?d=<delivery>&r=<destination>  -> logs click, 302 to review site
export async function handleCloseoutReviewClick(req: Request) {
  const params = new URL(req.url).searchParams;
  const ctx = await loadDelivery(params.get("d"));
  const r = params.get("r");
  if (!ctx || !r || !UUID.test(r)) return json({ ok: false, error: "not_found" }, 404);
  const { service, delivery } = ctx;
  const { data: dest } = await service
    .from("review_destinations")
    .select("id, url, platform, active")
    .eq("id", r)
    .eq("tenant_id", delivery.tenant_id)
    .maybeSingle();
  if (!dest?.active) return json({ ok: false, error: "not_found" }, 404);
  await service.from("review_link_clicks").insert({
    tenant_id: delivery.tenant_id,
    destination_id: dest.id,
    delivery_id: delivery.id,
    project_id: delivery.project_id,
    contact_id: delivery.contact_id,
    platform: dest.platform,
    user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300),
  });
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: dest.url } });
}

export async function handleCloseoutFeedback(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const ctx = await loadDelivery(typeof body?.d === "string" ? body.d : null);
  if (!ctx) return json({ ok: false, error: "not_found" }, 404);
  const rating = Number(body.rating);
  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 2000) : null;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return json({ ok: false, error: "invalid_rating" }, 400);
  const { service, delivery } = ctx;
  const { error } = await service.from("closeout_feedback").upsert(
    {
      tenant_id: delivery.tenant_id,
      delivery_id: delivery.id,
      project_id: delivery.project_id,
      contact_id: delivery.contact_id,
      rating,
      comment: comment || null,
    },
    { onConflict: "delivery_id" },
  );
  if (error) return json({ ok: false, error: "save_failed" }, 500);
  return json({ ok: true });
}
