import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const DRIVERS = ["roof_area", "perimeter", "parapet", "flashing", "drains", "scuppers", "curbs", "penetrations"];
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const schema = {
  type: "object", additionalProperties: false,
  required: ["project", "sheets", "quantities", "roof_system", "scope_notes"],
  properties: {
    project: {
      type: "object", additionalProperties: false,
      required: ["name", "address", "architect", "owner", "project_number", "engineer", "general_contractor", "bid_due_date", "total_roof_area_sf"],
      properties: {
        name: { type: ["string", "null"] }, address: { type: ["string", "null"] }, architect: { type: ["string", "null"] },
        owner: { type: ["string", "null"] }, project_number: { type: ["string", "null"] },
        engineer: { type: ["string", "null"] }, general_contractor: { type: ["string", "null"] },
        bid_due_date: { type: ["string", "null"], description: "YYYY-MM-DD if printed" }, total_roof_area_sf: { type: ["number", "null"] },
      },
    },
    sheets: {
      type: "array", items: {
        type: "object", additionalProperties: false, required: ["sheet", "title", "discipline", "roof_relevant", "scale"],
        properties: { sheet: { type: "string" }, title: { type: "string" }, discipline: { type: "string" }, roof_relevant: { type: "boolean" }, scale: { type: ["string", "null"] } },
      },
    },
    quantities: {
      type: "array", items: {
        type: "object", additionalProperties: false,
        required: ["driver", "label", "value", "uom", "roof_section", "source_sheet", "confidence", "basis"],
        properties: {
          driver: { type: "string", enum: DRIVERS }, label: { type: "string" }, value: { type: "number" },
          uom: { type: "string", enum: ["SF", "LF", "EA"] }, roof_section: { type: ["string", "null"] },
          source_sheet: { type: ["string", "null"] }, confidence: { type: "number" }, basis: { type: "string" },
        },
      },
    },
    roof_system: {
      type: "object", additionalProperties: false,
      required: ["membrane", "insulation", "cover_board", "attachment", "warranty", "spec_section"],
      properties: {
        membrane: { type: ["string", "null"] }, insulation: { type: ["string", "null"] }, cover_board: { type: ["string", "null"] },
        attachment: { type: ["string", "null"] }, warranty: { type: ["string", "null"] }, spec_section: { type: ["string", "null"] },
      },
    },
    scope_notes: { type: "array", items: { type: "string" } },
  },
};

