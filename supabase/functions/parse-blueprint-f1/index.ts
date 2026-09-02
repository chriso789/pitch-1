// End-to-end Blueprint F1 + Roofing integration endpoint.
// Safe replacement target for generic blueprint parsing; no CRM/estimate writes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { downloadStorageObject } from "../_shared/parsers/pdf-text.ts";
import { analyzeBlueprintPdfF1 } from "../_shared/parsers/blueprint-f1-runtime.ts";
import { persistBlueprintF1Result } from "../_shared/parsers/blueprint-f1-persistence.ts";
import { persistBlueprintSpecDimensionCandidates } from "../_shared/parsers/blueprint-spec-dimension-persistence.ts";
import { buildSafeRoofingTakeoff } from "../_shared/parsers/blueprint-roofing-engine.ts";
import { persistRoofingTakeoff } from "../_shared/parsers/blueprint-roofing-persistence.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-id",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function resolveTenant(svc: ReturnType<typeof createClient>, req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  const { data: userData, error: userErr } = await svc.auth.getUser(jwt);
  if (userErr || !userData?.user) throw new Error("unauthorized");
  const userId = userData.user.id;
  const { data: profile } = await svc.from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
  if (!profile?.tenant_id) throw new Error("no_tenant");
  const requested = req.headers.get("x-tenant-id");
  if (!requested || requested === profile.tenant_id) return { tenantId: profile.tenant_id as string, userId };
  const { data: access } = await svc.from("user_company_access").select("tenant_id").eq("user_id", userId).eq("tenant_id", requested).maybeSingle();
  if (!access?.tenant_id) throw new Error("tenant_forbidden");
  return { tenantId: requested, userId };
}

