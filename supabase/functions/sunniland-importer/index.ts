// sunniland-importer/index.ts
// Secured importer for Sunniland FL items with JWT auth, role checks, validation, and rate limiting
import { createClient } from 'npm:@supabase/supabase-js@2'

type Json = Record<string, any>

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Rate limiting: max 10 imports per hour per user
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MINUTES = 60

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return resp({ error: 'POST only' }, 405)
  }

  try {
    // 1. JWT Authentication - Extract and verify user
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return resp({ error: 'Missing or invalid authorization header' }, 401)
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      console.error('Auth error:', authError?.message)
      return resp({ error: 'Invalid or expired token' }, 401)
    }

    // 2. Role-based Authorization - Only master/corporate/office_admin can import
    const { data: userRoles, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)

    if (roleError) {
      console.error('Role check error:', roleError.message)
      return resp({ error: 'Failed to verify user permissions' }, 500)
    }

    const allowedRoles = ['master', 'corporate', 'office_admin']
    const userRoleList = userRoles?.map(r => r.role) || []
    const hasPermission = userRoleList.some(role => allowedRoles.includes(role))

    if (!hasPermission) {
      console.warn(`Unauthorized import attempt by user ${user.id} with roles: ${userRoleList.join(', ')}`)
      return resp({ error: 'Insufficient permissions. Admin access required.' }, 403)
    }

    // 3. Rate Limiting - Check recent imports
    const { count: recentImports, error: rateLimitError } = await supabase
      .from('api_rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('endpoint', 'sunniland-importer')
      .gte('created_at', new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString())

    if (rateLimitError) {
      console.error('Rate limit check error:', rateLimitError.message)
    }

    if ((recentImports ?? 0) >= RATE_LIMIT_MAX) {
      console.warn(`Rate limit exceeded for user ${user.id}`)
      return resp({ 
        error: `Rate limit exceeded. Maximum ${RATE_LIMIT_MAX} imports per hour.`,
        retry_after_minutes: RATE_LIMIT_WINDOW_MINUTES
      }, 429)
    }

    // Get user's tenant_id for logging
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    const tenantId = profile?.tenant_id

    // Record this request for rate limiting
    if (tenantId) {
      await supabase.from('api_rate_limits').insert({
        user_id: user.id,
        tenant_id: tenantId,
        endpoint: 'sunniland-importer'
      })
    }

    // 4. Input Validation
    let body: Json = {}
    try { 
      body = await req.json() 
    } catch { 
      return resp({ error: 'Invalid JSON body' }, 400)
    }

    const { items, storage_path, delimiter = ',' } = body

    // Validate input structure
    if (!items && !storage_path) {
      return resp({ error: 'Provide either items[] or storage_path' }, 400)
    }

    if (items && !Array.isArray(items)) {
      return resp({ error: 'items must be an array' }, 400)
    }

    if (items && items.length > 1000) {
      return resp({ error: 'Maximum 1000 items per import' }, 400)
    }

    if (storage_path && typeof storage_path !== 'string') {
      return resp({ error: 'storage_path must be a string' }, 400)
    }

    if (storage_path && !storage_path.match(/^[\w\-./]+\.(csv|tsv)$/i)) {
      return resp({ error: 'Invalid storage_path format. Must be a .csv or .tsv file path.' }, 400)
    }

    let rows: any[] = []
    if (Array.isArray(items)) {
      rows = items
    } else if (storage_path) {
      // Download file, split lines, parse simple CSV/TSV
      const { data, error } = await supabase.storage.from('imports').download(storage_path)
      if (error) {
        console.error('Storage download error:', error.message)
        return resp({ error: `Download failed: ${error.message}` }, 400)
      }
      const text = await data.text()
      const lines = text.split(/\r?\n/).filter(Boolean)
      
      if (lines.length === 0) {
        return resp({ error: 'Empty file' }, 400)
      }
      
      if (lines.length > 1001) { // header + 1000 rows
        return resp({ error: 'Maximum 1000 rows per file import' }, 400)
      }

      const header = lines.shift()?.split(delimiter) ?? []
      
      // Validate header has required columns
      const headerLower = header.map(h => h.trim().toLowerCase())
      if (!headerLower.some(h => ['sku', 'itemcode', 'item_code'].includes(h))) {
        return resp({ error: 'File must contain SKU or ItemCode column' }, 400)
      }

      for (const line of lines) {
        const cells = line.split(delimiter)
        const obj: any = {}
        header.forEach((h, i) => obj[h.trim()] = (cells[i] ?? '').trim())
        rows.push(obj)
      }
    }

    // Validate each row has minimum required data
    const validatedRows = rows.filter(r => {
      const sku = r.sku ?? r.SKU ?? r.ItemCode ?? r.item_code
      return sku && typeof sku === 'string' && sku.trim().length > 0
    })

    if (validatedRows.length === 0) {
      return resp({ error: 'No valid items found. Each item must have a SKU.' }, 400)
    }

    // Normalize to API contract for api_supplier_items_upsert
    const normalized = validatedRows.map((r: any) => ({
      sku: sanitizeString(r.sku ?? r.SKU ?? r.ItemCode ?? crypto.randomUUID()),
      brand: sanitizeString(r.brand ?? r.Brand ?? r.Manufacturer ?? null),
      model: sanitizeString(r.model ?? r.Model ?? r.Style ?? null),
      description: sanitizeString(r.description ?? r.Description ?? r.Item ?? ''),
      category: mapCategory(r.category ?? r.Category ?? r.Family ?? r.Subcategory),
      uom: mapUom(r.uom ?? r.UOM ?? r.Unit ?? 'EA'),
      package_size: sanitizeString(r.package_size ?? r.Package ?? r.Pack ?? null),
      coverage_per_unit: num(r.coverage_per_unit ?? r.Coverage),
      base_price: num(r.price ?? r.BasePrice ?? r.UnitPrice),
      price_effective_date: r.price_effective_date ?? r.EffectiveDate ?? null,
      tax_class: (sanitizeString(r.tax_class) ?? 'TAXABLE').toUpperCase(),
      attributes: pickAttrs(r)
    }))

    const { data: count, error: upErr } = await supabase.rpc('api_supplier_items_upsert', { p_items: normalized })
    
    if (upErr) {
      console.error('Upsert error:', upErr.message)
      return resp({ error: `Import failed: ${upErr.message}` }, 500)
    }

    // Log successful import to audit log
    if (tenantId) {
      await supabase.from('audit_log').insert({
        tenant_id: tenantId,
        changed_by: user.id,
        table_name: 'supplier_items',
        record_id: 'bulk_import',
        action: 'BULK_IMPORT',
        new_values: {
          imported_count: count ?? normalized.length,
          source: storage_path ? 'file' : 'api',
          timestamp: new Date().toISOString()
        }
      })
    }

    console.log(`Import completed by user ${user.id}: ${count ?? normalized.length} items`)

    return resp({ 
      ok: true, 
      imported: count ?? normalized.length,
      skipped: rows.length - validatedRows.length
    })

  } catch (err) {
    console.error('Unexpected error:', err)
    return resp({ error: 'Internal server error' }, 500)
  }
})

