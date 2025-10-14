// smart-docs-renderer/index.ts
// Renders Liquid templates from DB with context built by RPC.
// Uses the caller's Authorization header for RLS; falls back to service role only if ALLOW_SERVICE=1.
import { Liquid } from 'npm:liquidjs@10'
import { createClient } from 'npm:@supabase/supabase-js@2'

const engine = new Liquid({
  cache: false,
  jsTruthy: true,
  strictFilters: false
})

// basic filters
engine.registerFilter('currency', (v: any) => {
  const n = Number(v || 0)
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
})
engine.registerFilter('default', (v: any, d: any) => (v === null || v === undefined || v === '' ? d : v))

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const { template_id, slug, lead_id, job_id, extra, save_instance = false, title_override, format = 'html' } = await body(req)
  if (!template_id && !slug) return json({ error: 'template_id or slug required' }, 400)

  // Use user's token for RLS if provided
  const userAuth = req.headers.get('Authorization') || ''
  const useService = (Deno.env.get('ALLOW_SERVICE') ?? '1') === '1' && !userAuth
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    (useService ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') : Deno.env.get('SUPABASE_ANON_KEY')) ?? '',
    { global: { headers: userAuth ? { Authorization: userAuth } : {} } }
  )

  // Fetch template
  let tmpl
  if (template_id) {
    const { data, error } = await supabase.rpc('api_smartdoc_templates_get', { p_id: template_id })
    if (error) return json({ error: error.message }, 400)
    tmpl = data
  } else {
    const { data, error } = await supabase
      .from('smart_doc_templates')
      .select('*')
      .eq('slug', slug)
      .maybeSingle()
    if (error || !data) return json({ error: 'Template not found' }, 404)
    tmpl = data
  }

  // Build context via RPC
  const { data: ctx, error: ctxErr } = await supabase.rpc('api_smartdoc_build_context', {
    p_lead_id: lead_id ?? null,
    p_job_id: job_id ?? null,
    p_extra: extra ?? {}
  })
  if (ctxErr) return json({ error: ctxErr.message }, 400)

  const html = await engine.parseAndRender(String(tmpl.content), ctx || {})

  let instance_id: string | null = null
  if (save_instance) {
    const title = title_override || tmpl.title
    const { data, error } = await supabase
      .from('smart_doc_instances')
      .insert({ template_id: tmpl.id, title, rendered_html: html, lead_id: lead_id ?? null, job_id: job_id ?? null })
      .select('id')
      .single()
    if (!error) instance_id = data.id
  }

  return json({ html, instance_id })
})

async function body(req: Request): Promise<any> {
  try { return await req.json() } catch { return {} }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}
