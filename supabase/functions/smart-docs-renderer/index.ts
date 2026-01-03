// smart-docs-renderer/index.ts
// Renders Liquid templates from DB with context built by RPC.
// Supports company branding and smart tag overrides.
import { Liquid } from 'npm:liquidjs@10'
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const engine = new Liquid({
  cache: false,
  jsTruthy: true,
  strictFilters: false
})

// Built-in filters
engine.registerFilter('currency', (v: any) => {
  const n = Number(v || 0)
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
})
engine.registerFilter('default', (v: any, d: any) => (v === null || v === undefined || v === '' ? d : v))
engine.registerFilter('phone', (v: any) => {
  if (!v) return ''
  const cleaned = String(v).replace(/\D/g, '')
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
  }
  return v
})
engine.registerFilter('date_format', (v: any, format: string) => {
  if (!v) return ''
  try {
    const d = new Date(v)
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return v
  }
})

interface CompanySettings {
  company_name?: string;
  company_logo_url?: string;
  company_address?: string;
  company_phone?: string;
  company_email?: string;
  company_license?: string;
  primary_color?: string;
  accent_color?: string;
  custom_header_html?: string;
  custom_footer_html?: string;
  default_terms?: string;
  warranty_text?: string;
}

async function getCompanySettings(
  supabase: any,
  tenantId: string,
  locationId?: string,
  templateSlug?: string
): Promise<CompanySettings> {
  // Try to get location-specific settings first
  if (locationId && templateSlug) {
    const { data: locationSettings } = await supabase
      .from('company_template_settings')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('location_id', locationId)
      .eq('template_slug', templateSlug)
      .eq('is_active', true)
      .maybeSingle()
    
    if (locationSettings) return locationSettings
  }

  // Try tenant-wide settings for this template
  if (templateSlug) {
    const { data: templateSettings } = await supabase
      .from('company_template_settings')
      .select('*')
      .eq('tenant_id', tenantId)
      .is('location_id', null)
      .eq('template_slug', templateSlug)
      .eq('is_active', true)
      .maybeSingle()
    
    if (templateSettings) return templateSettings
  }

  // Fall back to default tenant settings (no template slug)
  const { data: defaultSettings } = await supabase
    .from('company_template_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('location_id', null)
    .is('template_slug', null)
    .eq('is_active', true)
    .maybeSingle()

  if (defaultSettings) return defaultSettings

  // Ultimate fallback: get from tenant table
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, settings, logo_url')
    .eq('id', tenantId)
    .maybeSingle()

  return {
    company_name: tenant?.name,
    company_logo_url: tenant?.logo_url,
    company_phone: tenant?.settings?.phone,
    company_email: tenant?.settings?.email,
    company_address: tenant?.settings?.address,
    company_license: tenant?.settings?.license_number,
    primary_color: tenant?.settings?.primary_color || '#2563eb',
    accent_color: tenant?.settings?.accent_color || '#1e40af'
  }
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'POST only' }, 405)
  }

  const { 
    template_id, 
    slug, 
    lead_id, 
    job_id, 
    project_id,
    contact_id,
    location_id,
    extra, 
    tag_overrides,
    save_instance = false, 
    title_override, 
    format = 'html',
    preview_mode = false 
  } = await body(req)

  if (!template_id && !slug) {
    return json({ error: 'template_id or slug required' }, 400)
  }

  // Use user's token for RLS if provided
  const userAuth = req.headers.get('Authorization') || ''
  const useService = (Deno.env.get('ALLOW_SERVICE') ?? '1') === '1' && !userAuth
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    (useService ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') : Deno.env.get('SUPABASE_ANON_KEY')) ?? '',
    { global: { headers: userAuth ? { Authorization: userAuth } : {} } }
  )

  // Fetch template
  let tmpl: any
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

  // Get tenant ID from user profile
  let tenantId: string | null = null
  if (userAuth) {
    const token = userAuth.replace('Bearer ', '')
    const { data: { user } } = await supabase.auth.getUser(token)
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .maybeSingle()
      tenantId = profile?.tenant_id
    }
  }

  // Fetch company settings for branding
  let companySettings: CompanySettings = {}
  if (tenantId) {
    companySettings = await getCompanySettings(supabase, tenantId, location_id, slug || tmpl.slug)
  }

  // Build context via RPC
  const { data: ctx, error: ctxErr } = await supabase.rpc('api_smartdoc_build_context', {
    p_lead_id: lead_id ?? null,
    p_job_id: job_id ?? null,
    p_extra: extra ?? {}
  })
  if (ctxErr) return json({ error: ctxErr.message }, 400)

  // Merge company settings into context
  const enrichedContext = {
    ...(ctx || {}),
    company: {
      name: companySettings.company_name || ctx?.company?.name,
      logo_url: companySettings.company_logo_url || ctx?.company?.logo_url,
      address: companySettings.company_address || ctx?.company?.address,
      phone: companySettings.company_phone || ctx?.company?.phone,
      email: companySettings.company_email || ctx?.company?.email,
      license: companySettings.company_license || ctx?.company?.license,
      primary_color: companySettings.primary_color || '#2563eb',
      accent_color: companySettings.accent_color || '#1e40af'
    },
    branding: {
      primary_color: companySettings.primary_color || '#2563eb',
      accent_color: companySettings.accent_color || '#1e40af',
      header_html: companySettings.custom_header_html || '',
      footer_html: companySettings.custom_footer_html || ''
    },
    terms: companySettings.default_terms || ctx?.terms,
    warranty: companySettings.warranty_text || ctx?.warranty,
    today: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    current_year: new Date().getFullYear()
  }

  // Apply tag overrides if provided (for smart tag editing)
  let finalContext = enrichedContext
  if (tag_overrides && typeof tag_overrides === 'object') {
    finalContext = deepMerge(enrichedContext, tag_overrides)
  }

  // In preview mode, wrap tags with editable markers
  let templateContent = String(tmpl.content)
  if (preview_mode) {
    // Add data attributes to make tags clickable in preview
    templateContent = templateContent.replace(
      /\{\{([^}]+)\}\}/g, 
      '<span class="smart-tag" data-tag="$1">{{$1}}</span>'
    )
  }

  const html = await engine.parseAndRender(templateContent, finalContext)

  // Extract all tags used in template for the tag panel
  const tagsUsed = extractTags(String(tmpl.content))

  let instance_id: string | null = null
  if (save_instance && !preview_mode) {
    const title = title_override || tmpl.title
    const { data, error } = await supabase
      .from('smart_doc_instances')
      .insert({ 
        template_id: tmpl.id, 
        title, 
        rendered_html: html, 
        lead_id: lead_id ?? null, 
        job_id: job_id ?? null,
        project_id: project_id ?? null,
        contact_id: contact_id ?? null,
        context_snapshot: finalContext
      })
      .select('id')
      .single()
    if (!error) instance_id = data.id
  }

  return json({ 
    html, 
    instance_id,
    tags_used: tagsUsed,
    context: preview_mode ? finalContext : undefined
  })
})

function extractTags(content: string): string[] {
  const tagPattern = /\{\{([^}]+)\}\}/g
  const tags: string[] = []
  let match
  while ((match = tagPattern.exec(content)) !== null) {
    const tag = match[1].trim()
    if (!tags.includes(tag)) {
      tags.push(tag)
    }
  }
  return tags
}

function deepMerge(target: any, source: any): any {
  const result = { ...target }
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}

async function body(req: Request): Promise<any> {
  try { return await req.json() } catch { return {} }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { 
    status, 
    headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
  })
}
