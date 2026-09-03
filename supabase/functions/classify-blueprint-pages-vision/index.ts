// Vision fallback for image-only or low-text blueprint pages.
// Classifies the sheet and extracts only information explicitly visible on the
// drawing: trades, material/spec references, named manufacturers/products,
// scales, pitches, and dimension/quantity callouts. It does not infer brands or scope.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";
const REVIEW_FLOOR = 0.62;

const TOOL = {
  type: "function" as const,
  function: {
    name: "extract_blueprint_sheet",
    description: "Extract only information explicitly visible on one architectural/construction drawing sheet.",
    parameters: {
      type: "object",
      properties: {
        page_type: {
          type: "string",
          enum: ["roof_plan", "framing_plan", "detail_sheet", "specification_sheet", "section_sheet", "schedule_sheet", "cover_sheet", "irrelevant", "unknown"],
        },
        page_subtype: { type: ["string", "null"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        sheet_number: { type: ["string", "null"] },
        sheet_name: { type: ["string", "null"] },
        scale_text: { type: ["string", "null"] },
        pitches: { type: "array", items: { type: "string" } },
        trades: {
          type: "array",
          items: {
            type: "object",
            properties: {
              trade: { type: "string" },
              scope_notes: { type: "string" },
              evidence: { type: "string" },
            },
            required: ["trade", "scope_notes", "evidence"],
            additionalProperties: false,
          },
        },
        measurements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              trade: { type: ["string", "null"] },
              label: { type: "string" },
              value_text: { type: "string" },
              normalized_quantity: { type: ["number", "null"] },
              unit: { type: "string", enum: ["sqft", "lf", "count", "pitch_ratio", "degrees", "percent", "ratio", "unknown"] },
              measurement_type: { type: "string" },
              evidence: { type: "string" },
            },
            required: ["trade", "label", "value_text", "normalized_quantity", "unit", "measurement_type", "evidence"],
            additionalProperties: false,
          },
        },
        materials: {
          type: "array",
          items: {
            type: "object",
            properties: {
              trade: { type: "string" },
              material: { type: "string" },
              specification: { type: ["string", "null"] },
              manufacturer: { type: ["string", "null"] },
              product: { type: ["string", "null"] },
              brand_explicit: { type: "boolean" },
              evidence: { type: "string" },
            },
            required: ["trade", "material", "specification", "manufacturer", "product", "brand_explicit", "evidence"],
            additionalProperties: false,
          },
        },
        review_flags: { type: "array", items: { type: "string" } },
      },
      required: ["page_type", "page_subtype", "confidence", "sheet_number", "sheet_name", "scale_text", "pitches", "trades", "measurements", "materials", "review_flags"],
      additionalProperties: false,
    },
  },
};

function mergeMetadata(previous: unknown, extraction: any) {
  const base = previous && typeof previous === "object" && !Array.isArray(previous) ? previous as Record<string, unknown> : {};
  return {
    ...base,
    source_mode: "vision",
    vision_extraction_version: "v1.2.0",
    vision_extracted_at: new Date().toISOString(),
    vision: extraction,
    pitches: extraction.pitches || [],
    scale_text: extraction.scale_text ?? (base as any).scale_text ?? null,
  };
}

