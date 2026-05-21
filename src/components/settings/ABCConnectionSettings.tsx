import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle, XCircle, Link2, Unlink, Truck, ShieldCheck, Copy, ExternalLink, Send, AlertTriangle } from 'lucide-react';

const ABC_CONFIG = {
  authBase: {
    sandbox: 'https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8',
    production: 'https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357',
  },
  authorizeUrl: {
    sandbox: 'https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/v1/authorize',
    production: 'https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/v1/authorize',
  },
  tokenUrl: {
    sandbox: 'https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/v1/token',
    production: 'https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/v1/token',
  },
  scopes: 'pricing.read order.read order.write product.read account.read location.read offline_access',
  apiBase: {
    sandbox: 'https://partners-sb.abcsupply.com/api',
    production: 'https://partners.abcsupply.com/api',
  },
};

type ABCEnvironment = 'sandbox' | 'production';

function normalizeABCEnvironment(value?: string | null): ABCEnvironment {
  return value === 'sandbox' || value === 'staging' ? 'sandbox' : 'production';
}

// Canonical server-side OAuth callback URL — must be registered EXACTLY with ABC.
// Hardcoded to avoid drift from preview URLs or undefined env values.
const SERVER_REDIRECT_URI =
  'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/abc-oauth-callback';


// PKCE helpers
// PKCE generation now happens server-side in the abc-oauth-start edge function.

