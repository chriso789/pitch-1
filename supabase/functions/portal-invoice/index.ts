// Public portal invoice endpoint.
// GET  ?token=... -> resolves the secure token via SECURITY DEFINER RPC and
//                    returns the redacted branded invoice payload.
// POST { token, action: "payment_link_clicked" } -> records the click event
//      and returns the verified hosted URL for external redirect.
// No SMS, no payment processing, no email delivery — Slice A only.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function summarizeUA(ua: string | null): string | null {
  if (!ua) return null;
  return ua.slice(0, 160);
}

function isSafeHttpsUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const allowed = [
      "quickbooks.intuit.com",
      "connect.intuit.com",
      "app.qbo.intuit.com",
      "app.intuit.com",
      "intuit.com",
    ];
    return allowed.some((d) => u.hostname === d || u.hostname.endsWith("." + d));
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const ipRaw = req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? "";
  const ipHash = ipRaw ? await sha256Hex(ipRaw.split(",")[0].trim()) : null;
  const uaSummary = summarizeUA(req.headers.get("user-agent"));

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const token = url.searchParams.get("token");
      if (!token) return json({ ok: false, error: "invalid_token" }, 404);

      const { data, error } = await supabase.rpc("resolve_invoice_portal_token", {
        _token: token,
        _ip_hash: ipHash,
        _user_agent_summary: uaSummary,
      });
      if (error) {
        console.error("resolve_invoice_portal_token error", error);
        return json({ ok: false, error: "invalid_token" }, 404);
      }
      if (!data || (data as { ok?: boolean }).ok !== true) {
        // Uniform response — never leak whether the invoice exists.
        return json({ ok: false, error: "invalid_token" }, 404);
      }
      return json(data, 200);
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const token = typeof body?.token === "string" ? body.token : null;
      const action = typeof body?.action === "string" ? body.action : null;
      if (!token || action !== "payment_link_clicked") {
        return json({ ok: false, error: "invalid_request" }, 400);
      }

      const { data, error } = await supabase.rpc("resolve_invoice_portal_token", {
        _token: token,
        _ip_hash: ipHash,
        _user_agent_summary: uaSummary,
      });
      if (error || !data || (data as { ok?: boolean }).ok !== true) {
        return json({ ok: false, error: "invalid_token" }, 404);
      }
      const payload = data as {
        ok: true;
        tenant?: { id?: string };
        invoice: {
          id: string;
          balance: number | null;
          qbo_status: string | null;
          payment_capability: string;
        };
        token?: { id?: string };
      };

      if (payload.invoice.payment_capability !== "pay_available") {
        return json({ ok: false, error: "link_unavailable" }, 409);
      }

      // Re-fetch the current authoritative link server-side (never trust the
      // link embedded in email; validate freshly on every click).
      const { data: inv, error: invErr } = await supabase
        .from("invoice_ar_mirror")
        .select(
          "id, tenant_id, invoice_link, invoice_link_status, qbo_status, balance",
        )
        .eq("id", payload.invoice.id)
        .maybeSingle();

      if (invErr || !inv) return json({ ok: false, error: "invalid_token" }, 404);
      if (inv.tenant_id !== (payload.tenant?.id ?? inv.tenant_id)) {
        return json({ ok: false, error: "tenant_mismatch" }, 403);
      }
      if (
        inv.invoice_link_status !== "available" ||
        !isSafeHttpsUrl(inv.invoice_link) ||
        Number(inv.balance ?? 0) <= 0 ||
        ["Voided", "Void"].includes(String(inv.qbo_status ?? ""))
      ) {
        return json({ ok: false, error: "link_unavailable" }, 409);
      }

      // Record the click (system actor; RLS allows service_role).
      await supabase.from("customer_invoice_events").insert({
        tenant_id: inv.tenant_id,
        pitch_invoice_id: inv.id,
        portal_token_id: payload.token?.id ?? null,
        event_type: "payment_link_clicked",
        actor_type: "customer",
        metadata: { ip_hash: ipHash, ua: uaSummary },
      });

      return json({ ok: true, redirect_url: inv.invoice_link }, 200);
    }

    return json({ ok: false, error: "method_not_allowed" }, 405);
  } catch (e) {
    console.error("portal-invoice fatal", e);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
