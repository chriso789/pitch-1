import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BEACON_BASE_URL = 'https://api.becn.com';

// ---------- Beacon helpers ----------

async function login(conn: any) {
  const res = await fetch(`${BEACON_BASE_URL}/v1/rest/com/becn/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: conn.username,
      password: conn.password,
      siteId: conn.site_id || 'dealersChoice',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Login failed (${res.status})`);
  // Beacon returns 200 even on bad credentials; detect in-body error strings
  const info = data?.messageInfo;
  if (typeof info === 'string') throw new Error(`Beacon login rejected: ${info}`);
  if (data?.error || data?.errorMessage) {
    throw new Error(`Beacon login rejected: ${data.error || data.errorMessage}`);
  }
  if (!info?.profileId && !info?.lastSelectedAccount) {
    throw new Error(`Beacon login returned no profile (check username/password/site). Raw: ${JSON.stringify(data).slice(0, 200)}`);
  }
  const setCookie = res.headers.get('set-cookie') || '';
  return { data, cookie: setCookie };
}

async function beaconGet(path: string, cookie: string) {
  const res = await fetch(`${BEACON_BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: cookie,
    },
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`Beacon GET ${path} failed [${res.status}]: ${typeof data === 'string' ? data : JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

// ---------- Per-tenant sync ----------

type SyncResult = {
  tenant_id: string;
  profile?: { ok: boolean; error?: string };
  balance?: { ok: boolean; error?: string };
  invoices?: { ok: boolean; count?: number; error?: string };
};

function pickInvoiceStatus(raw: any): string {
  const s = (raw?.status || raw?.invoiceStatus || raw?.paymentStatus || '').toString().toLowerCase();
  if (s.includes('paid') && s.includes('part')) return 'partial';
  if (s.includes('paid')) return 'paid';
  if (s.includes('credit')) return 'credit';
  if (s.includes('open') || s.includes('unpaid') || s.includes('outstanding')) return 'open';
  // Fallback: if balance > 0 -> open, else paid
  const bal = Number(raw?.balance ?? raw?.openAmount ?? 0);
  return bal > 0 ? 'open' : 'paid';
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function dateOnly(v: any): string | null {
  if (!v) return null;
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch { return null; }
}

async function logRun(supabase: any, tenant_id: string, kind: string) {
  const { data } = await supabase
    .from('qxo_sync_runs')
    .insert({ tenant_id, kind, status: 'running' })
    .select('id')
    .single();
  return data?.id as string | undefined;
}

async function finishRun(supabase: any, id: string | undefined, status: 'success' | 'error', records = 0, error?: string) {
  if (!id) return;
  await supabase
    .from('qxo_sync_runs')
    .update({ status, records_upserted: records, error: error || null, finished_at: new Date().toISOString() })
    .eq('id', id);
}

async function syncProfile(supabase: any, conn: any, loginData: any) {
  const runId = await logRun(supabase, conn.tenant_id, 'profile');
  try {
    const info = loginData?.messageInfo || {};
    const acct = info?.lastSelectedAccount || info?.selectedAccount || {};
    const branch = info?.lastSelectedBranch || info?.selectedBranch || {};
    const profileId = info?.profileId || null;
    const accountId = acct?.accountId || acct?.id || null;
    const accountName = acct?.accountName || acct?.name || null;
    const branchCode = branch?.branchCode || branch?.code || null;
    const branchName = branch?.branchName || branch?.name || null;

    await supabase.from('qxo_account_profile').upsert(
      {
        tenant_id: conn.tenant_id,
        account_id: accountId,
        profile_id: profileId,
        account_name: accountName,
        default_branch_code: branchCode,
        default_branch_name: branchName,
        raw_payload: info,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' },
    );

    // Mirror onto qxo_connections for the existing UI card
    await supabase
      .from('qxo_connections')
      .update({
        profile_id: profileId,
        account_id: accountId,
        default_branch_code: branchCode,
      })
      .eq('id', conn.id);

    await finishRun(supabase, runId, 'success', 1);
    return { ok: true };
  } catch (e: any) {
    await finishRun(supabase, runId, 'error', 0, e.message);
    return { ok: false, error: e.message };
  }
}

async function syncBalance(supabase: any, conn: any, cookie: string) {
  const runId = await logRun(supabase, conn.tenant_id, 'balance');
  try {
    // Beacon AR endpoints — best-effort common paths. Adjust here if your account uses different ones.
    const candidates = [
      `/v1/rest/com/becn/account/${conn.account_id || ''}/balance`,
      `/v1/rest/com/becn/account/balance`,
      `/v1/rest/com/becn/ar/balance`,
    ].filter((p) => !p.endsWith('//balance'));

    let payload: any = null;
    let lastErr: string | null = null;
    for (const p of candidates) {
      try { payload = await beaconGet(p, cookie); break; } catch (e: any) { lastErr = e.message; }
    }
    if (!payload) throw new Error(lastErr || 'No balance endpoint responded');

    const balance = num(payload?.balance ?? payload?.currentBalance ?? payload?.totalBalance);
    const credit = num(payload?.availableCredit ?? payload?.creditAvailable ?? payload?.available);
    const limit = num(payload?.creditLimit ?? payload?.limit);
    const currency = payload?.currency || payload?.currencyCode || 'USD';

    await supabase.from('qxo_balance_snapshots').upsert(
      {
        tenant_id: conn.tenant_id,
        snapshot_date: new Date().toISOString().slice(0, 10),
        balance,
        available_credit: credit,
        credit_limit: limit,
        currency,
        raw_payload: payload,
      },
      { onConflict: 'tenant_id,snapshot_date' },
    );
    await finishRun(supabase, runId, 'success', 1);
    return { ok: true };
  } catch (e: any) {
    await finishRun(supabase, runId, 'error', 0, e.message);
    return { ok: false, error: e.message };
  }
}

async function syncInvoices(supabase: any, conn: any, cookie: string) {
  const runId = await logRun(supabase, conn.tenant_id, 'invoices');
  try {
    // Best-effort common Beacon AR invoice endpoints.
    const candidates = [
      `/v1/rest/com/becn/account/${conn.account_id || ''}/invoices`,
      `/v1/rest/com/becn/ar/invoices`,
      `/v1/rest/com/becn/invoices`,
    ].filter((p) => !p.includes('//invoices'));

    let payload: any = null;
    let lastErr: string | null = null;
    for (const p of candidates) {
      try { payload = await beaconGet(p, cookie); break; } catch (e: any) { lastErr = e.message; }
    }
    if (!payload) throw new Error(lastErr || 'No invoices endpoint responded');

    const list: any[] =
      payload?.invoices || payload?.items || payload?.data || (Array.isArray(payload) ? payload : []);

    let upserted = 0;
    for (const inv of list) {
      const qxoId = String(inv?.invoiceId || inv?.id || inv?.invoiceNumber || inv?.number || '').trim();
      if (!qxoId) continue;
      const row = {
        tenant_id: conn.tenant_id,
        qxo_invoice_id: qxoId,
        invoice_number: inv?.invoiceNumber || inv?.number || qxoId,
        po_number: inv?.poNumber || inv?.purchaseOrder || inv?.po || null,
        branch_code: inv?.branchCode || inv?.branch?.code || null,
        branch_name: inv?.branchName || inv?.branch?.name || null,
        status: pickInvoiceStatus(inv),
        issued_date: dateOnly(inv?.invoiceDate || inv?.issuedDate || inv?.date),
        due_date: dateOnly(inv?.dueDate),
        amount: num(inv?.amount ?? inv?.totalAmount ?? inv?.invoiceAmount),
        balance: num(inv?.balance ?? inv?.openAmount ?? inv?.balanceDue),
        currency: inv?.currency || 'USD',
        raw_payload: inv,
        last_synced_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('qxo_invoices')
        .upsert(row, { onConflict: 'tenant_id,qxo_invoice_id' });
      if (!error) upserted += 1;
    }
    await finishRun(supabase, runId, 'success', upserted);
    return { ok: true, count: upserted };
  } catch (e: any) {
    await finishRun(supabase, runId, 'error', 0, e.message);
    return { ok: false, error: e.message };
  }
}

async function syncOneTenant(supabase: any, conn: any): Promise<SyncResult> {
  const result: SyncResult = { tenant_id: conn.tenant_id };
  try {
    const { data: loginData, cookie } = await login(conn);
    result.profile = await syncProfile(supabase, conn, loginData);
    // re-read account_id after profile sync
    const { data: refreshed } = await supabase
      .from('qxo_connections').select('*').eq('id', conn.id).single();
    const c2 = refreshed || conn;
    result.balance = await syncBalance(supabase, c2, cookie);
    result.invoices = await syncInvoices(supabase, c2, cookie);
  } catch (e: any) {
    // Surface login failures on the connection record so the user sees them
    await supabase.from('qxo_connections').update({
      connection_status: 'error',
      last_error: e.message,
      valid_indicator: false,
    }).eq('id', conn.id);
    result.profile = { ok: false, error: e.message };
    result.balance = { ok: false, error: 'skipped: login failed' };
    result.invoices = { ok: false, error: 'skipped: login failed' };
  }
  return result;
}

// ---------- Handler ----------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    const { tenant_id, source } = body || {};

    let connections: any[] = [];
    if (tenant_id) {
      const { data, error } = await supabase
        .from('qxo_connections')
        .select('*')
        .eq('tenant_id', tenant_id);
      if (error) throw error;
      connections = data || [];
    } else {
      // cron path: pick all valid connections, throttle to those not synced in last 10 min
      const { data, error } = await supabase
        .from('qxo_connections')
        .select('*')
        .eq('valid_indicator', true)
        .eq('connection_status', 'connected');
      if (error) throw error;
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const filtered: any[] = [];
      for (const c of data || []) {
        const { data: last } = await supabase
          .from('qxo_sync_runs')
          .select('started_at,status')
          .eq('tenant_id', c.tenant_id)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!last || last.started_at < since) filtered.push(c);
      }
      connections = filtered;
    }

    const results: SyncResult[] = [];
    for (const conn of connections) {
      results.push(await syncOneTenant(supabase, conn));
    }

    return new Response(
      JSON.stringify({ success: true, source: source || 'manual', tenants: results.length, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e: any) {
    console.error('qxo-sync-orchestrator error', e);
    return new Response(
      JSON.stringify({ success: false, error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