async function callVision(imageUrl: string, pageNumber: number) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");
  const response = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: [
            "You are a construction blueprint extraction engine.",
            "Read only what is explicitly visible on this single sheet.",
            "Never invent a manufacturer, brand, product, dimension, material, trade, or calculated takeoff quantity.",
            "A design firm, engineer, architect, owner, or contractor name is NOT a material manufacturer unless the drawing explicitly identifies it as a product manufacturer.",
            "Capture explicit dimension and quantity callouts exactly in value_text.",
            "Set normalized_quantity only when the displayed value can be converted without assumptions. Use unit sqft for square feet, lf for linear feet, count for explicit counts, pitch_ratio for pitch values, degrees/percent/ratio when explicit, otherwise unknown.",
            "Do not calculate area from width x height here; preserve those component dimensions separately unless the sheet explicitly gives area.",
            "For each measurement, assign the trade only when the sheet clearly associates that measurement with a trade; otherwise set trade to null.",
            "Capture every clearly documented trade and material/spec on the sheet, including demolition work.",
            "If a brand/product is not explicitly printed, manufacturer and product must be null and brand_explicit false.",
            "For schedules and dense details, prioritize accuracy over brevity and capture repeated schedule quantities when explicitly stated.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Analyze blueprint PDF page ${pageNumber}. Return the structured extraction via the tool only.` },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      tools: [TOOL],
      tool_choice: { type: "function", function: { name: "extract_blueprint_sheet" } },
    }),
  });
  if (!response.ok) throw new Error(`AI gateway ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const payload = await response.json();
  const args = payload.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("vision tool output missing");
  return typeof args === "string" ? JSON.parse(args) : args;
}

function chainInternal(functionName: string, body: Record<string, unknown>) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return fetch(`${url}/functions/v1/${functionName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify(body),
  }).catch((e) => console.error(`${functionName} chain failed`, e));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const auth = req.headers.get("Authorization") || "";
    const jwt = auth.replace("Bearer ", "");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let userId: string | null = null;
    if (jwt && jwt !== serviceKey) {
      const { data } = await svc.auth.getUser(jwt);
      userId = data?.user?.id ?? null;
      if (!userId) return json({ ok: false, error: "unauthorized" }, 401);
    }

    const { document_id, page_id, force = false } = await req.json().catch(() => ({}));
    if (!document_id && !page_id) return json({ ok: false, error: "document_id or page_id required" }, 400);

    let doc: any = null;
    if (document_id) {
      const { data, error } = await svc.from("plan_documents").select("id,tenant_id").eq("id", document_id).maybeSingle();
      if (error) throw error;
      doc = data;
    } else {
      const { data, error } = await svc.from("plan_pages").select("document_id,tenant_id").eq("id", page_id).maybeSingle();
      if (error) throw error;
      if (data) doc = { id: data.document_id, tenant_id: data.tenant_id };
    }
    if (!doc) return json({ ok: false, error: "not_found" }, 404);

    if (userId) {
      const [{ data: access }, { data: prof }] = await Promise.all([
        svc.from("user_company_access").select("tenant_id").eq("user_id", userId).eq("tenant_id", doc.tenant_id).maybeSingle(),
        svc.from("profiles").select("tenant_id,active_tenant_id").eq("id", userId).maybeSingle(),
      ]);
      if (!(access || prof?.tenant_id === doc.tenant_id || prof?.active_tenant_id === doc.tenant_id)) return json({ ok: false, error: "forbidden" }, 403);
    }

    let q = svc.from("plan_pages")
      .select("id,page_number,image_path,raw_text,page_type,page_type_confidence,metadata")
      .eq("document_id", doc.id)
      .eq("tenant_id", doc.tenant_id)
      .order("page_number");
    if (page_id) q = q.eq("id", page_id);
    const { data: pages, error: pErr } = await q;
    if (pErr) throw pErr;

    const results: any[] = [];
    let reviewCount = 0;
    for (const page of pages || []) {
      const sparseText = String(page.raw_text || "").replace(/\s+/g, "").length < 80;
      const needsVision = force || sparseText || !page.page_type || page.page_type === "unknown" || Number(page.page_type_confidence || 0) < REVIEW_FLOOR;
      if (!needsVision) {
        results.push({ page_number: page.page_number, skipped: true, reason: "deterministic_confident" });
        continue;
      }
      if (!page.image_path) {
        reviewCount += 1;
        results.push({ page_number: page.page_number, error: "missing_image_path" });
        continue;
      }

      try {
        const { data: signed, error: sErr } = await svc.storage.from("blueprint-pages").createSignedUrl(page.image_path, 900);
        if (sErr || !signed?.signedUrl) throw sErr || new Error("signed URL missing");
        const extraction = await callVision(signed.signedUrl, page.page_number);
        const confidence = Math.max(0, Math.min(1, Number(extraction.confidence || 0)));
        const review = confidence < REVIEW_FLOOR || (extraction.review_flags || []).length > 0;
        if (review) reviewCount += 1;

        const metadata = mergeMetadata(page.metadata, extraction);
        const { error: uErr } = await svc.from("plan_pages").update({
          page_type: extraction.page_type || "unknown",
          page_subtype: extraction.page_subtype ?? null,
          page_type_confidence: confidence,
          sheet_number: extraction.sheet_number ?? null,
          sheet_name: extraction.sheet_name ?? null,
          scale_text: extraction.scale_text ?? null,
          scale_source: extraction.scale_text ? "vision" : null,
          metadata,
        }).eq("id", page.id).eq("tenant_id", doc.tenant_id);
        if (uErr) throw uErr;

        results.push({
          page_number: page.page_number,
          page_type: extraction.page_type,
          page_subtype: extraction.page_subtype,
          confidence,
          trades: extraction.trades?.length || 0,
          measurements: extraction.measurements?.length || 0,
          materials: extraction.materials?.length || 0,
          review,
        });
      } catch (e) {
        reviewCount += 1;
        results.push({ page_number: page.page_number, error: e instanceof Error ? e.message : String(e) });
      }
    }

    await svc.from("plan_documents").update({
      status: reviewCount ? "needs_review" : "extracting_geometry",
      status_message: reviewCount
        ? `vision extraction complete; ${reviewCount} page(s) need review`
        : "vision extraction complete; extracting geometry, measurements, and Blueprint v2 trade data",
    }).eq("id", doc.id).eq("tenant_id", doc.tenant_id);

    chainInternal("extract-roof-plan-geometry", { document_id: doc.id });
    chainInternal("aggregate-blueprint-vision-v2", { document_id: doc.id });

    return json({
      ok: true,
      document_id: doc.id,
      pages: results.length,
      review_count: reviewCount,
      aggregation_queued: true,
      geometry_queued: true,
      results,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: msg }, 500);
  }
});