function formatErrorMessage(error: unknown): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  const anyError = error as any;
  const parts = [
    anyError.message,
    anyError.context?.error_description,
    anyError.context?.error,
    anyError.details,
    anyError.hint,
    anyError.code ? `code=${anyError.code}` : null,
  ].filter(Boolean);
  if (parts.length) return parts.join(' | ');
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function EndpointRow({ label, value, pending, hint }: { label: string; value: string; pending?: string; hint?: string }) {
  const display = value || pending || '—';
  return (
    <div className="flex items-start justify-between gap-2 py-1 border-b last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-muted-foreground">{label}</div>
        <div className={`font-mono text-[11px] break-all ${value ? 'text-foreground' : 'text-amber-600'}`}>{display}</div>
        {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
      </div>
      {value && (
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(value)}
          className="text-muted-foreground hover:text-foreground shrink-0"
          title="Copy"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

interface ABCConnection {
  id: string;
  tenant_id: string;
  account_number: string | null;
  client_id: string | null;
  client_secret_last_four: string | null;
  client_secret_rotated_at: string | null;
  connection_status: string;
  last_validated_at: string | null;
  last_error: string | null;
  default_branch_code: string | null;
  environment: string;
}

export function ABCConnectionSettings() {
  const effectiveTenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const [connection, setConnection] = useState<ABCConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [testResult, setTestResult] = useState<any | null>(null);
  const [orderResult, setOrderResult] = useState<any | null>(null);
  const [consoleResult, setConsoleResult] = useState<any | null>(null);
  const [consoleBusy, setConsoleBusy] = useState<string | null>(null);
  const [branchInput, setBranchInput] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [priceItemNumber, setPriceItemNumber] = useState('');
  const [priceQty, setPriceQty] = useState('1');
  const [priceShipTo, setPriceShipTo] = useState('');
  const [priceBranch, setPriceBranch] = useState('');
  const [orderStatusNumber, setOrderStatusNumber] = useState('');

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('');
  const [environment, setEnvironment] = useState<ABCEnvironment>('production');

  useEffect(() => {
    if (effectiveTenantId) loadConnection();
  }, [effectiveTenantId, environment]);

  // Surface OAuth callback result (?abc=connected|error&msg=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const abc = params.get('abc');
    if (!abc) return;
    if (abc === 'connected') {
      toast({ title: 'ABC Supply connected', description: 'OAuth authorization complete.' });
      loadConnection();
    } else if (abc === 'error') {
      toast({
        title: 'ABC OAuth failed',
        description: params.get('msg') || 'Authorization did not complete.',
        variant: 'destructive',
      });
    }
    // Clean the URL
    params.delete('abc');
    params.delete('msg');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadConnection = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('abc_connections')
        .select('*')
        .eq('tenant_id', effectiveTenantId)
        .in('environment', environment === 'sandbox' ? ['sandbox', 'staging'] : ['production'])
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setConnection(data);
        setClientId(data.client_id || '');
        setAccountNumber(data.account_number || '');
        setDefaultBranch(data.default_branch_code || '');
      } else {
        setConnection(null);
        setClientId('');
        setAccountNumber('');
        setDefaultBranch('');
      }
    } catch (e) {
      console.error('Failed to load ABC connection:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!effectiveTenantId) return;
    if (!clientId.trim()) {
      toast({ title: 'Client ID required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const last4 = clientSecret.trim() ? clientSecret.trim().slice(-4) : connection?.client_secret_last_four ?? null;
      const payload: any = {
        tenant_id: effectiveTenantId,
        client_id: clientId.trim(),
        account_number: accountNumber.trim() || null,
        default_branch_code: defaultBranch.trim() || null,
        environment,
        connection_status: 'pending',
        client_secret_last_four: last4,
      };
      if (clientSecret.trim()) {
        // NOTE: encrypted server-side via abc-api-proxy edge function once implemented.
        payload.client_secret_encrypted = btoa(clientSecret.trim());
        payload.client_secret_rotated_at = new Date().toISOString();
      }
      const { error } = await (supabase as any)
        .from('abc_connections')
        .upsert(payload, { onConflict: 'tenant_id,environment' });
      if (error) throw error;
      toast({ title: 'Credentials saved', description: 'Click Test Connection to validate.' });
      setClientSecret('');
      await loadConnection();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
        body: { action: 'test_connection', environment },
      });
      if (error) throw error;
      setTestResult(data);
      toast({
        title: data?.success ? 'ABC reachable' : 'ABC test inconclusive',
        description: data?.interpretation ?? 'See details below.',
        variant: data?.success ? 'default' : 'destructive',
      });
    } catch (e: any) {
      setTestResult({ success: false, error: e.message });
      toast({ title: 'Test failed', description: e.message, variant: 'destructive' });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmitTestOrder = async () => {
    setSubmittingOrder(true);
    setOrderResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
        body: { action: 'submit_test_order', environment },
      });
      if (error) throw error;
      setOrderResult(data);
      const friendly =
        data?.interpretation ||
        (data?.success
          ? 'ABC accepted the sandbox order payload.'
          : `ABC responded ${data?.orderResponse?.status ?? '—'}. See details below.`);
      toast({
        title: data?.success ? 'Test order accepted' : 'Test order not submitted',
        description: friendly,
        variant: data?.success ? 'default' : 'destructive',
      });
    } catch (e: any) {
      setOrderResult({ success: false, error: e.message });
      toast({ title: 'Submission failed', description: e.message, variant: 'destructive' });
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleRevoke = async () => {
    if (!effectiveTenantId || !connection) return;
    if (!confirm('Revoke ABC Supply credentials?')) return;
    const { error } = await (supabase as any)
      .from('abc_connections')
      .update({
        client_secret_encrypted: null,
        client_secret_last_four: null,
        connection_status: 'disconnected',
      })
      .eq('tenant_id', effectiveTenantId);
    if (error) {
      toast({ title: 'Revoke failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Credentials revoked' });
    await loadConnection();
  };

  const runConsole = async (label: string, body: Record<string, any>) => {
    setConsoleBusy(label);
    setConsoleResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
        body: { tenant_id: effectiveTenantId, environment, ...body },
      });
      if (error) throw error;
      setConsoleResult({ label, ...data });
    } catch (e: any) {
      setConsoleResult({ label, success: false, error: e.message });
    } finally {
      setConsoleBusy(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const isConnected = connection?.connection_status === 'connected';
  const hasSecret = !!connection?.client_secret_last_four;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Truck className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <CardTitle>ABC Supply</CardTitle>
                <CardDescription>
                  Connect to ABC Supply (myABCsupply portal) to sync pricing and submit orders.
                </CardDescription>
              </div>
            </div>
            <Badge variant={isConnected ? 'default' : 'secondary'}>
              {isConnected ? (
                <><CheckCircle className="h-3 w-3 mr-1" /> Connected</>
              ) : connection?.connection_status === 'error' ? (
                <><XCircle className="h-3 w-3 mr-1" /> Error</>
              ) : connection?.connection_status === 'pending' ? (
                'Pending validation'
              ) : (
                'Disconnected'
              )}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {connection?.last_error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
              {connection.last_error}
            </div>
          )}

          {hasSecret && (
            <div className="flex items-center gap-2 p-3 bg-muted/40 border rounded-md text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              <span>
                Secret on file ending <code className="font-mono">••••{connection?.client_secret_last_four}</code>
                {connection?.client_secret_rotated_at && (
                  <> · last rotated {new Date(connection.client_secret_rotated_at).toLocaleDateString()}</>
                )}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Environment</Label>
              <Select value={environment} onValueChange={(value) => setEnvironment(normalizeABCEnvironment(value))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">Sandbox (Testing)</SelectItem>
                  <SelectItem value="production">Production (Live)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>ABC Account #</Label>
              <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="e.g. 1234567" />
            </div>

            <div className="space-y-2">
              <Label>Default Branch Code</Label>
              <Input value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} placeholder="e.g. 0042" />
            </div>

            <div className="space-y-2">
              <Label>OAuth Client ID</Label>
              <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="From ABC IT" />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>OAuth Client Secret {hasSecret && <span className="text-xs text-muted-foreground">(enter to replace)</span>}</Label>
              <Input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={hasSecret ? `Leave blank to keep ••••${connection?.client_secret_last_four}` : '••••••••'}
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">How to get ABC Supply API access</p>
            <p>
              ABC Supply does not publish a public API. Contact your ABC branch manager and request a
              <strong> myABCsupply API integration</strong> for your account. They will route the request to ABC IT,
              who issue OAuth 2.0 credentials (Client ID + Client Secret) tied to your account number.
              Paste them above; we store the secret server-side and never return it to the browser.
            </p>
          </div>

          <div className="rounded-md border p-3 space-y-2 text-xs">
            <p className="font-medium text-foreground text-sm">OAuth & API endpoints</p>
            <EndpointRow label="Authorization URL" value={ABC_CONFIG.authorizeUrl[environment]} />
            <EndpointRow label="Token URL" value={ABC_CONFIG.tokenUrl[environment]} />
            <EndpointRow label="Redirect URI" value={SERVER_REDIRECT_URI} hint="Register THIS exact URL with ABC IT for the OAuth client" />
            <EndpointRow label="Scopes" value={ABC_CONFIG.scopes} hint="PKCE (S256) + Basic auth on token endpoint" />
            <EndpointRow
              label={`API Base (${environment})`}
              value={environment === 'production' ? ABC_CONFIG.apiBase.production : ABC_CONFIG.apiBase.sandbox}
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving || !clientId}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {hasSecret ? 'Save & Replace Secret' : 'Save Credentials'}
            </Button>

            <Button
              variant="default"
              onClick={async () => {
                if (!effectiveTenantId) {
                  toast({ title: 'No tenant context', variant: 'destructive' });
                  return;
                }
                // Pre-open a writable tab synchronously to preserve user-gesture (popup blocker).
                // Do not pass `noopener` here: browsers intentionally return null for that feature,
                // which leaves the user staring at an un-navigated about:blank tab.
                let oauthWindow: Window | null = null;
                try {
                  oauthWindow = window.open('about:blank', '_blank');
                } catch {
                  oauthWindow = null;
                }
                try {
                  const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
                    body: {
                      action: 'start_oauth',
                      tenant_id: effectiveTenantId,
                      environment,
                    },
                  });
                  if (error) throw error;
                  if (!data?.authorization_url) {
                    throw new Error(data?.interpretation || data?.error || 'No authorization_url returned');
                  }
                  const url = data.authorization_url as string;
                  const safeUrl = url
                    .replace(/&/g, '&amp;')
                    .replace(/"/g, '&quot;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');

                  const navigated = (() => {
                    if (!oauthWindow || oauthWindow.closed) return false;
                    // Sandboxed iframe can block assigning .location.href from the preview frame.
                    // document.write a redirect page instead — runs in the new tab's own context.
                    try {
                      oauthWindow.document.open();
                      oauthWindow.document.write(
                        `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${safeUrl}"><title>Redirecting to ABC…</title></head><body><script>window.opener=null;location.replace(${JSON.stringify(url)});</script><p>Redirecting to ABC Supply… <a rel="noopener noreferrer" href="${safeUrl}">Click here</a> if not redirected.</p></body></html>`
                      );
                      oauthWindow.document.close();
                      oauthWindow.focus();
                      return true;
                    } catch {
                      return false;
                    }
                  })();

                  if (!navigated) {
                    // Fallback: synthesize a user-gesture anchor click in top context.
                    const a = document.createElement('a');
                    a.href = url;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                  }
                } catch (e: any) {
                  if (oauthWindow && !oauthWindow.closed) oauthWindow.close();
                  toast({
                    title: 'Could not start OAuth',
                    description: formatErrorMessage(e),
                    variant: 'destructive',
                  });
                }
              }}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Begin OAuth Authorization
            </Button>

            <Button variant="outline" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
              Test Connection
            </Button>

            <Button variant="outline" onClick={handleSubmitTestOrder} disabled={submittingOrder}>
              {submittingOrder ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Submit Test Order ({environment})
            </Button>

            {hasSecret && (
              <Button variant="ghost" onClick={handleRevoke} className="text-destructive">
                <Unlink className="h-4 w-4 mr-2" />
                Revoke & Disconnect
              </Button>
            )}
          </div>

          {(testResult || orderResult) && (
            <div className="space-y-3 pt-2">
              {testResult && (
                <div className={`rounded-md border p-3 text-xs space-y-2 ${testResult.success ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {testResult.success ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
                    Connection Test — {testResult.environment ?? environment}
                  </div>
                  {testResult.interpretation && <p className="text-muted-foreground">{testResult.interpretation}</p>}
                  <pre className="font-mono text-[10px] bg-background/60 p-2 rounded overflow-x-auto max-h-64">
                    {JSON.stringify(testResult, null, 2)}
                  </pre>
                </div>
              )}
              {orderResult && (
                <div className={`rounded-md border p-3 text-xs space-y-2 ${orderResult.success ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-destructive/30 bg-destructive/5'}`}>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {orderResult.success ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-destructive" />}
                    Test Order Submission — HTTP {orderResult.orderResponse?.status ?? '—'}
                  </div>
                  <pre className="font-mono text-[10px] bg-background/60 p-2 rounded overflow-x-auto max-h-64">
                    {JSON.stringify(orderResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          <div className="rounded-md border p-3 space-y-3">
            <div className="text-sm font-medium">Sandbox Test Console</div>
            <p className="text-xs text-muted-foreground">
              All calls go through <code>abc-api-proxy</code> using the {environment} environment. Raw JSON + mapped error code shown below.
            </p>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2 rounded border p-2">
                <Label className="text-xs">Test Branch Lookup</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="branchNumber (blank = list all)"
                    value={branchInput}
                    onChange={(e) => setBranchInput(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!consoleBusy}
                    onClick={() =>
                      runConsole(
                        branchInput.trim() ? 'get_branch' : 'get_branches',
                        branchInput.trim()
                          ? { action: 'get_branch', branchNumber: branchInput.trim() }
                          : { action: 'get_branches' },
                      )
                    }
                  >
                    {consoleBusy === 'get_branch' || consoleBusy === 'get_branches' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : 'Run'}
                  </Button>
                </div>
              </div>

              <div className="space-y-2 rounded border p-2">
                <Label className="text-xs">Test Product Search</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="query (e.g. shingle)"
                    value={productQuery}
                    onChange={(e) => setProductQuery(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!consoleBusy || !productQuery.trim()}
                    onClick={() =>
                      runConsole('search_products', {
                        action: 'search_products',
                        query: productQuery.trim(),
                      })
                    }
                  >
                    {consoleBusy === 'search_products' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Run'}
                  </Button>
                </div>
              </div>

              <div className="space-y-2 rounded border p-2 md:col-span-2">
                <Label className="text-xs">Test Price Items</Label>
                <div className="grid gap-2 md:grid-cols-4">
                  <Input placeholder="itemNumber" value={priceItemNumber} onChange={(e) => setPriceItemNumber(e.target.value)} />
                  <Input placeholder="qty" type="number" value={priceQty} onChange={(e) => setPriceQty(e.target.value)} />
                  <Input placeholder="shipToNumber" value={priceShipTo} onChange={(e) => setPriceShipTo(e.target.value)} />
                  <Input placeholder="branchNumber" value={priceBranch} onChange={(e) => setPriceBranch(e.target.value)} />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!consoleBusy || !priceItemNumber.trim() || !priceShipTo.trim() || !priceBranch.trim()}
                  onClick={() =>
                    runConsole('price_items', {
                      action: 'price_items',
                      shipToNumber: priceShipTo.trim(),
                      branchNumber: priceBranch.trim(),
                      purpose: 'QUOTE',
                      lines: [{ itemNumber: priceItemNumber.trim(), quantity: Number(priceQty) || 1, unitOfMeasure: 'EA' }],
                    })
                  }
                >
                  {consoleBusy === 'price_items' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Get Price'}
                </Button>
              </div>

              <div className="space-y-2 rounded border p-2">
                <Label className="text-xs">Test Order Status</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="orderNumber or confirmationNumber"
                    value={orderStatusNumber}
                    onChange={(e) => setOrderStatusNumber(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!consoleBusy || !orderStatusNumber.trim()}
                    onClick={() =>
                      runConsole('get_order_status', {
                        action: 'get_order_status',
                        orderNumber: /^\d+$/.test(orderStatusNumber.trim()) ? orderStatusNumber.trim() : undefined,
                        confirmationNumber: /^\d+$/.test(orderStatusNumber.trim()) ? undefined : orderStatusNumber.trim(),
                      })
                    }
                  >
                    {consoleBusy === 'get_order_status' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Run'}
                  </Button>
                </div>
              </div>

              <div className="space-y-2 rounded border p-2">
                <Label className="text-xs">Submit Sandbox Test Order</Label>
                <p className="text-[11px] text-muted-foreground">
                  POSTs the canned PITCH sandbox payload to <code>/order/v2/orders</code>.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!consoleBusy}
                  onClick={() => runConsole('submit_test_order', { action: 'submit_test_order' })}
                >
                  {consoleBusy === 'submit_test_order' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Submit'}
                </Button>
              </div>
            </div>

            {consoleResult && (
              <div
                className={`rounded-md border p-3 text-xs space-y-2 ${
                  consoleResult.success ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-destructive/30 bg-destructive/5'
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  {consoleResult.success ? (
                    <CheckCircle className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  {consoleResult.label} — HTTP {consoleResult.status ?? '—'}
                  {consoleResult.error_code && (
                    <Badge variant="destructive" className="ml-2">{consoleResult.error_code}</Badge>
                  )}
                </div>
                {consoleResult.endpoint && (
                  <div className="font-mono text-[10px] text-muted-foreground break-all">{consoleResult.endpoint}</div>
                )}
                <pre className="font-mono text-[10px] bg-background/60 p-2 rounded overflow-x-auto max-h-80">
                  {JSON.stringify(consoleResult, null, 2)}
                </pre>
              </div>
            )}
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