function resp(body: any, status = 200) {
  return new Response(JSON.stringify(body), { 
    status, 
    headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
  })
}

// Sanitize string input to prevent injection
function sanitizeString(v: any): string | null {
  if (v === null || v === undefined) return null
  const str = String(v).trim()
  // Remove potentially dangerous characters
  return str.replace(/[<>\"'`;]/g, '').substring(0, 500)
}

function num(v: any) { 
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 1000000 ? n : null 
}

function mapUom(v: string) {
  const s = (v || '').toUpperCase()
  if (['LF','LFT','L/F','L-FT'].includes(s)) return 'LF'
  if (['SF','SFT','SQFT'].includes(s)) return 'SF'
  if (['SQ','SQUARE'].includes(s)) return 'SQ'
  if (['EA','EACH','UNIT'].includes(s)) return 'EA'
  if (['HR','HOUR','HRS'].includes(s)) return 'HR'
  if (['ROLL','RL'].includes(s)) return 'ROLL'
  if (['BDL','BUNDLE'].includes(s)) return 'BDL'
  if (['CTN','CARTON','CASE'].includes(s)) return 'CTN'
  return 'EA'
}

function mapCategory(v: string) {
  const s = (v || '').toLowerCase()
  if (s.includes('asphalt') || s.includes('shingle')) return 'asphalt_shingle'
  if (s.includes('tile')) return 'concrete_tile'
  if (s.includes('worthouse') || s.includes('stone')) return 'stone_coated_steel'
  if (s.includes('standing') || s.includes('hidden')) return 'metal_hidden'
  if (s.includes('r-panel') || s.includes('exposed')) return 'metal_exposed'
  if (s.includes('underlay') || s.includes('membrane') || s.includes('felt')) return 'underlayment'
  if (s.includes('vent')) return 'vent'
  if (s.includes('flash') || s.includes('valley') || s.includes('drip')) return 'flashing'
  return 'accessories'
}

function pickAttrs(r: any) {
  const keep = ['Color','Finish','Gauge','Length','Width','Profile','Thickness','UL','ASTM','Warranty','Region']
  const out: any = {}
  for (const k of Object.keys(r || {})) {
    if (keep.includes(k)) {
      const val = sanitizeString(r[k])
      if (val) out[k] = val
    }
  }
  return out
}
