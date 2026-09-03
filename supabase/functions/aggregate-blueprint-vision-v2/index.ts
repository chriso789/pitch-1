// Aggregates per-page blueprint vision metadata into Blueprint Importer v2
// session/source-document/plan-path/measurement/detected-trade records.
// This is the bridge between image-only sheet intelligence and the existing
// Blueprint Importer v2 acceptance/material-draft flow.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  TRADE_SUPPORT_MAP,
  type TradeId,
} from "../_shared/blueprint-importer/trade-catalog.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

type VisionTrade = { trade?: string; scope_notes?: string; evidence?: string };
type VisionMeasurement = {
  trade?: string | null;
  label?: string;
  value_text?: string;
  normalized_feet?: number | null;
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

function clean(s: unknown): string {
  return String(s ?? "").trim();
}

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

function truncate(value: string, max = 1500) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function measurementSlug(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "dimension";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
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
      if (!(access || profile?.tenant_id === doc.tenant_id || profile?.active_tenant_id === doc.tenant_id)) {
        return json({ ok: false, error: "forbidden" }, 403);
      }
    }

    const { data: pages, error: pageErr } = await svc.from("plan_pages")
      .select("id,page_number,page_type,page_subtype,page_type_confidence,sheet_number,sheet_name,scale_text,metadata")
      .eq("document_id", documentId).eq("tenant_id", doc.tenant_id).order("page_number");
    if (pageErr) throw pageErr;

    const pageRows = (pages ?? []) as PageRow[];
    const extracted = pageRows.map((page) => ({ page, vision: visionFromPage(page) })).filter((x) => !!x.vision);
    if (!extracted.length) {
      return json({ ok: false, error: "vision_extraction_missing", message: "No plan_pages.metadata.vision records found yet." }, 409);
    }

    const canonical = extracted.map(({ page, vision }) => ({
      page_number: page.page_number,
      page_type: vision!.page_type ?? page.page_type,
      page_subtype: vision!.page_subtype ?? page.page_subtype,
      sheet_number: vision!.sheet_number ?? page.sheet_number,
      sheet_name: vision!.sheet_name ?? page.sheet_name,
      scale_text: vision!.scale_text ?? page.scale_text,
      pitches: vision!.pitches ?? [],
      trades: vision!.trades ?? [],
      measurements: vision!.measurements ?? [],
      materials: vision!.materials ?? [],
      review_flags: vision!.review_flags ?? [],
    }));
    const deterministicHash = await sha256Hex({
      tenant_id: doc.tenant_id,
      plan_document_id: documentId,
      source_mode: "blueprint_vision",
      extraction_version: "v2-vision-aggregate-1",
      pages: canonical,
    });

    const { data: exactExisting } = await svc.from("blueprint_import_sessions")
      .select("id,status").eq("tenant_id", doc.tenant_id).eq("deterministic_hash", deterministicHash)
      .neq("status", "superseded").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (exactExisting?.id) {
      return json({ ok: true, idempotent: true, session_id: exactExisting.id, deterministic_hash: deterministicHash });
    }

    const { data: previousSessions } = await svc.from("blueprint_import_sessions")
      .select("id,metadata,status").eq("tenant_id", doc.tenant_id).neq("status", "superseded").neq("status", "cancelled");
    const previous = (previousSessions ?? []).find((s: any) => s.metadata?.plan_document_id === documentId && s.metadata?.source_mode === "blueprint_vision");
    if (previous?.id) {
      await svc.from("blueprint_import_sessions").update({ status: "superseded", updated_at: new Date().toISOString() })
        .eq("id", previous.id).eq("tenant_id", doc.tenant_id);
    }

    const mappedTradeEvidence = new Map<TradeId, {
      pages: Set<number>;
      scopes: VisionTrade[];
      measurements: VisionMeasurement[];
      materials: VisionMaterial[];
      confidences: number[];
    }>();
    const unmappedTrades: Array<{ page_number: number; trade: string; scope_notes: string; evidence: string }> = [];
    const unassignedMeasurements: Array<{ page_number: number; measurement: VisionMeasurement }> = [];

    const ensureTrade = (tradeId: TradeId) => {
      let x = mappedTradeEvidence.get(tradeId);
      if (!x) {
        x = { pages: new Set(), scopes: [], measurements: [], materials: [], confidences: [] };
        mappedTradeEvidence.set(tradeId, x);
      }
      return x;
    };

    for (const { page, vision } of extracted) {
      const confidence = Math.max(0, Math.min(1, Number(vision!.confidence ?? page.page_type_confidence ?? 0.5)));
      const pageMappedTrades = new Set<TradeId>();
      for (const t of vision!.trades ?? []) {
        const id = normalizeTrade(t.trade);
        if (!id) {
          unmappedTrades.push({ page_number: page.page_number, trade: clean(t.trade), scope_notes: clean(t.scope_notes), evidence: clean(t.evidence) });
          continue;
        }
        pageMappedTrades.add(id);
        const bucket = ensureTrade(id);
        bucket.pages.add(page.page_number);
        bucket.scopes.push(t);
        bucket.confidences.push(confidence);
      }
      for (const m of vision!.measurements ?? []) {
        let id = normalizeTrade(m.trade);
        if (!id && pageMappedTrades.size === 1) id = Array.from(pageMappedTrades)[0];
        if (!id) {
          unassignedMeasurements.push({ page_number: page.page_number, measurement: m });
          continue;
        }
        const bucket = ensureTrade(id);
        bucket.pages.add(page.page_number);
        bucket.measurements.push(m);
        bucket.confidences.push(confidence);
      }
      for (const material of vision!.materials ?? []) {
        const id = normalizeTrade(material.trade);
        if (!id) continue;
        const bucket = ensureTrade(id);
        bucket.pages.add(page.page_number);
        bucket.materials.push(material);
        bucket.confidences.push(confidence);
      }
    }

    const reviewFlags = canonical.flatMap((p) => (p.review_flags ?? []).map((message) => ({ page_number: p.page_number, message })));
    const overallConfidenceValues = extracted.map(({ page, vision }) => Math.max(0, Math.min(1, Number(vision!.confidence ?? page.page_type_confidence ?? 0))));
    const overallConfidence = overallConfidenceValues.length
      ? overallConfidenceValues.reduce((a, b) => a + b, 0) / overallConfidenceValues.length
      : 0;

    const { data: session, error: sessionErr } = await svc.from("blueprint_import_sessions").insert({
      tenant_id: doc.tenant_id,
      source_context_type: body.source_context_type ?? (doc.pipeline_entry_id ? "pipeline_entry" : doc.contact_id ? "contact" : "standalone"),
      source_context_id: body.source_context_id ?? doc.pipeline_entry_id ?? doc.contact_id ?? null,
      status: "parsed",
      contract_version: "blueprint-importer-v2",
      deterministic_hash: deterministicHash,
      metadata: {
        source_mode: "blueprint_vision",
        plan_document_id: documentId,
        property_address: doc.property_address ?? null,
        vision_page_count: extracted.length,
        physical_page_count: doc.page_count ?? pageRows.length,
        overall_confidence: overallConfidence,
        supersedes: previous?.id ?? null,
      },
      created_by: userId,
    }).select("id").single();
    if (sessionErr || !session) throw sessionErr ?? new Error("session_insert_failed");
    const sessionId = session.id as string;

    const { data: sourceDoc, error: sourceErr } = await svc.from("blueprint_source_documents").insert({
      import_session_id: sessionId,
      tenant_id: doc.tenant_id,
      storage_path: doc.file_path ?? null,
      document_reference: documentId,
      document_type: "blueprint_set",
      provider: "user_uploaded_blueprint",
      original_filename: doc.file_name ?? null,
      page_count: doc.page_count ?? pageRows.length,
      extraction_status: reviewFlags.length ? "needs_review" : "succeeded",
      metadata: {
        source_mode: "vision",
        vision_extraction_version: "v1.0.0",
        aggregate_version: "v2-vision-aggregate-1",
        overall_confidence: overallConfidence,
        sheets: canonical.map((p) => ({
          page_number: p.page_number,
          page_type: p.page_type,
          page_subtype: p.page_subtype,
          sheet_number: p.sheet_number,
          sheet_name: p.sheet_name,
          scale_text: p.scale_text,
          pitches: p.pitches,
        })),
        unmapped_trades: unmappedTrades,
        unassigned_measurements: unassignedMeasurements,
        review_flags: reviewFlags,
      },
    }).select("id").single();
    if (sourceErr || !sourceDoc) throw sourceErr ?? new Error("source_document_insert_failed");
    const sourceDocumentId = sourceDoc.id as string;

    let measurementCount = 0;
    let planPathCount = 0;
    for (const [tradeId, evidence] of mappedTradeEvidence.entries()) {
      const pageByMeasurement = new Map<VisionMeasurement, number>();
      for (const { page, vision } of extracted) {
        for (const m of vision!.measurements ?? []) {
          const explicitTrade = normalizeTrade(m.trade);
          const pageTradeIds = new Set((vision!.trades ?? []).map((t) => normalizeTrade(t.trade)).filter(Boolean) as TradeId[]);
          const resolved = explicitTrade ?? (pageTradeIds.size === 1 ? Array.from(pageTradeIds)[0] : null);
          if (resolved === tradeId) pageByMeasurement.set(m, page.page_number);
        }
      }

      for (let i = 0; i < evidence.measurements.length; i++) {
        const m = evidence.measurements[i];
        const pageNumber = pageByMeasurement.get(m) ?? Array.from(evidence.pages)[0] ?? null;
        const raw = clean(m.value_text);
        const normalizedFeet = Number(m.normalized_feet);
        if (!Number.isFinite(normalizedFeet) || normalizedFeet < 0) continue;

        const page = extracted.find((x) => x.page.page_number === pageNumber)?.page;
        const excerpt = truncate([clean(m.label), raw, clean(m.evidence)].filter(Boolean).join(" — "));
        const { data: pp, error: ppErr } = await svc.from("blueprint_plan_paths").insert({
          import_session_id: sessionId,
          tenant_id: doc.tenant_id,
          source_document_id: sourceDocumentId,
          path_type: "blueprint_sheet",
          file_name: doc.file_name ?? null,
          document_type: "blueprint_set",
          provider: "user_uploaded_blueprint",
          page_number: pageNumber,
          section_label: page?.sheet_number || page?.sheet_name || `Page ${pageNumber}`,
          table_label: null,
          diagram_label: clean(m.measurement_type) || null,
          source_text_excerpt: excerpt || raw || null,
          confidence: Math.max(0, Math.min(1, Number(page?.page_type_confidence ?? overallConfidence ?? 0.5))),
        }).select("id").single();
        if (ppErr || !pp) throw ppErr ?? new Error("plan_path_insert_failed");
        planPathCount += 1;

        const { error: moErr } = await svc.from("blueprint_measurement_objects").insert({
          import_session_id: sessionId,
          tenant_id: doc.tenant_id,
          source_document_id: sourceDocumentId,
          trade_id: tradeId,
          measurement_key: `vision.${tradeId}.${measurementSlug(m.measurement_type || m.label)}.p${pageNumber}.${i + 1}`,
          measurement_group: "blueprint_vision",
          quantity: normalizedFeet,
          unit: "LF",
          confidence: Math.max(0, Math.min(1, Number(page?.page_type_confidence ?? overallConfidence ?? 0.5))),
          source_value_raw: raw || clean(m.label) || null,
          normalized_value: normalizedFeet,
          plan_path_id: pp.id,
          page_number: pageNumber,
          metadata: {
            source_mode: "vision",
            label: clean(m.label),
            measurement_type: clean(m.measurement_type),
            evidence: clean(m.evidence),
            scale_text: page?.scale_text ?? null,
          },
        });
        if (moErr) throw moErr;
        measurementCount += 1;
      }
    }

    const detectedRows = Array.from(mappedTradeEvidence.entries()).map(([tradeId, evidence]) => {
      const confidence = evidence.confidences.length
        ? evidence.confidences.reduce((a, b) => a + b, 0) / evidence.confidences.length
        : overallConfidence;
      return {
        import_session_id: sessionId,
        tenant_id: doc.tenant_id,
        trade_id: tradeId,
        support_status: TRADE_SUPPORT_MAP[tradeId],
        confidence: Math.max(0, Math.min(1, confidence)),
        detection_signals: {
          source_mode: "blueprint_vision",
          pages: Array.from(evidence.pages).sort((a, b) => a - b),
          scopes: evidence.scopes,
          raw_measurements: evidence.measurements,
          materials: evidence.materials,
          explicit_brands: evidence.materials
            .filter((m) => m.brand_explicit && (m.manufacturer || m.product))
            .map((m) => ({ manufacturer: m.manufacturer ?? null, product: m.product ?? null, material: m.material ?? null, evidence: m.evidence ?? null })),
        },
        source_document_ids: [sourceDocumentId],
        status: "detected",
      };
    });
    if (detectedRows.length) {
      const { error } = await svc.from("blueprint_detected_trades").insert(detectedRows);
      if (error) throw error;
    }

    const flagRows: any[] = [];
    for (const f of reviewFlags) {
      flagRows.push({
        import_session_id: sessionId,
        tenant_id: doc.tenant_id,
        related_entity_type: "source_document",
        related_entity_id: sourceDocumentId,
        severity: "warning",
        flag_code: "blueprint_vision_review_required",
        message: `Page ${f.page_number}: ${f.message}`,
        blocking: false,
      });
    }
    if (unmappedTrades.length) {
      flagRows.push({
        import_session_id: sessionId,
        tenant_id: doc.tenant_id,
        related_entity_type: "source_document",
        related_entity_id: sourceDocumentId,
        severity: "info",
        flag_code: "blueprint_trade_not_in_v2_catalog",
        message: `${unmappedTrades.length} explicit trade reference(s) are preserved in source metadata but are not currently represented by a Blueprint Importer v2 TradeId.`,
        blocking: false,
      });
    }
    if (unassignedMeasurements.length) {
      flagRows.push({
        import_session_id: sessionId,
        tenant_id: doc.tenant_id,
        related_entity_type: "source_document",
        related_entity_id: sourceDocumentId,
        severity: "info",
        flag_code: "blueprint_measurement_trade_unassigned",
        message: `${unassignedMeasurements.length} raw dimension callout(s) were preserved but could not be safely assigned to a single trade.`,
        blocking: false,
      });
    }
    if (flagRows.length) await svc.from("blueprint_review_flags").insert(flagRows);

    await svc.from("blueprint_import_sessions").update({ status: "trades_detected", updated_at: new Date().toISOString() })
      .eq("id", sessionId).eq("tenant_id", doc.tenant_id);

    await svc.from("plan_documents").update({
      status_message: `Blueprint v2 aggregation complete: ${detectedRows.length} trade(s), ${measurementCount} normalized measurement(s)`,
    }).eq("id", documentId).eq("tenant_id", doc.tenant_id);

    return json({
      ok: true,
      idempotent: false,
      session_id: sessionId,
      source_document_id: sourceDocumentId,
      detected_trade_count: detectedRows.length,
      measurement_count: measurementCount,
      plan_path_count: planPathCount,
      unmapped_trade_count: unmappedTrades.length,
      unassigned_measurement_count: unassignedMeasurements.length,
      deterministic_hash: deterministicHash,
      supersedes_session_id: previous?.id ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: msg }, 500);
  }
});
