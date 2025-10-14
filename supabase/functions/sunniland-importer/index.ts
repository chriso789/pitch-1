// sunniland-importer/index.ts
// Accepts a JSON array or a CSV/TSV path in Supabase Storage to import Sunniland FL items.
// Usage: POST with { items: [...]} OR { storage_path: "imports/sunniland_2025.csv", delimiter: "," }
import { createClient } from 'npm:@supabase/supabase-js@2'

type Json = Record<string, any>

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return resp({ error: 'POST only' }, 405)
  let body: Json = {}
  try { body = await req.json() } catch { /* noop */ }

  const { items, storage_path, delimiter = ',' } = body

  let rows: any[] = []
  if (Array.isArray(items)) {
    rows = items
  } else if (storage_path) {
    // Download file, split lines, parse simple CSV/TSV (no quotes handling for simplicity)
    const { data, error } = await supabase.storage.from('imports').download(storage_path)
    if (error) return resp({ error: `Download failed: ${error.message}` }, 400)
    const text = await data.text()
    const lines = text.split(/\r?\n/).filter(Boolean)
    const header = lines.shift()?.split(delimiter) ?? []
    for (const line of lines) {
      const cells = line.split(delimiter)
      const obj: any = {}
      header.forEach((h, i) => obj[h.trim()] = (cells[i] ?? '').trim())
      rows.push(obj)
    }
  } else {
    return resp({ error: 'Provide either items[] or storage_path' }, 400)
  }

  // Normalize to API contract for api_supplier_items_upsert
  const normalized = rows.map((r: any) => ({
    sku: r.sku ?? r.SKU ?? r.ItemCode ?? crypto.randomUUID(),
    brand: r.brand ?? r.Brand ?? r.Manufacturer ?? null,
    model: r.model ?? r.Model ?? r.Style ?? null,
    description: r.description ?? r.Description ?? r.Item ?? '',
    category: mapCategory(r.category ?? r.Category ?? r.Family ?? r.Subcategory),
    uom: mapUom(r.uom ?? r.UOM ?? r.Unit ?? 'EA'),
    package_size: r.package_size ?? r.Package ?? r.Pack ?? null,
    coverage_per_unit: num(r.coverage_per_unit ?? r.Coverage),
    base_price: num(r.price ?? r.BasePrice ?? r.UnitPrice),
    price_effective_date: r.price_effective_date ?? r.EffectiveDate ?? null,
    tax_class: (r.tax_class ?? 'TAXABLE').toUpperCase(),
    attributes: pickAttrs(r)
  }))

  const { data: count, error: upErr } = await supabase.rpc('api_supplier_items_upsert', { p_items: normalized })
  if (upErr) return resp({ error: upErr.message }, 500)

  return resp({ ok: true, imported: count ?? normalized.length })
})

function resp(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function num(v: any) { const n = Number(v); return Number.isFinite(n) ? n : null }
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
    if (keep.includes(k)) out[k] = r[k]
  }
  return out
}
