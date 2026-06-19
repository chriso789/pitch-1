// Match an AI document extraction to candidate CRM records (contact / pipeline / job).
// Auto-links when exactly one strong (>=0.85) candidate exists.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  findContactCandidates, findPipelineCandidates, findJobCandidates,
  confidenceBand, resolveTenantAccess, type MatchInputs, type MatchCandidate,
} from "../_shared/document-crm-match.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!jwt) return json({ ok: false, error: "unauthorized" }, 401);
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ ok: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const extractionId: string | null = body?.extraction_id ?? null;
    const force: boolean = !!body?.force;
    if (!extractionId) return json({ ok: false, error: "missing extraction_id" }, 400);

    const { data: ex } = await admin.from("ai_document_extractions").select("*")
      .eq("id", extractionId).maybeSingle();
    if (!ex) return json({ ok: false, error: "extraction_not_found" }, 404);

    const allowed = await resolveTenantAccess(admin, u.user.id, ex.tenant_id);
    if (!allowed) return json({ ok: false, error: "tenant access denied" }, 403);

    const n = ex.normalized_fields ?? {};
    const inputs: MatchInputs = {
      customer_name: n.customer_name ?? n.owner_name ?? n.legal_name ?? null,
      customer_email: n.customer_email ?? n.email ?? null,
      customer_phone: n.customer_phone ?? n.phone ?? null,
      property_address: n.property_address ?? n.job_address ?? null,
      job_address: n.job_address ?? null,
      owner_name: n.owner_name ?? null,
      contact_id: ex.contact_id,
      lead_id: ex.lead_id,
      pipeline_entry_id: ex.pipeline_entry_id,
      job_id: ex.job_id,
    };

    const contactCandidates = await findContactCandidates(admin, ex.tenant_id, inputs);
    const contactIds = contactCandidates.filter((c) => c.score >= 0.40).map((c) => c.target_id);
    const pipelineCandidates = await findPipelineCandidates(admin, ex.tenant_id, inputs, contactIds);
    const jobCandidates = await findJobCandidates(admin, ex.tenant_id, inputs, contactIds);

    const all: MatchCandidate[] = [...contactCandidates, ...pipelineCandidates, ...jobCandidates]
      .map((c) => ({ ...c, band: confidenceBand(c.score) } as any));

    // Auto-link: only if exactly one strong candidate AND not already linked (unless force)
    let autoLinked: MatchCandidate | null = null;
    const strong = all.filter((c) => c.score >= 0.85);
    const alreadyLinked = !!(ex.contact_id || ex.pipeline_entry_id || ex.job_id || ex.lead_id);
    if (strong.length === 1 && (!alreadyLinked || force)) {
      const winner = strong[0];
      const update: Record<string, unknown> = {
        match_metadata: {
          ...(ex.match_metadata ?? {}),
          auto_linked: true,
          score: winner.score,
          matched_on: winner.matched_on,
          target_type: winner.target_type,
          target_id: winner.target_id,
          candidates: all,
          matched_at: new Date().toISOString(),
        },
      };
      if (winner.target_type === "contact") update.contact_id = winner.target_id;
      else if (winner.target_type === "pipeline_entry") update.pipeline_entry_id = winner.target_id;
      else if (winner.target_type === "job") update.job_id = winner.target_id;
      else if (winner.target_type === "lead") update.lead_id = winner.target_id;
      await admin.from("ai_document_extractions").update(update).eq("id", ex.id);
      autoLinked = winner;
    } else {
      await admin.from("ai_document_extractions").update({
        match_metadata: {
          ...(ex.match_metadata ?? {}),
          auto_linked: false,
          candidates: all,
          matched_at: new Date().toISOString(),
        },
      }).eq("id", ex.id);
    }

    return json({ ok: true, extraction_id: ex.id, auto_linked: autoLinked, candidates: all });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[match-document-crm-records]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
