// Supabase Edge Function: render-liquid
// Renders full Liquid templates using LiquidJS and logs the render in smart_doc_renders.
// - Honors RLS by passing through the caller's Authorization header.
// - Accepts optional IDs (contact_id, lead_id, job_id, project_id, estimate_id) to build context.
// - Also calls `api_dynamic_tags_frequently_used` to return the curated tag list.

// Deno.serve is available in Supabase Edge Functions runtime
// Docs: https://supabase.com/docs/guides/functions/auth
import { createClient } from 'npm:@supabase/supabase-js@2'
// LiquidJS docs: https://liquidjs.com/api/classes/Liquid.html
import { Liquid } from 'npm:liquidjs@10'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type RenderPayload = {
  smart_doc_id: string
  context?: Record<string, unknown>
  contact_id?: string
  lead_id?: string
  job_id?: string
  project_id?: string
  estimate_id?: string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    // Pass Auth header through so RLS applies to all reads/writes (per Supabase docs)
    // https://supabase.com/docs/guides/functions/auth
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const body = (await req.json()) as RenderPayload
    if (!body.smart_doc_id) {
      return json({ error: 'smart_doc_id is required' }, 400)
    }

    // 1) Fetch the smart doc (body + engine)
    const { data: doc, error: docErr } = await supabase
      .from('smart_docs')
      .select('id, engine, body')
      .eq('id', body.smart_doc_id)
      .single()
    if (docErr || !doc) return json({ error: 'Doc not found', details: docErr }, 404)

    // 2) Build render context (merge explicit context + fetched objects)
    let ctx: Record<string, unknown> = { ...(body.context ?? {}) }

    // Helper to merge a named object into ctx safely
    const merge = (k: string, v: any) => {
      if (v && typeof v === 'object') ctx[k] = v
    }

    // Fetch objects only if ids provided (RLS enforced)
    if (body.contact_id) {
      const { data, error } = await supabase.from('contacts').select('*').eq('id', body.contact_id).single()
      if (!error && data) merge('contact', scrubTenant(data))
    }
    if (body.lead_id) {
      const { data, error } = await supabase.from('leads').select('*').eq('id', body.lead_id).single()
      if (!error && data) merge('lead', scrubTenant(data))
    }
    if (body.job_id) {
      const { data, error } = await supabase.from('jobs').select('*').eq('id', body.job_id).single()
      if (!error && data) merge('job', scrubTenant(data))
    }
    // project: look up directly or infer by job_id
    if (body.project_id) {
      const { data, error } = await supabase.from('projects').select('*').eq('id', body.project_id).single()
      if (!error && data) merge('project', scrubTenant(data))
    } else if (body.job_id) {
      const { data, error } = await supabase.from('projects').select('*').eq('job_id', body.job_id).single()
      if (!error && data) merge('project', scrubTenant(data))
    }
    if (body.estimate_id) {
      const { data, error } = await supabase.from('estimates').select('*').eq('id', body.estimate_id).single()
      if (!error && data) merge('estimate', scrubTenant(data))
    }

    // 3) Render with LiquidJS
    const engine = new Liquid({ cache: false, jsTruthy: true, strictVariables: false, strictFilters: false })
    const rendered_text = await engine.parseAndRender(doc.body, ctx) // https://liquidjs.com/api/classes/Liquid.html#parseAndRender

    // Extract variables referenced by the template (best-effort)
    // liquidjs exposes analysis helpers to discover variables (v10+)
    let referenced: string[] = []
    try {
      const parsed = engine.parse(doc.body)
      // @ts-ignore - type name may be LiquidEngine fullVariables in newer versions
      referenced = (await engine.fullVariables(parsed)) as string[]
    } catch {
      // fallback: naive regex for {{ ... }}
      referenced = [...new Set(Array.from(doc.body.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)).map(m => m[1].trim()))]
    }

    const unresolved = referenced.filter(path => getByPath(ctx, path) === undefined)
    const resolved_count = referenced.length - unresolved.length

    // 4) Persist render in smart_doc_renders (RLS insert)
    // Ensure tenant_id default exists (see seed migration). If not, you can pass tenant_id explicitly.
    await supabase
      .from('smart_doc_renders')
      .insert({
        smart_doc_id: body.smart_doc_id,
        context: ctx,
        rendered_text,
        unresolved_tokens: unresolved,
        resolved_count,
      })

    // 5) Also fetch curated tags (optional, for UI)
    const { data: tags } = await supabase.rpc('api_dynamic_tags_frequently_used', { p_limit: 200 })

    return json(
      {
        smart_doc_id: body.smart_doc_id,
        rendered_text,
        unresolved_tokens: unresolved,
        resolved_count,
        available_tags: tags ?? [],
      },
      200,
    )
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})

// Helpers
function scrubTenant<T extends Record<string, unknown>>(obj: T): T {
  const clone: any = { ...obj }
  delete clone.tenant_id
  return clone
}

function getByPath(obj: any, path: string): any {
  // Supports dot access only, e.g., contact.name_first
  return path.split('.').reduce((acc: any, key: string) => (acc && typeof acc === 'object' ? acc[key] : undefined), obj)
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