async function getOrCreateWorkbenchSession(
  svc: ReturnType<typeof createClient>, tenantId: string, userId: string, pd: Record<string, any>, f1: Awaited<ReturnType<typeof analyzeBlueprintPdfF1>>,
) {
  const { data: existing } = await svc.from("blueprint_import_sessions")
    .select("id,status").eq("tenant_id", tenantId).eq("source_context_type", "standalone")
    .eq("source_context_id", pd.id).neq("status", "superseded")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  let sessionId = existing?.id as string | undefined;
  let sourceDocumentId: string | undefined;
  if (sessionId) {
    const { data: src } = await svc.from("blueprint_source_documents").select("id")
      .eq("tenant_id", tenantId).eq("import_session_id", sessionId)
      .eq("document_reference", pd.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
    sourceDocumentId = src?.id;
  }

  if (!sessionId) {
    const { data: session, error } = await svc.from("blueprint_import_sessions").insert({
      tenant_id: tenantId,
      source_context_type: "standalone",
      source_context_id: pd.id,
      status: "trades_detected",
      contract_version: "blueprint-importer-v2",
      metadata: {
        source_origin: "plan_document",
        plan_document_id: pd.id,
        blueprint_intelligence: "f1",
        manual_measurement_required: f1.summary.image_only_page_count > 0,
      },
      created_by: userId,
    }).select("id").single();
    if (error || !session) throw new Error(`session_insert_failed:${error?.message ?? "unknown"}`);
    sessionId = session.id;
  }

  if (!sourceDocumentId) {
    const { data: src, error } = await svc.from("blueprint_source_documents").insert({
      import_session_id: sessionId,
      tenant_id: tenantId,
      storage_path: pd.file_path,
      document_reference: pd.id,
      document_type: "blueprint_set",
      provider: "user_uploaded_blueprint",
      original_filename: pd.file_name,
      page_count: f1.page_count,
      property_address: pd.property_address ?? null,
      extraction_status: "succeeded",
      metadata: { blueprint_intelligence: "f1", runtime_version: f1.runtime_version },
    }).select("id").single();
    if (error || !src) throw new Error(`source_doc_insert_failed:${error?.message ?? "unknown"}`);
    sourceDocumentId = src.id;
  }

  const roofSignal = f1.pages.some((p) => p.page_type === "roof_plan" || p.page_subtype === "roofing" || /ROOF/i.test(p.sheet_name ?? ""));
  if (roofSignal) {
    const { data: existingRoof } = await svc.from("blueprint_detected_trades").select("id")
      .eq("tenant_id", tenantId).eq("import_session_id", sessionId).eq("trade_id", "roofing")
      .neq("status", "dismissed").limit(1).maybeSingle();
    if (!existingRoof) {
      await svc.from("blueprint_detected_trades").insert({
        import_session_id: sessionId,
        tenant_id: tenantId,
        trade_id: "roofing",
        support_status: "mvp_supported",
        confidence: 0.9,
        detection_signals: { source: "blueprint_f1", roof_page_count: f1.pages.filter((p) => p.page_type === "roof_plan" || p.page_subtype === "roofing").length },
        source_document_ids: [sourceDocumentId],
        status: "detected",
      });
    }
  }

  return { sessionId, sourceDocumentId, roofSignal };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const { tenantId, userId } = await resolveTenant(svc, req);
    const body = await req.json().catch(() => ({}));
    const documentId = typeof body?.document_id === "string" ? body.document_id : null;
    if (!documentId) return json({ ok: false, error: "document_id required" }, 400);

    const { data: pd, error: pdErr } = await svc.from("plan_documents")
      .select("id,tenant_id,file_path,file_name,page_count,property_address")
      .eq("id", documentId).eq("tenant_id", tenantId).maybeSingle();
    if (pdErr || !pd) return json({ ok: false, error: "plan_document_not_found" }, 404);

    await svc.from("plan_documents").update({ status: "classifying", status_message: "Blueprint F1: extracting positioned layout" })
      .eq("id", documentId).eq("tenant_id", tenantId);

    let bytes: Uint8Array;
    try { bytes = await downloadStorageObject(svc as any, "blueprints", pd.file_path); }
    catch (primary) {
      try { bytes = await downloadStorageObject(svc as any, "blueprint-documents", pd.file_path); }
      catch { throw primary; }
    }

    const f1 = await analyzeBlueprintPdfF1(bytes);
    const f1Persist = await persistBlueprintF1Result(svc as any, tenantId, documentId, f1);
    const specDimPersist = await persistBlueprintSpecDimensionCandidates(svc as any, tenantId, documentId, f1);
    const { sessionId, sourceDocumentId, roofSignal } = await getOrCreateWorkbenchSession(svc, tenantId, userId, pd, f1);

    let roofing: any = null;
    if (roofSignal) {
      const safeTakeoff = buildSafeRoofingTakeoff({
        import_session_id: sessionId,
        source_document_id: sourceDocumentId,
        file_name: pd.file_name,
        pages: f1.layout_pages,
        viewports_by_page: f1.viewports_by_page,
        specification_candidates: f1.specifications,
        geometry_evidence: [],
      } as any);
      const persisted = await persistRoofingTakeoff(svc as any, tenantId, safeTakeoff);

      // Engine review flags are persisted as session-level flags. Idempotent by source code cleanup + insert.
      const source = "roofing_blueprint_v1";
      await svc.from("blueprint_review_flags").delete().eq("tenant_id", tenantId).eq("import_session_id", sessionId).contains("metadata", { source });
      if (safeTakeoff.review_flags.length) {
        await svc.from("blueprint_review_flags").insert(safeTakeoff.review_flags.map((flag: any) => ({
          import_session_id: sessionId,
          tenant_id: tenantId,
          related_entity_type: "import_session",
          related_entity_id: sessionId,
          severity: flag.severity,
          flag_code: flag.flag_code,
          message: flag.message,
          blocking: flag.blocking,
          resolved: false,
          metadata: { ...(flag.metadata ?? {}), source },
        })));
      }
      roofing = { summary: safeTakeoff.summary, persisted, review_flags: safeTakeoff.review_flags };
    }

    const requiresReview = f1.requires_review || Boolean(roofing?.review_flags?.some((f: any) => f.blocking));
    await svc.from("plan_documents").update({
      page_count: f1.page_count,
      status: "ready_for_review",
      status_message: `Blueprint F1 complete: ${f1.summary.pages_with_sheet_number}/${f1.page_count} sheets identified; roofing ${roofSignal ? "analyzed" : "not detected"}`.slice(0, 240),
      metadata: { ...(pd.metadata ?? {}), blueprint_f1: { runtime_version: f1.runtime_version, summary: f1.summary, session_id: sessionId } },
    }).eq("id", documentId).eq("tenant_id", tenantId);

    return json({
      ok: true,
      document_id: documentId,
      session_id: sessionId,
      source_document_id: sourceDocumentId,
      requires_review: requiresReview,
      f1: { runtime_version: f1.runtime_version, summary: f1.summary, missing_indexed_sheets: f1.missing_indexed_sheets, unresolved_reference_targets: f1.unresolved_reference_targets, persistence: f1Persist, spec_dimension_persistence: specDimPersist },
      roofing,
      push_to_estimate_enabled: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "unauthorized" ? 401 : message === "tenant_forbidden" ? 403 : 500;
    return json({ ok: false, error: message }, status);
  }
});
