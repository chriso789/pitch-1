// qbo-worker/index.ts — unified ops (4): syncProject, createInvoiceFromEstimates, toggleOnlinePayments, setLocation
import { createClient } from 'npm:@supabase/supabase-js@2'

type Json = Record<string, any>

const USE_SANDBOX = (Deno.env.get('USE_SANDBOX') ?? '1') === '1'
const QBO_REST_BASE = USE_SANDBOX ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com'
const QBO_GRAPHQL_BASE = USE_SANDBOX ? 'https://qb-sandbox.api.intuit.com/graphql' : 'https://qb.api.intuit.com/graphql'
const MINOR_VERSION = 75

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return resp({ error: 'POST only' }, 405)
  const { op, args } = await parseBody(req)
  try {
    if (op === 'syncProject') return resp(await syncProject(args))
    if (op === 'createInvoiceFromEstimates') return resp(await createInvoiceFromEstimates(args))
    if (op === 'toggleOnlinePayments') return resp(await toggleOnlinePayments(args))
    if (op === 'setLocation') return resp(await setLocation(args))
    return resp({ error: 'Unknown op' }, 400)
  } catch (e) {
    return resp({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

async function syncProject(args: Json) {
  const { tenant_id, realm_id, customer_id, job_id, job_name, mode = 'auto' } = args
  const token = await accessToken(tenant_id, realm_id)

  // Preferences precheck
  const prefs = await qboGET(token, `/v3/company/${realm_id}/preferences`)
  const projectsEnabled = !!prefs?.Preferences?.OtherPrefs?.find?.((p: any) => p?.Name === 'ProjectsEnabled' && p?.Value === 'true')

  // GraphQL project if enabled + scope present
  const hasGraphQL = await hasScope(tenant_id, realm_id, 'project-management.project')
  if (mode !== 'force-fallback' && projectsEnabled && hasGraphQL) {
    try {
      const g = await graphql(token, `
        mutation CreateProject($input: ProjectManagementCreateProjectInput!) {
          projectManagementCreateProject(input: $input) { project { id name } }
        }
      `, { input: { name: job_name ?? `Job ${job_id ?? ''}`, customerId: customer_id } })
      const id = g?.data?.projectManagementCreateProject?.project?.id
      if (id) return { project_id: id, customer_ref: customer_id, job_ref: id }
    } catch (_) { /* fall back below */ }
  }

  // Fallback: sub-customer
  const sub = await qboPOST(token, `/v3/company/${realm_id}/customer`, {
    FullyQualifiedName: job_name ?? `Job ${job_id ?? ''}`,
    DisplayName: job_name ?? `Job ${job_id ?? ''}`,
    BillWithParent: false,
    ParentRef: { value: customer_id }
  })
  const subId = sub?.Customer?.Id
  return { sub_customer_id: subId, customer_ref: customer_id, job_ref: subId }
}

async function createInvoiceFromEstimates(args: Json) {
  const { tenant_id, realm_id, job_id, customer_ref, department_id, lines_override } = args
  const token = await accessToken(tenant_id, realm_id)

  const map = await jobMap(tenant_id, realm_id)
  const Lines = (lines_override ?? []).map((l: any) => ({
    Amount: Number(l.amount),
    DetailType: 'SalesItemLineDetail',
    Description: l.description ?? l.job_type_code,
    SalesItemLineDetail: {
      ItemRef: { value: map[l.job_type_code]?.qbo_item_id },
      ...(l.class_id ? { ClassRef: { value: l.class_id } } : {})
    }
  }))

  const inv = await qboPOST(token, `/v3/company/${realm_id}/invoice`, {
    Line: Lines,
    CustomerRef: { value: customer_ref },
    DepartmentRef: department_id ? { value: department_id } : undefined,
    PrivateNote: `Job ${job_id}`
  })

  const id = inv?.Invoice?.Id, doc = inv?.Invoice?.DocNumber, total = inv?.Invoice?.TotalAmt, bal = inv?.Invoice?.Balance
  await supabase.rpc('api_qbo_map_job_invoice', { p_job_id: job_id, p_realm_id: realm_id, p_qbo_invoice_id: id, p_doc_number: doc })
  await supabase.rpc('api_qbo_update_invoice_mirror', { p_realm_id: realm_id, p_qbo_invoice_id: id, p_doc_number: doc, p_total: total ?? 0, p_balance: bal ?? 0 })
  return { qbo_invoice_id: id, doc_number: doc, total, balance: bal }
}

async function toggleOnlinePayments(args: Json) {
  const { tenant_id, realm_id, qbo_invoice_id, allow_credit_card = true, allow_ach = true, send_email = false, send_to } = args
  const token = await accessToken(tenant_id, realm_id)

  const inv = await qboGET(token, `/v3/company/${realm_id}/invoice/${qbo_invoice_id}`)
  const SyncToken = inv?.Invoice?.SyncToken

  await qboPOST(token, `/v3/company/${realm_id}/invoice?minorversion=${MINOR_VERSION}`, {
    Id: qbo_invoice_id, SyncToken,
    AllowOnlineCreditCardPayment: !!allow_credit_card,
    AllowOnlineACHPayment: !!allow_ach,
    sparse: true
  })

  if (send_email) {
    const p = `/v3/company/${realm_id}/invoice/${qbo_invoice_id}/send${send_to ? `?sendTo=${encodeURIComponent(send_to)}` : ''}`
    await qboPOST(token, p, null)
  }
  return { ok: true }
}

async function setLocation(args: Json) {
  const { location_id } = args
  const { data, error } = await supabase.rpc('api_set_active_location', { p_location_id: location_id })
  if (error) throw error
  return { active_location_id: data?.[0]?.active_location_id ?? location_id }
}

// ---------- Helpers ----------
async function accessToken(tenant_id: string, realm_id: string): Promise<string> {
  const { data, error } = await supabase.from('qbo_connections').select('access_token, refresh_token, expires_at, scopes').eq('tenant_id', tenant_id).eq('realm_id', realm_id).maybeSingle()
  if (error || !data) throw new Error('QBO connection not found')
  const exp = new Date(data.expires_at).getTime()
  if (Date.now() < exp - 60_000) return data.access_token
  const tok = await refresh(data.refresh_token)
  await supabase.rpc('api_qbo_set_connection', {
    p_realm_id: realm_id,
    p_access_token: tok.access_token,
    p_refresh_token: tok.refresh_token ?? data.refresh_token,
    p_expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    p_scopes: tok.scope ? tok.scope.split(' ') : data.scopes
  })
  return tok.access_token
}

async function refresh(refresh_token: string) {
  const basic = btoa(`${Deno.env.get('QBO_CLIENT_ID')}:${Deno.env.get('QBO_CLIENT_SECRET')}`)
  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token })
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`QBO refresh ${res.status}: ${JSON.stringify(json)}`)
  return json
}