const PROMPT = `You are a senior commercial roofing estimator reading a full construction plan set (PDF).
0. From the cover sheet and title blocks, capture project name, address, project number, owner, architect, engineer, general contractor, bid due date (if printed) and total roof area.
1. Index every sheet: number, title, discipline, whether it's roof-relevant, and its drawing scale.
2. From roof plans, details, sections and specs, produce a roofing takeoff. Use the printed scale and dimensions; show your basis briefly.
   - roof_area (SF) per roof section, perimeter/edge (LF), parapet (LF), flashing (LF), drains, scuppers, curbs/RTUs, penetrations (EA, count them).
3. Confidence 0-1: high only when dimensions are printed; low when estimated from scale or unclear. Never invent values — omit anything not supported by the drawings.
4. Capture the specified roof system (membrane, insulation, cover board, attachment, warranty, spec section) and key scope notes (tapered insulation, demolition, alternates, exclusions).
Return JSON only matching the schema.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ error: "AI is not configured" }, 500);
    const auth = req.headers.get("Authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const projectId = String(body.project_id ?? ""), path = String(body.file_path ?? ""), fileName = String(body.file_name ?? "plans.pdf");
    if (!/^[0-9a-f-]{36}$/i.test(projectId) || !path) return json({ error: "project_id and file_path required" }, 400);

    // RLS-scoped check that the user can see this project
    const { data: project } = await userClient.from("commercial_projects").select("*").eq("id", projectId).maybeSingle();
    if (!project) return json({ error: "Project not found" }, 404);
    if (!path.startsWith(`${project.tenant_id}/`)) return json({ error: "Invalid file path" }, 400);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jobId = crypto.randomUUID();
    const setJob = async (patch: Record<string, unknown>) => {
      const { data: p } = await admin.from("commercial_projects").select("metadata").eq("id", projectId).single();
      const m = { ...(p?.metadata ?? {}) };
      m.plan_jobs = { ...(m.plan_jobs ?? {}), [jobId]: { ...(m.plan_jobs?.[jobId] ?? {}), ...patch, updated_at: new Date().toISOString() } };
      await admin.from("commercial_projects").update({ metadata: m }).eq("id", projectId);
    };
    await setJob({ status: "running", chunk_index: body.chunk_index ?? 0 });
    const work = (async () => {
      try {
        const r = await processPlans(admin, key, projectId, path, fileName, body);
        await setJob({ status: "done", result: r });
      } catch (e) {
        console.error(e);
        await setJob({ status: "error", error: e instanceof Error ? e.message : "Unexpected error" });
      }
    })();
    // @ts-ignore EdgeRuntime is provided by Supabase
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work); else await work;
    return json({ ok: true, job_id: jobId }, 202);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});

async function processPlans(admin: any, key: string, projectId: string, path: string, fileName: string, body: any) {
    const { data: file, error: dlErr } = await admin.storage.from("documents").download(path);
    if (dlErr || !file) throw new Error("Could not read uploaded file");
    if (file.size > 45 * 1024 * 1024) throw new Error("This part of the plan set is still too large to read.");
    const b64 = encodeBase64(new Uint8Array(await file.arrayBuffer()));

    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "fetch" },
      body: JSON.stringify({
        model: "openai/gpt-6-astra", stream: true, store: false,
        reasoning: { effort: "medium" },
        text: { format: { type: "json_schema", name: "plan_takeoff", strict: true, schema } },
        input: [{ role: "user", content: [
          { type: "input_text", text: PROMPT },
          { type: "input_file", filename: fileName, file_data: `data:application/pdf;base64,${b64}` },
        ] }],
      }),
    });
    if (!res.ok || !res.body) {
      const t = await res.text();
      const msg = res.status === 402 ? "AI credits exhausted — add credits in Settings → Plans & credits." : res.status === 429 ? "AI is busy, try again in a minute." : `AI error (${res.status}): ${t.slice(0, 200)}`;
      throw new Error(msg);
    }

    // accumulate SSE
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "", out = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const l of lines) {
        if (!l.startsWith("data:")) continue;
        try { const ev = JSON.parse(l.slice(5)); if (ev.type === "response.output_text.delta") out += ev.delta; if (ev.type === "error" || ev.type === "response.failed") throw new Error(ev.message ?? ev.response?.error?.message ?? "AI failed"); } catch (e) { if (e instanceof Error && e.message !== "Unexpected end of JSON input" && !(e instanceof SyntaxError)) throw e; }
      }
    }
    if (!out.trim()) throw new Error("The AI couldn't read this plan set (possibly scanned or refused). Try a clearer PDF.");
    const { data: project } = await admin.from("commercial_projects").select("*").eq("id", projectId).single();
    const result = JSON.parse(out);

    const rows = (result.quantities ?? []).filter((q: any) => q.value > 0).map((q: any) => ({
      tenant_id: project.tenant_id, project_id: projectId, driver: q.driver, label: q.label, value: q.value, uom: q.uom,
      roof_section: q.roof_section, source_sheet: q.source_sheet, confidence: Math.round(q.confidence * 100),
      source: "ai_plan_takeoff", scale_status: "unverified", review_status: "review_required",
      override_reason: null,
    }));
    if (rows.length) {
      const { error } = await admin.from("commercial_takeoff_quantities").insert(rows);
      if (error) throw error;
    }
    // Fill blank project fields (and placeholder names) from the title block
    const info = result.project ?? {};
    const patch: Record<string, unknown> = {};
    const fill = (col: string, v: unknown) => { if (v != null && v !== "" && (project[col] == null || project[col] === "")) patch[col] = v; };
    if (info.name && (project.metadata?.placeholder_name || !project.name)) patch.name = info.name;
    fill("address", info.address); fill("architect_name", info.architect); fill("owner_name", info.owner);
    fill("client_name", info.owner); fill("project_number", info.project_number); fill("engineer_name", info.engineer);
    fill("gc_name", info.general_contractor);
    if (info.bid_due_date && /^\d{4}-\d{2}-\d{2}$/.test(info.bid_due_date)) fill("bid_due_date", info.bid_due_date);
    const sumArea = rows.filter((r: any) => r.driver === "roof_area").reduce((a: number, r: any) => a + Number(r.value), 0);
    fill("roof_area_sf", info.total_roof_area_sf || sumArea || null);
    const meta = { ...(project.metadata ?? {}) }; delete meta.placeholder_name;
    const chunkIndex = Number(body.chunk_index ?? 0);
    const chunkCount = Number(body.chunk_count ?? 1);
    const pageRange = Array.isArray(body.page_range) ? body.page_range : null;
    const prev = (chunkIndex > 0 ? meta.plan_analysis : null) ?? {};
    const merge = (a: any[] = [], b: any[] = []) => [...a, ...b];
    const nonEmpty = (obj: any = {}, base: any = {}) => {
      const out = { ...base };
      for (const [k, v] of Object.entries(obj)) if (v != null && v !== "" && (out[k] == null || out[k] === "")) out[k] = v;
      return out;
    };
    await admin.from("commercial_projects").update({
      ...patch,
      metadata: {
        ...meta,
        plan_analysis: {
          file_name: fileName,
          file_path: String(body.source_file_path ?? path),
          analyzed_at: new Date().toISOString(),
          parts: merge(prev.parts, [{ page_range: pageRange, file_path: path, sheets: result.sheets?.length ?? 0 }]),
          part_count: chunkCount,
          sheets: merge(prev.sheets, result.sheets),
          roof_system: nonEmpty(result.roof_system, prev.roof_system),
          scope_notes: merge(prev.scope_notes, result.scope_notes),
          project_info: nonEmpty(result.project, prev.project_info),
          quantity_basis: merge(prev.quantity_basis, (result.quantities ?? []).map((q: any) => ({ label: q.label, basis: q.basis }))),
        },
      },
    }).eq("id", projectId);

    return { quantities: rows.length, sheets: result.sheets?.length ?? 0, roof_system: result.roof_system, filled: Object.keys(patch) };
}
