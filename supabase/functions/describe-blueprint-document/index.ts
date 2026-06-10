// Generates an AI plain-language description of a blueprint document and per-page
// AI summaries (including a scale guess) using the Lovable AI Gateway.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization") || "";
    const { data: userData, error: uErr } = await svc.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (uErr || !userData?.user) return json({ ok: false, error: "unauthorized" }, 401);

    const { document_id } = await req.json().catch(() => ({}));
    if (!document_id) return json({ ok: false, error: "document_id required" }, 400);

    const { data: doc, error: docErr } = await svc
      .from("plan_documents").select("*").eq("id", document_id).maybeSingle();
    if (docErr) throw docErr;
    if (!doc) return json({ ok: false, error: "not_found" }, 404);

    const { data: access } = await svc
      .from("user_company_access").select("tenant_id")
      .eq("user_id", userData.user.id).eq("tenant_id", doc.tenant_id).maybeSingle();
    const { data: prof } = await svc
      .from("profiles").select("tenant_id,active_tenant_id").eq("id", userData.user.id).maybeSingle();
    const hasAccess = access ||
      prof?.tenant_id === doc.tenant_id || prof?.active_tenant_id === doc.tenant_id;
    if (!hasAccess) return json({ ok: false, error: "forbidden" }, 403);

    const { data: pages, error: pErr } = await svc
      .from("plan_pages")
      .select("id,page_number,page_type,sheet_number,sheet_name,page_title,scale_text,raw_text")
      .eq("document_id", document_id).eq("tenant_id", doc.tenant_id)
      .order("page_number");
    if (pErr) throw pErr;

    const pageSummaries = (pages || []).map((p) => ({
      page_number: p.page_number,
      page_type: p.page_type,
      sheet: p.sheet_number || p.sheet_name || "",
      title: p.page_title || "",
      scale: p.scale_text || "",
      excerpt: (p.raw_text || "").slice(0, 1200),
    }));

    const sys =
      "You are an expert construction estimator reading a set of building blueprint pages. " +
      "Return ONLY valid JSON matching the schema. Be concise, factual, and helpful. " +
      "Do not invent measurements that are not present in the excerpts.";

    const subtypeEnum = [
      "architectural", "interior_framing", "structural_framing", "drywall",
      "interior_finishes", "rcp_ceiling", "flashing", "stucco", "siding",
      "roofing", "waterproofing", "insulation", "millwork", "casework",
      "door_schedule", "window_schedule", "mechanical", "electrical",
      "plumbing", "fire_protection", "civil", "landscape", "demolition",
    ];

    const userPrompt = JSON.stringify({
      file_name: doc.file_name,
      property_address: doc.property_address,
      pages: pageSummaries,
      schema: {
        document_summary:
          "2-4 sentence plain-English description of what this blueprint set covers (project type, scope, notable trades).",
        trades_present: "string[] of trades present (roofing, framing, electrical, plumbing, hvac, etc.)",
        pages: `[{ page_number, ai_summary (1-2 sentence purpose of the sheet), scale (e.g. '1/4" = 1\\'-0"' or empty if unknown), page_title (best human-readable title), page_subtype (one of: ${subtypeEnum.join(", ")} or empty) }]`,
      },
    });

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (aiRes.status === 429) return json({ ok: false, error: "rate_limited" }, 429);
    if (aiRes.status === 402) return json({ ok: false, error: "credits_required" }, 402);
    if (!aiRes.ok) {
      const t = await aiRes.text();
      throw new Error(`ai_gateway_${aiRes.status}: ${t.slice(0, 300)}`);
    }
    const aiJson = await aiRes.json();
    const raw = aiJson?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { parsed = { document_summary: String(raw).slice(0, 1200) }; }

    const documentSummary = String(parsed.document_summary || "").slice(0, 4000);
    const trades = Array.isArray(parsed.trades_present) ? parsed.trades_present.slice(0, 20) : [];

    const metadata = {
      ...((doc.metadata as Record<string, unknown> | null) || {}),
      ai_description: documentSummary,
      ai_trades_present: trades,
      ai_described_at: new Date().toISOString(),
    };
    await svc.from("plan_documents").update({ metadata })
      .eq("id", document_id).eq("tenant_id", doc.tenant_id);

    const aiPages: any[] = Array.isArray(parsed.pages) ? parsed.pages : [];
    let updated = 0;
    for (const ap of aiPages) {
      const pn = Number(ap?.page_number);
      if (!Number.isFinite(pn)) continue;
      const match = (pages || []).find((p) => p.page_number === pn);
      if (!match) continue;
      const patch: Record<string, unknown> = {};
      if (typeof ap.ai_summary === "string" && ap.ai_summary.trim()) {
        patch.ai_summary = ap.ai_summary.slice(0, 1500);
      }
      if (typeof ap.scale === "string" && ap.scale.trim() && !match.scale_text) {
        patch.scale_text = ap.scale.slice(0, 80);
        patch.scale_source = "ai";
      }
      if (typeof ap.page_title === "string" && ap.page_title.trim() && !match.page_title) {
        patch.page_title = ap.page_title.slice(0, 240);
      }
      if (typeof ap.page_subtype === "string" && subtypeEnum.includes(ap.page_subtype)) {
        // Only write when we don't already have a more specific one.
        patch.page_subtype = ap.page_subtype;
      }
      if (Object.keys(patch).length) {
        await svc.from("plan_pages").update(patch)
          .eq("id", match.id).eq("tenant_id", doc.tenant_id);
        updated += 1;
      }
    }


    return json({
      ok: true,
      document_summary: documentSummary,
      trades_present: trades,
      pages_updated: updated,
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
