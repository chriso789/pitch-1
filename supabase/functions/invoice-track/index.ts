// Public invoice email tracking (read receipts).
// GET ?d=<delivery_id>&k=open  -> 1x1 pixel, records "invoice_viewed" (email opened)
// GET ?d=<delivery_id>&k=pdf   -> records "invoice_viewed" (link clicked), redirects to a fresh PDF link
// GET ?d=<delivery_id>&k=pay   -> records "payment_link_clicked", redirects to the QuickBooks payment link
// The first open notifies the rep assigned to the project.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PIXEL = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (c) => c.charCodeAt(0),
);
const pixel = () =>
  new Response(PIXEL, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
  });
const text = (msg: string, status = 404) =>
  new Response(msg, { status, headers: { "Content-Type": "text/plain" } });

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const d = url.searchParams.get("d") ?? "";
  const k = url.searchParams.get("k") ?? "open";
  if (!UUID_RE.test(d) || !["open", "pdf", "pay"].includes(k)) {
    return k === "open" ? pixel() : text("Link not found");
  }

  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: delivery } = await service
    .from("invoice_email_deliveries")
    .select("id, tenant_id, project_id, pitch_invoice_id, contact_id, recipient_email")
    .eq("id", d)
    .maybeSingle();
  if (!delivery) return k === "open" ? pixel() : text("Link not found");

  const { data: invoice } = await service
    .from("project_invoices")
    .select("id, tenant_id, pipeline_entry_id, invoice_number")
    .eq("id", delivery.pitch_invoice_id)
    .eq("tenant_id", delivery.tenant_id)
    .maybeSingle();

  // Was this already opened before? (only notify on first open)
  const { count: priorViews } = await service
    .from("customer_invoice_events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", delivery.tenant_id)
    .eq("pitch_invoice_id", delivery.pitch_invoice_id)
    .in("event_type", ["invoice_viewed", "payment_link_clicked"])
    .contains("metadata", { delivery_id: delivery.id });

  await service.from("customer_invoice_events").insert({
    tenant_id: delivery.tenant_id,
    project_id: delivery.project_id,
    pitch_invoice_id: delivery.pitch_invoice_id,
    contact_id: delivery.contact_id,
    event_type: k === "pay" ? "payment_link_clicked" : "invoice_viewed",
    actor_type: "customer",
    delivery_provider: "resend",
    metadata: {
      delivery_id: delivery.id,
      source: k === "open" ? "email_open" : k === "pdf" ? "pdf_link" : "payment_link",
      recipient: delivery.recipient_email,
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 160),
    },
  });

  if (!priorViews && invoice) {
    const { data: pe } = await service
      .from("pipeline_entries")
      .select("assigned_to")
      .eq("id", invoice.pipeline_entry_id)
      .eq("tenant_id", delivery.tenant_id)
      .maybeSingle();
    const uid = (pe as any)?.assigned_to;
    if (uid) {
      await service.from("user_notifications").insert({
        user_id: uid,
        tenant_id: delivery.tenant_id,
        type: "invoice_viewed",
        title: "Invoice opened",
        message: `${delivery.recipient_email} opened invoice ${invoice.invoice_number}.`,
        icon: "eye",
        metadata: { pitch_invoice_id: invoice.id, pipeline_entry_id: invoice.pipeline_entry_id, delivery_id: delivery.id },
        is_read: false,
      }).then(() => {}, (e: unknown) => console.error("[invoice-track] notify failed", e));
    }
  }

  if (k === "open") return pixel();
  if (!invoice) return text("Invoice not found");

  if (k === "pay") {
    const { data: mirror } = await service
      .from("invoice_ar_mirror")
      .select("invoice_link, invoice_link_status, qbo_status")
      .eq("tenant_id", delivery.tenant_id)
      .eq("project_id", invoice.pipeline_entry_id)
      .eq("doc_number", invoice.invoice_number)
      .maybeSingle();
    const link = (mirror as any)?.invoice_link as string | undefined;
    if (link && (mirror as any).invoice_link_status === "available" && link.startsWith("https://")) {
      return Response.redirect(link, 302);
    }
  }

  const safeNumber = String(invoice.invoice_number).replace(/[^A-Za-z0-9_-]/g, "_");
  const { data: signed } = await service.storage
    .from("documents")
    .createSignedUrl(`${delivery.tenant_id}/${invoice.pipeline_entry_id}/invoices/${safeNumber}.pdf`, 60 * 60);
  if (!signed?.signedUrl) return text("Invoice PDF is not available. Please contact the sender.");
  return Response.redirect(signed.signedUrl, 302);
});
