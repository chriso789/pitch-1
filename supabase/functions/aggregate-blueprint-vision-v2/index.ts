// Aggregates per-page blueprint vision metadata into Blueprint Importer v2
// session/source-document/plan-path/measurement/detected-trade records.
// This bridges image-only sheet intelligence into the existing acceptance and
// material/labor draft flow without inventing unsupported quantities or brands.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { TRADE_SUPPORT_MAP, type TradeId } from "../_shared/blueprint-importer/trade-catalog.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

type MeasurementUnit = "sqft" | "lf" | "count" | "pitch_ratio" | "degrees" | "percent" | "ratio" | "unknown";
type MeasurementGroup = "roof_area" | "roof_edges" | "roof_flashing" | "roof_pitch" | "roof_penetrations" | "roof_waste" | "wall_area" | "wall_edges" | "wall_corners" | "wall_openings" | "wall_waste" | "trim" | "other";

type VisionTrade = { trade?: string; scope_notes?: string; evidence?: string };
type VisionMeasurement = {
  trade?: string | null;
  label?: string;
  value_text?: string;
  normalized_quantity?: number | null;
  unit?: MeasurementUnit | string | null;
  normalized_feet?: number | null; // compatibility with older vision rows
  measurement_type?: string;
  evidence?: string;
};
type VisionMaterial = {
  trade?: string;
  material?: string;
  specification?: string | null;
  manufacturer?: string | null;
  product?: string | null;
  brand_explicit?: boolean;
  evidence?: string;
};
type VisionExtraction = {
  page_type?: string;
  page_subtype?: string | null;
  confidence?: number;
  sheet_number?: string | null;
  sheet_name?: string | null;
  scale_text?: string | null;
  pitches?: string[];
  trades?: VisionTrade[];
  measurements?: VisionMeasurement[];
  materials?: VisionMaterial[];
  review_flags?: string[];
};
type PageRow = {
  id: string;
  page_number: number;
  page_type: string | null;
  page_subtype: string | null;
  page_type_confidence: number | null;
  sheet_number: string | null;
  sheet_name: string | null;
  scale_text: string | null;
  metadata: Record<string, unknown> | null;
};

