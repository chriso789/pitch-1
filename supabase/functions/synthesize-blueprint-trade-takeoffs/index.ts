import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { TRADE_SUPPORT_MAP, type TradeId } from "../_shared/blueprint-importer/trade-catalog.ts";
import { synthesizeTradeTakeoff, type MaterialEvidence, type MeasurementInput } from "../_shared/blueprint-importer/trade-takeoff-synthesis.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`).join(",")}}`;
}

async function hash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value)));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extractMaterials(signals: unknown): MaterialEvidence[] {
  if (!signals || typeof signals !== "object") return [];
  const raw = (signals as any).materials;
  if (!Array.isArray(raw)) return [];
  return raw.map((entry: any) => {
    if (entry?.material && typeof entry.material === "object") {
      return { page_number: entry.page_number ?? null, ...entry.material } as MaterialEvidence;
    }
    return entry as MaterialEvidence;
  });
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
    const sessionId = typeof body.session_id === "string" ? body.session_id : null;
    if (!sessionId) return json({ ok: false, error: "session_id required" }, 400);

    const { data: session, error: sErr } = await svc.from("blueprint_import_sessions")
      .select("id,tenant_id,status,metadata")
      .eq("id", sessionId).maybeSingle();
    if (sErr) throw sErr;
    if (!session) return json({ ok: false, error: "session_not_found" }, 404);

    if (userId) {
      const [{ data: access }, { data: profile }] = await Promise.all([
        svc.from("user_company_access").select("tenant_id").eq("user_id", userId).eq("tenant_id", session.tenant_id).maybeSingle(),
        svc.from("profiles").select("tenant_id,active_tenant_id").eq("id", userId).maybeSingle(),
      ]);
      if (!(access || profile?.tenant_id === session.tenant_id || profile?.active_tenant_id === session.tenant_id)) {
        return json({ ok: false, error: "forbidden" }, 403);
      }
    }

    if (["superseded", "failed", "rejected"].includes(session.status)) {
      return json({ ok: false, error: "session_not_active", status: session.status }, 409);
    }

    const [{ data: detected, error: dErr }, { data: accepted, error: aErr }, { data: measurements, error: mErr }] = await Promise.all([
      svc.from("blueprint_detected_trades").select("id,trade_id,support_status,confidence,detection_signals,status").eq("import_session_id", sessionId).eq("tenant_id", session.tenant_id).neq("status", "superseded"),
      svc.from("blueprint_accepted_trades").select("id,trade_id,review_state,user_assumptions,status").eq("import_session_id", sessionId).eq("tenant_id", session.tenant_id).neq("status", "superseded"),
      svc.from("blueprint_measurement_objects").select("id,trade_id,measurement_key,quantity,unit,confidence,plan_path_id,page_number,source_value_raw,metadata").eq("import_session_id", sessionId).eq("tenant_id", session.tenant_id),
    ]);
    if (dErr) throw dErr;
    if (aErr) throw aErr;
    if (mErr) throw mErr;

    const allMeasurements = (measurements ?? []) as MeasurementInput[];
    const results: any[] = [];
    for (const det of detected ?? []) {
      if (!(det.trade_id in TRADE_SUPPORT_MAP)) continue;
      const tradeId = det.trade_id as TradeId;
      const acc = (accepted ?? []).find((a: any) => a.trade_id === tradeId && a.status === "accepted") ?? null;
      const materials = extractMaterials(det.detection_signals);
      const takeoff = synthesizeTradeTakeoff({
        trade_id: tradeId,
        measurements: allMeasurements,
        materials,
        assumptions: acc?.user_assumptions ?? {},
      });
      const deterministicHash = await hash({ session_id: sessionId, trade_id: tradeId, takeoff });
      const row = {
        import_session_id: sessionId,
        tenant_id: session.tenant_id,
        trade_id: tradeId,
        support_status: takeoff.support_status,
        status: takeoff.status,
        template_key: takeoff.template_key,
        template_compatible: takeoff.template_compatible,
        template_block_reason: takeoff.template_block_reason,
        measurements: takeoff.measurements,
        material_specs: takeoff.material_specs,
        explicit_brands: takeoff.explicit_brands,
        required_measurement_keys: takeoff.required_measurement_keys,
        missing_required_measurement_keys: takeoff.missing_required_measurement_keys,
        calculations: takeoff.calculations,
        blockers: takeoff.blockers,
        warnings: takeoff.warnings,
        source_measurement_ids: takeoff.source_measurement_ids,
        source_plan_path_ids: takeoff.source_plan_path_ids,
        deterministic_hash: deterministicHash,
        updated_at: new Date().toISOString(),
      };
      const { data: saved, error: saveErr } = await svc.from("blueprint_trade_takeoffs")
        .upsert(row, { onConflict: "import_session_id,trade_id" })
        .select("id").single();
      if (saveErr) throw saveErr;
      results.push({
        id: saved.id,
        trade_id: tradeId,
        status: takeoff.status,
        support_status: takeoff.support_status,
        template_key: takeoff.template_key,
        template_compatible: takeoff.template_compatible,
        template_block_reason: takeoff.template_block_reason,
        measurement_count: takeoff.measurements.length,
        material_spec_count: takeoff.material_specs.length,
        explicit_brand_count: takeoff.explicit_brands.length,
        blockers: takeoff.blockers,
        warnings: takeoff.warnings,
        draft_generation_allowed: !!acc && takeoff.status === "ready" && takeoff.template_compatible,
      });
    }

    const anyBlocked = results.some((r) => r.status === "blocked");
    const anyReview = results.some((r) => r.status === "needs_review" || r.status === "manual_only");
    if (anyBlocked || anyReview) {
      await svc.from("blueprint_import_sessions").update({
        status: "user_review_required",
        updated_at: new Date().toISOString(),
        metadata: { ...(session.metadata ?? {}), takeoff_synthesis_version: "v1.0.0", takeoff_count: results.length },
      }).eq("id", sessionId).eq("tenant_id", session.tenant_id);
    } else {
      await svc.from("blueprint_import_sessions").update({
        metadata: { ...(session.metadata ?? {}), takeoff_synthesis_version: "v1.0.0", takeoff_count: results.length },
        updated_at: new Date().toISOString(),
      }).eq("id", sessionId).eq("tenant_id", session.tenant_id);
    }

    return json({ ok: true, session_id: sessionId, takeoff_count: results.length, results });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