async function hasScope(tenant_id: string, realm_id: string, scope: string) {
  const { data } = await supabase.from('qbo_connections').select('scopes').eq('tenant_id', tenant_id).eq('realm_id', realm_id).maybeSingle()
  return !!data?.scopes?.includes?.(scope)
}

async function jobMap(tenant_id: string, realm_id: string) {
  const { data, error } = await supabase.from('job_type_item_map').select('job_type_code, qbo_item_id, qbo_class_id').eq('tenant_id', tenant_id).eq('realm_id', realm_id)
  if (error) throw error
  const m: Record<string, any> = {}; for (const r of data ?? []) m[r.job_type_code] = r; return m
}

async function graphql(accessToken: string, query: string, variables?: Json) {
  const res = await fetch(QBO_GRAPHQL_BASE, { method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`GraphQL ${res.status}: ${JSON.stringify(json)}`)
  return json
}

async function qboGET(accessToken: string, path: string) {
  const url = `${QBO_REST_BASE}${path}${path.includes('?') ? '&' : '?'}minorversion=${MINOR_VERSION}`
  const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`QBO GET ${res.status}: ${JSON.stringify(json)}`)
  return json
}

async function qboPOST(accessToken: string, path: string, body: any) {
  const url = `${QBO_REST_BASE}${path}${path.includes('?') ? '&' : '?'}minorversion=${MINOR_VERSION}`
  const res = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let json: any; try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!res.ok) throw new Error(`QBO POST ${res.status}: ${JSON.stringify(json)}`)
  return json
}

async function parseBody(req: Request) { try { return await req.json() } catch { return {} } }
function resp(body: any, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) }