function clean(s: unknown): string { return String(s ?? "").trim(); }
function normalizeTrade(raw: unknown): TradeId | null {
  const s = clean(raw).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  if (!s) return null;
  if (/\b(roof|roofing|tile roof|shingle|tpo|epdm|modified bitumen)\b/.test(s)) return "roofing";
  if (/\b(stucco|siding|exterior wall|wall cladding|cladding|eifs)\b/.test(s)) return "exterior_walls_siding";
  if (/\b(paint|painting|coating|coatings)\b/.test(s)) return "paint_coatings";
  if (/\b(gutter|gutters|fascia|soffit|exterior trim|roof trim)\b/.test(s)) return "gutters_fascia_trim";
  if (/\b(window|windows|door|doors|glazing|garage door|storefront)\b/.test(s)) return "windows_doors";
  if (/\b(drywall|gypsum|gyp board|gwb)\b/.test(s)) return "drywall";
  if (/\b(framing|carpentry|wood frame|structural framing|stud)\b/.test(s)) return "framing";
  if (/\b(insulation|spray foam|batt)\b/.test(s)) return "insulation";
  if (/\b(flooring|floor finish|tile floor|wood floor|carpet)\b/.test(s)) return "flooring";
  if (/\b(concrete|slab|foundation)\b/.test(s)) return "concrete";
  if (/\b(electrical|electric|lighting|receptacle|power)\b/.test(s)) return "electrical";
  if (/\b(plumbing|plumber|sanitary|water piping|fixture)\b/.test(s)) return "plumbing";
  if (/\b(hvac|mechanical|air conditioning|air conditioner|ductwork)\b/.test(s)) return "hvac";
  return null;
}
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
async function sha256Hex(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function visionFromPage(page: PageRow): VisionExtraction | null {
  const metadata = page.metadata && typeof page.metadata === "object" ? page.metadata : {};
  const v = (metadata as any).vision;
  return v && typeof v === "object" ? v as VisionExtraction : null;
}
function truncate(value: string, max = 1500) { return value.length > max ? `${value.slice(0, max - 1)}…` : value; }
function slug(value: unknown) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "dimension"; }
const VALID_UNITS = new Set<MeasurementUnit>(["sqft", "lf", "count", "pitch_ratio", "degrees", "percent", "ratio", "unknown"]);
function normalizedMeasurement(m: VisionMeasurement): { quantity: number; unit: MeasurementUnit } | null {
  const q = Number(m.normalized_quantity);
  const rawUnit = clean(m.unit).toLowerCase() as MeasurementUnit;
  if (Number.isFinite(q) && q >= 0) return { quantity: q, unit: VALID_UNITS.has(rawUnit) ? rawUnit : "unknown" };
  const feet = Number(m.normalized_feet);
  if (Number.isFinite(feet) && feet >= 0) return { quantity: feet, unit: "lf" };
  return null;
}
function canonicalMeasurementKey(trade: TradeId, m: VisionMeasurement, pageNumber: number, index: number): string {
  const text = `${clean(m.label)} ${clean(m.measurement_type)} ${clean(m.evidence)}`.toLowerCase();
  if (trade === "roofing") {
    if (/total.*roof.*area|roof.*area.*total/.test(text)) return "total_roof_area_sqft";
    if (/pitched.*roof.*area/.test(text)) return "pitched_roof_area_sqft";
    if (/flat.*roof.*area/.test(text)) return "flat_roof_area_sqft";
    if (/roof.*facet/.test(text)) return "roof_facets_count";
    if (/predominant.*pitch|roof.*pitch/.test(text)) return "predominant_pitch";
    if (/\beave/.test(text)) return "eaves_lf";
    if (/\brake/.test(text)) return "rakes_lf";
    if (/\bvalley/.test(text)) return "valleys_lf";
    if (/\bhip\b/.test(text)) return "hips_lf";
    if (/\bridge/.test(text)) return "ridges_lf";
    if (/step.*flash/.test(text)) return "step_flashing_lf";
    if (/flash/.test(text)) return "flashing_lf";
    if (/parapet/.test(text)) return "parapet_lf";
    if (/penetration.*count|roof.*penetration/.test(text)) return "penetrations_count";
  }
  if (trade === "exterior_walls_siding") {
    if (/wall.*area.*window|wall.*area.*door/.test(text)) return "wall_area_with_windows_doors_sqft";
    if (/wall.*area/.test(text)) return "wall_area_sqft";
    if (/top.*wall/.test(text)) return "top_of_walls_lf";
    if (/bottom.*wall/.test(text)) return "bottom_of_walls_lf";
    if (/inside.*corner/.test(text)) return "inside_corners_lf";
    if (/outside.*corner/.test(text)) return "outside_corners_lf";
    if (/window.*door.*area|opening.*area/.test(text)) return "window_door_area_sqft";
    if (/window.*door.*count|opening.*count/.test(text)) return "window_door_count";
    if (/window.*door.*perimeter|opening.*perimeter/.test(text)) return "window_door_perimeter_lf";
    if (/fascia|eave|rake/.test(text)) return "fascia_eaves_rake_lf";
  }
  return `vision.${trade}.${slug(m.measurement_type || m.label)}.p${pageNumber}.${index + 1}`;
}
function measurementGroup(trade: TradeId, key: string): MeasurementGroup {
  if (trade === "roofing") {
    if (key.includes("area") || key.includes("facet")) return "roof_area";
    if (key.includes("pitch")) return "roof_pitch";
    if (key.includes("flashing") || key.includes("parapet")) return "roof_flashing";
    if (key.includes("penetration")) return "roof_penetrations";
    if (/eaves|rakes|valleys|hips|ridges/.test(key)) return "roof_edges";
  }
  if (trade === "exterior_walls_siding") {
    if (key.startsWith("wall_area")) return "wall_area";
    if (key.includes("corner")) return "wall_corners";
    if (key.includes("window_door")) return "wall_openings";
    if (key.includes("top_of_walls") || key.includes("bottom_of_walls")) return "wall_edges";
    if (key.includes("fascia")) return "trim";
  }
  return "other";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization") || "";
    const jwt = auth.replace("Bearer ", "");
    let userId: string | null = null;
    if (jwt && jwt !== serviceKey) {
      const { data } = await svc.auth.getUser(jwt);
      userId = data?.user?.id ?? null;
      if (!userId) return json({ ok: false, error: "unauthorized" }, 401);
    }
    const body = await req.json().catch(() => ({}));
    const documentId = typeof body.document_id === "string" ? body.document_id : null;
    if (!documentId) return json({ ok: false, error: "document_id required" }, 400);

    const { data: doc, error: docErr } = await svc.from("plan_documents")
      .select("id,tenant_id,file_path,file_name,page_count,property_address,contact_id,pipeline_entry_id")
      .eq("id", documentId).maybeSingle();
    if (docErr) throw docErr;
    if (!doc) return json({ ok: false, error: "plan_document_not_found" }, 404);
    if (userId) {
      const [{ data: access }, { data: profile }] = await Promise.all([
        svc.from("user_company_access").select("tenant_id").eq("user_id", userId).eq("tenant_id", doc.tenant_id).maybeSingle(),
        svc.from("profiles").select("tenant_id,active_tenant_id").eq("id", userId).maybeSingle(),
      ]);
      if (!(access || profile?.tenant_id === doc.tenant_id || profile?.active_tenant_id === doc.tenant_id)) return json({ ok: false, error: "forbidden" }, 403);
    }

    const { data: pages, error: pageErr } = await svc.from("plan_pages")
      .select("id,page_number,page_type,page_subtype,page_type_confidence,sheet_number,sheet_name,scale_text,metadata")
      .eq("document_id", documentId).eq("tenant_id", doc.tenant_id).order("page_number");
    if (pageErr) throw pageErr;
    const pageRows = (pages ?? []) as PageRow[];
    const extracted = pageRows.map((page) => ({ page, vision: visionFromPage(page) })).filter((x) => !!x.vision);
    if (!extracted.length) return json({ ok: false, error: "vision_extraction_missing", message: "No plan_pages.metadata.vision records found yet." }, 409);

    const canonical = extracted.map(({ page, vision }) => ({
      page_number: page.page_number, page_type: vision!.page_type ?? page.page_type, page_subtype: vision!.page_subtype ?? page.page_subtype,
      sheet_number: vision!.sheet_number ?? page.sheet_number, sheet_name: vision!.sheet_name ?? page.sheet_name,
      scale_text: vision!.scale_text ?? page.scale_text, pitches: vision!.pitches ?? [], trades: vision!.trades ?? [], measurements: vision!.measurements ?? [], materials: vision!.materials ?? [], review_flags: vision!.review_flags ?? [],
    }));
    const deterministicHash = await sha256Hex({ tenant_id: doc.tenant_id, plan_document_id: documentId, source_mode: "blueprint_vision", extraction_version: "v2-vision-aggregate-2", pages: canonical });
    const { data: exactExisting } = await svc.from("blueprint_import_sessions").select("id,status").eq("tenant_id", doc.tenant_id).eq("deterministic_hash", deterministicHash).neq("status", "superseded").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (exactExisting?.id) return json({ ok: true, idempotent: true, session_id: exactExisting.id, deterministic_hash: deterministicHash });

    const { data: previousSessions } = await svc.from("blueprint_import_sessions").select("id,metadata,status").eq("tenant_id", doc.tenant_id).neq("status", "superseded").neq("status", "cancelled");
    const previous = (previousSessions ?? []).find((s: any) => s.metadata?.plan_document_id === documentId && s.metadata?.source_mode === "blueprint_vision");
    if (previous?.id) await svc.from("blueprint_import_sessions").update({ status: "superseded", updated_at: new Date().toISOString() }).eq("id", previous.id).eq("tenant_id", doc.tenant_id);

    const mapped = new Map<TradeId, { pages: Set<number>; scopes: VisionTrade[]; measurements: Array<{ page_number: number; measurement: VisionMeasurement }>; materials: Array<{ page_number: number; material: VisionMaterial }>; confidences: number[] }>();
    const unmappedTrades: Array<{ page_number: number; trade: string; scope_notes: string; evidence: string }> = [];
    const unmappedMaterials: Array<{ page_number: number; material: VisionMaterial }> = [];
    const unassignedMeasurements: Array<{ page_number: number; measurement: VisionMeasurement }> = [];
    const ensure = (id: TradeId) => { let x = mapped.get(id); if (!x) { x = { pages: new Set(), scopes: [], measurements: [], materials: [], confidences: [] }; mapped.set(id, x); } return x; };

    for (const { page, vision } of extracted) {
      const confidence = Math.max(0, Math.min(1, Number(vision!.confidence ?? page.page_type_confidence ?? 0.5)));
      const pageTradeIds = new Set<TradeId>();
      for (const t of vision!.trades ?? []) {
        const id = normalizeTrade(t.trade);
        if (!id) { unmappedTrades.push({ page_number: page.page_number, trade: clean(t.trade), scope_notes: clean(t.scope_notes), evidence: clean(t.evidence) }); continue; }
        pageTradeIds.add(id); const bucket = ensure(id); bucket.pages.add(page.page_number); bucket.scopes.push(t); bucket.confidences.push(confidence);
      }
      for (const m of vision!.measurements ?? []) {
        let id = normalizeTrade(m.trade); if (!id && pageTradeIds.size === 1) id = Array.from(pageTradeIds)[0];
        if (!id) { unassignedMeasurements.push({ page_number: page.page_number, measurement: m }); continue; }
        const bucket = ensure(id); bucket.pages.add(page.page_number); bucket.measurements.push({ page_number: page.page_number, measurement: m }); bucket.confidences.push(confidence);
      }
      for (const material of vision!.materials ?? []) {
        const id = normalizeTrade(material.trade);
        if (!id) { unmappedMaterials.push({ page_number: page.page_number, material }); continue; }
        const bucket = ensure(id); bucket.pages.add(page.page_number); bucket.materials.push({ page_number: page.page_number, material }); bucket.confidences.push(confidence);
      }
    }

    const reviewFlags = canonical.flatMap((p) => (p.review_flags ?? []).map((message) => ({ page_number: p.page_number, message })));
    const confidences = extracted.map(({ page, vision }) => Math.max(0, Math.min(1, Number(vision!.confidence ?? page.page_type_confidence ?? 0))));
    const overallConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;

    const { data: session, error: sessionErr } = await svc.from("blueprint_import_sessions").insert({
      tenant_id: doc.tenant_id,
      source_context_type: body.source_context_type ?? (doc.pipeline_entry_id ? "pipeline_entry" : doc.contact_id ? "contact" : "standalone"),
      source_context_id: body.source_context_id ?? doc.pipeline_entry_id ?? doc.contact_id ?? null,
      status: "parsed", contract_version: "blueprint-importer-v2", deterministic_hash: deterministicHash,
      metadata: { source_mode: "blueprint_vision", plan_document_id: documentId, property_address: doc.property_address ?? null, vision_page_count: extracted.length, physical_page_count: doc.page_count ?? pageRows.length, overall_confidence: overallConfidence, supersedes: previous?.id ?? null },
      created_by: userId,
    }).select("id").single();
    if (sessionErr || !session) throw sessionErr ?? new Error("session_insert_failed");
    const sessionId = session.id as string;

    const { data: sourceDoc, error: sourceErr } = await svc.from("blueprint_source_documents").insert({
      import_session_id: sessionId, tenant_id: doc.tenant_id, storage_path: doc.file_path ?? null, document_reference: documentId,
      document_type: "blueprint_set", provider: "user_uploaded_blueprint", original_filename: doc.file_name ?? null, page_count: doc.page_count ?? pageRows.length,
      extraction_status: reviewFlags.length ? "needs_review" : "succeeded",
      metadata: {
        source_mode: "vision", vision_extraction_version: "v1.2.0", aggregate_version: "v2-vision-aggregate-2", overall_confidence: overallConfidence,
        sheets: canonical.map((p) => ({ page_number: p.page_number, page_type: p.page_type, page_subtype: p.page_subtype, sheet_number: p.sheet_number, sheet_name: p.sheet_name, scale_text: p.scale_text, pitches: p.pitches })),
        unmapped_trades: unmappedTrades, unmapped_materials: unmappedMaterials, unassigned_measurements: unassignedMeasurements, review_flags: reviewFlags,
      },
    }).select("id").single();
    if (sourceErr || !sourceDoc) throw sourceErr ?? new Error("source_document_insert_failed");
    const sourceDocumentId = sourceDoc.id as string;

    let measurementCount = 0; let planPathCount = 0;
    for (const [tradeId, evidence] of mapped.entries()) {
      for (let i = 0; i < evidence.measurements.length; i++) {
        const { page_number: pageNumber, measurement: m } = evidence.measurements[i];
        const normalized = normalizedMeasurement(m); if (!normalized) continue;
        const page = pageRows.find((p) => p.page_number === pageNumber);
        const excerpt = truncate([clean(m.label), clean(m.value_text), clean(m.evidence)].filter(Boolean).join(" — "));
        const key = canonicalMeasurementKey(tradeId, m, pageNumber, i); const group = measurementGroup(tradeId, key);
        const confidence = Math.max(0, Math.min(1, Number(page?.page_type_confidence ?? overallConfidence ?? 0.5)));
        const { data: pp, error: ppErr } = await svc.from("blueprint_plan_paths").insert({
          import_session_id: sessionId, tenant_id: doc.tenant_id, source_document_id: sourceDocumentId, path_type: "blueprint_sheet",
          file_name: doc.file_name ?? null, document_type: "blueprint_set", provider: "user_uploaded_blueprint", page_number: pageNumber,
          section_label: page?.sheet_number || page?.sheet_name || `Page ${pageNumber}`, table_label: null, diagram_label: clean(m.measurement_type) || null,
          source_text_excerpt: excerpt || clean(m.value_text) || null, confidence,
        }).select("id").single();
        if (ppErr || !pp) throw ppErr ?? new Error("plan_path_insert_failed"); planPathCount += 1;
        const { error: moErr } = await svc.from("blueprint_measurement_objects").insert({
          import_session_id: sessionId, tenant_id: doc.tenant_id, source_document_id: sourceDocumentId, trade_id: tradeId,
          measurement_key: key, measurement_group: group, quantity: normalized.quantity, unit: normalized.unit, confidence,
          source_value_raw: clean(m.value_text) || clean(m.label) || null, normalized_value: { quantity: normalized.quantity, unit: normalized.unit },
          plan_path_id: pp.id, page_number: pageNumber,
          metadata: { source_mode: "vision", label: clean(m.label), measurement_type: clean(m.measurement_type), evidence: clean(m.evidence), scale_text: page?.scale_text ?? null },
        });
        if (moErr) throw moErr; measurementCount += 1;
      }
    }

    const detectedRows = Array.from(mapped.entries()).map(([tradeId, evidence]) => {
      const confidence = evidence.confidences.length ? evidence.confidences.reduce((a, b) => a + b, 0) / evidence.confidences.length : overallConfidence;
      return {
        import_session_id: sessionId, tenant_id: doc.tenant_id, trade_id: tradeId, support_status: TRADE_SUPPORT_MAP[tradeId], confidence: Math.max(0, Math.min(1, confidence)),
        detection_signals: {
          source_mode: "blueprint_vision", pages: Array.from(evidence.pages).sort((a, b) => a - b), scopes: evidence.scopes,
          raw_measurements: evidence.measurements, materials: evidence.materials,
          explicit_brands: evidence.materials.filter((x) => x.material.brand_explicit && (x.material.manufacturer || x.material.product)).map((x) => ({ page_number: x.page_number, manufacturer: x.material.manufacturer ?? null, product: x.material.product ?? null, material: x.material.material ?? null, evidence: x.material.evidence ?? null })),
        },
        source_document_ids: [sourceDocumentId], status: "detected",
      };
    });
    if (detectedRows.length) { const { error } = await svc.from("blueprint_detected_trades").insert(detectedRows); if (error) throw error; }

    const flagRows: any[] = reviewFlags.map((f) => ({ import_session_id: sessionId, tenant_id: doc.tenant_id, related_entity_type: "source_document", related_entity_id: sourceDocumentId, severity: "warning", flag_code: "blueprint_vision_review_required", message: `Page ${f.page_number}: ${f.message}`, blocking: false }));
    if (unmappedTrades.length) flagRows.push({ import_session_id: sessionId, tenant_id: doc.tenant_id, related_entity_type: "source_document", related_entity_id: sourceDocumentId, severity: "info", flag_code: "blueprint_trade_not_in_v2_catalog", message: `${unmappedTrades.length} explicit trade reference(s) are preserved in source metadata but are not represented by a Blueprint Importer v2 TradeId.`, blocking: false });
    if (unmappedMaterials.length) flagRows.push({ import_session_id: sessionId, tenant_id: doc.tenant_id, related_entity_type: "source_document", related_entity_id: sourceDocumentId, severity: "info", flag_code: "blueprint_material_trade_unmapped", message: `${unmappedMaterials.length} material/spec reference(s) were preserved but could not be mapped to a current v2 trade.`, blocking: false });
    if (unassignedMeasurements.length) flagRows.push({ import_session_id: sessionId, tenant_id: doc.tenant_id, related_entity_type: "source_document", related_entity_id: sourceDocumentId, severity: "info", flag_code: "blueprint_measurement_trade_unassigned", message: `${unassignedMeasurements.length} raw measurement(s) were preserved but could not be safely assigned to one trade.`, blocking: false });
    if (flagRows.length) await svc.from("blueprint_review_flags").insert(flagRows);

    await svc.from("blueprint_import_sessions").update({ status: "trades_detected", updated_at: new Date().toISOString() }).eq("id", sessionId).eq("tenant_id", doc.tenant_id);
    await svc.from("plan_documents").update({ status_message: `Blueprint v2 aggregation complete: ${detectedRows.length} trade(s), ${measurementCount} normalized measurement(s)` }).eq("id", documentId).eq("tenant_id", doc.tenant_id);
    return json({ ok: true, idempotent: false, session_id: sessionId, source_document_id: sourceDocumentId, detected_trade_count: detectedRows.length, measurement_count: measurementCount, plan_path_count: planPathCount, unmapped_trade_count: unmappedTrades.length, unmapped_material_count: unmappedMaterials.length, unassigned_measurement_count: unassignedMeasurements.length, deterministic_hash: deterministicHash, supersedes_session_id: previous?.id ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: msg }, 500);
  }
});
