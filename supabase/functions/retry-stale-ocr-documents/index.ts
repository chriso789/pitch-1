// Retry stuck/failed OCR documents.
// Finds camera-scanned documents with stale or failed OCR and re-invokes
// `ocr-scanned-document` with the internal worker secret.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("INTERNAL_WORKER_SECRET") ?? "";

const STALE_MINUTES_DEFAULT = 10;
const MAX_RETRY_DEFAULT = 3;
const BATCH_DEFAULT = 25;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const body = await req.json().catch(() => ({}));
    const staleMinutes = Number(body?.stale_minutes ?? STALE_MINUTES_DEFAULT);
    const maxRetry = Number(body?.max_retry ?? MAX_RETRY_DEFAULT);
    const batch = Math.min(100, Number(body?.batch ?? BATCH_DEFAULT));

    const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();

    const { data: rows, error } = await admin
      .from("documents")
      .select("id, ocr_status, metadata, updated_at, created_at")
      .eq("scan_source", "camera")
      .in("ocr_status", ["processing", "not_started", "failed"])
      .lt("updated_at", cutoff)
      .order("updated_at", { ascending: true })
      .limit(batch);

    if (error) return json({ ok: false, error: error.message }, 500);

    const eligible = (rows ?? []).filter((r) => {
      const retryCount = Number(((r.metadata as any)?.ocr?.retry_count) ?? 0);
      return retryCount < maxRetry;
    });

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const r of eligible) {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/ocr-scanned-document`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-worker-secret": INTERNAL_SECRET,
          },
          body: JSON.stringify({ document_id: r.id }),
        });
        results.push({ id: r.id, ok: res.ok });
      } catch (e) {
        results.push({ id: r.id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return json({ ok: true, scanned: rows?.length ?? 0, retried: results.length, results });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
