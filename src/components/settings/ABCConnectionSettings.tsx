import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2,
  CheckCircle,
  XCircle,
  Link2,
  Unlink,
  Truck,
  ShieldCheck,
  Copy,
  ExternalLink,
  Send,
  AlertTriangle,
  Search,
  DollarSign,
  Package,
  RefreshCw,
  ChevronRight,
} from 'lucide-react';
import { AbcDiagnosticsPanel } from './AbcDiagnosticsPanel';
import { useSupplierDeveloperMode } from '@/lib/supplierAccess';
import { AbcWebhookPanel } from '@/components/settings/abc/AbcWebhookPanel';

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

// Sandy-confirmed sandbox demo values (UI defaults only — never hardcoded server-side)
const SANDBOX_DEFAULTS = {
  shipTo: '2010466-2',
  branch: '1209',
  query: 'shingle',
};

function normalizeABCEnvironment(value?: string | null): ABCEnvironment {
  return value === 'sandbox' || value === 'staging' ? 'sandbox' : 'production';
}

// Canonical server-side OAuth callback URL — must be registered EXACTLY with ABC.
const SERVER_REDIRECT_URI =
  'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/abc-oauth-callback';

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

function ReadinessPill({
  label,
  state,
  detail,
}: {
  label: string;
  state: 'ok' | 'warn' | 'bad' | 'muted';
  detail?: string;
}) {
  const tone = {
    ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    warn: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    bad: 'border-destructive/40 bg-destructive/10 text-destructive',
    muted: 'border-muted bg-muted/40 text-muted-foreground',
  }[state];
  return (
    <div className={`rounded-md border px-3 py-2 text-xs ${tone}`}>
      <div className="font-medium">{label}</div>
      {detail && <div className="text-[11px] opacity-80 mt-0.5 truncate">{detail}</div>}
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

interface SearchHit {
  itemNumber?: string;
  itemDescription?: string;
  description?: string;
  availability?: string;
  status?: string;
  uom?: string;
}

export function ABCConnectionSettings() {
  const effectiveTenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const { allowSandboxDefaults } = useSupplierDeveloperMode();

  const [connection, setConnection] = useState<ABCConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);

  const [testResult, setTestResult] = useState<any | null>(null);
  const [latestResult, setLatestResult] = useState<any | null>(null);
  const [latestAction, setLatestAction] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  // Single shared set of demo inputs (used by Search / Price / Submit / Track)
  const [shipToNumber, setShipToNumber] = useState('');
  const [branchNumber, setBranchNumber] = useState('');
  const [itemNumber, setItemNumber] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [priceQty, setPriceQty] = useState('1');
  const [orderStatusNumber, setOrderStatusNumber] = useState('');

  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [orderResult, setOrderResult] = useState<any | null>(null);
  const [trackResult, setTrackResult] = useState<any | null>(null);

  const [oauthDebug, setOauthDebug] = useState<any | null>(null);
  const [oauthDebugBusy, setOauthDebugBusy] = useState(false);
  const [readiness, setReadiness] = useState<any | null>(null);
  const [readinessBusy, setReadinessBusy] = useState(false);
  const [sandboxLogin, setSandboxLogin] = useState<{ configured: boolean; username: string | null } | null>(null);
  const [forceAdvancedOpen, setForceAdvancedOpen] = useState<string | undefined>(undefined);


  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('');
  const [environment, setEnvironment] = useState<ABCEnvironment>('sandbox');

  // Apply sandbox UI defaults only for O'Brien sandbox tenant or developers.
  // Other tenants must NEVER see Sandy's ship-to / branch / sample query.
  useEffect(() => {
    if (environment !== 'sandbox') return;
    if (!allowSandboxDefaults) return;
    setShipToNumber((v) => v || SANDBOX_DEFAULTS.shipTo);
    setBranchNumber((v) => v || SANDBOX_DEFAULTS.branch);
    setProductQuery((v) => v || SANDBOX_DEFAULTS.query);
  }, [environment, allowSandboxDefaults]);

  useEffect(() => {
    if (effectiveTenantId) loadConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setForceAdvancedOpen('advanced');
    }
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
        payload.client_secret_encrypted = btoa(clientSecret.trim());
        payload.client_secret_rotated_at = new Date().toISOString();
      }
      const { error } = await (supabase as any)
        .from('abc_connections')
        .upsert(payload, { onConflict: 'tenant_id,environment' });
      if (error) throw error;
      toast({ title: 'Credentials saved', description: 'Click Test Token to validate.' });
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
      setLatestAction('test_connection');
      setLatestResult(data);
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

  const callProxy = async (action: string, body: Record<string, any>) => {
    setActionBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
        body: { tenant_id: effectiveTenantId, environment, action, ...body },
      });
      if (error) throw error;
      setLatestAction(action);
      setLatestResult(data);
      return data;
    } catch (e: any) {
      const fail = { success: false, error: formatErrorMessage(e) };
      setLatestAction(action);
      setLatestResult(fail);
      return fail;
    } finally {
      setActionBusy(null);
    }
  };

  const runProductSearch = async () => {
    const data = await callProxy('search_products', {
      query: productQuery.trim(),
      branchNumber: branchNumber.trim() || undefined,
    });
    // Normalize possible ABC response shapes into a flat hit list
    const body = (data as any)?.body;
    const items: SearchHit[] =
      body?.items ||
      body?.results ||
      body?.data ||
      (Array.isArray(body) ? body : []) ||
      [];
    setSearchHits(items);
  };

  const runPriceItem = async () => {
    if (!itemNumber.trim() || !shipToNumber.trim() || !branchNumber.trim()) {
      toast({ title: 'Missing inputs', description: 'Ship-To, Branch, and Item Number are all required.', variant: 'destructive' });
      return;
    }
    await callProxy('price_items', {
      shipToNumber: shipToNumber.trim(),
      branchNumber: branchNumber.trim(),
      purpose: 'estimating',
      lines: [{ itemNumber: itemNumber.trim(), quantity: Number(priceQty) || 1, unitOfMeasure: 'EA' }],
    });
  };

  const runTrackOrder = async (orderOrConfirm?: string) => {
    const raw = (orderOrConfirm ?? orderStatusNumber).trim();
    if (!raw) {
      toast({ title: 'Order number required', variant: 'destructive' });
      return;
    }
    const numeric = /^\d+$/.test(raw);
    const data = await callProxy('get_order_status', {
      orderNumber: numeric ? raw : undefined,
      confirmationNumber: numeric ? undefined : raw,
    });
    setTrackResult(data);
  };

  const handleSubmitTestOrder = async () => {
    if (!shipToNumber.trim() || !branchNumber.trim() || !itemNumber.trim()) {
      toast({
        title: 'Missing inputs',
        description: 'Ship-To, Branch, and a real Item Number from product search are required.',
        variant: 'destructive',
      });
      return;
    }
    setSubmittingOrder(true);
    setOrderResult(null);
    setTrackResult(null);
    try {
      const data: any = await callProxy('submit_test_order', {
        shipToNumber: shipToNumber.trim(),
        branchNumber: branchNumber.trim(),
        itemNumber: itemNumber.trim(),
      });
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

      // Auto-track if ABC returned an identifier
      const tracker = data?.orderNumber || data?.confirmationNumber;
      if (tracker) {
        setOrderStatusNumber(String(tracker));
        await runTrackOrder(String(tracker));
      }
    } finally {
      setSubmittingOrder(false);
    }
  };

  const loadReadiness = async () => {
    if (!effectiveTenantId) return;
    setReadinessBusy(true);
    try {
      const [{ data: cbLog }, { data: auditRow }] = await Promise.all([
        (supabase as any)
          .from('abc_oauth_callback_logs')
          .select('created_at, environment, has_code, has_error, error, error_description, state')
          .eq('tenant_id', effectiveTenantId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        (supabase as any)
          .from('abc_api_audit')
          .select('created_at, environment, action, endpoint, status_code, error_code, duration_ms')
          .eq('tenant_id', effectiveTenantId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      setReadiness({ callbackLog: cbLog, auditLog: auditRow });
      if (cbLog?.has_error) setForceAdvancedOpen('advanced');
      // Refresh sandbox test login readiness (server-side; password is never returned).
      try {
        const { data: sl } = await supabase.functions.invoke('abc-api-proxy', {
          body: { tenant_id: effectiveTenantId, environment, action: 'sandbox_test_login_status' },
        });
        if (sl && typeof sl === 'object') {
          setSandboxLogin({ configured: !!(sl as any).configured, username: (sl as any).username ?? null });
        }
      } catch {
        // non-fatal
      }
    } catch (e: any) {
      setReadiness({ error: formatErrorMessage(e) });
    } finally {
      setReadinessBusy(false);
    }
  };

  useEffect(() => {
    if (effectiveTenantId) loadReadiness();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTenantId, environment]);


  const fetchOAuthDebug = async () => {
    if (!effectiveTenantId) {
      toast({ title: 'No tenant context', variant: 'destructive' });
      return;
    }
    setOauthDebugBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
        body: { action: 'start_oauth', tenant_id: effectiveTenantId, environment, return_origin: window.location.origin },
      });

      if (error) throw error;
      setOauthDebug({ ...data, _authed: !!session?.user, _user_email: session?.user?.email ?? null });
    } catch (e: any) {
      setOauthDebug({ success: false, error: formatErrorMessage(e) });
    } finally {
      setOauthDebugBusy(false);
    }
  };

  const copyOAuthUrl = async () => {
    if (!oauthDebug?.authorization_url) {
      await fetchOAuthDebug();
    }
    const url = oauthDebug?.authorization_url;
    if (url) {
      await navigator.clipboard.writeText(url);
      toast({ title: 'OAuth URL copied' });
    }
  };

  const startOAuth = async () => {
    if (!effectiveTenantId) {
      toast({ title: 'No tenant context', variant: 'destructive' });
      return;
    }
    let oauthWindow: Window | null = null;
    try {
      oauthWindow = window.open('about:blank', '_blank');
    } catch {
      oauthWindow = null;
    }
    try {

      const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
        body: { action: 'start_oauth', tenant_id: effectiveTenantId, environment, return_origin: window.location.origin },
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
        try {
          oauthWindow.document.open();
          oauthWindow.document.write(
            `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${safeUrl}"><title>Redirecting to ABC…</title></head><body><script>window.opener=null;location.replace(${JSON.stringify(url)});</script><p>Redirecting to ABC Supply… <a rel="noopener noreferrer" href="${safeUrl}">Click here</a> if not redirected.</p></body></html>`,
          );
          oauthWindow.document.close();
          oauthWindow.focus();
          return true;
        } catch {
          return false;
        }
      })();

      if (!navigated) {
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
      setForceAdvancedOpen('advanced');
      toast({
        title: 'Could not start OAuth',
        description: formatErrorMessage(e),
        variant: 'destructive',
      });
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
  const canSubmitOrder =
    !!shipToNumber.trim() && !!branchNumber.trim() && !!itemNumber.trim();
  // (Order tracking now lives in <AbcDiagnosticsPanel /> — persistent + tenant-scoped.)


  // ────────────────────────────────────────────────────────────────────
  // A. Header / Status Card
  // ────────────────────────────────────────────────────────────────────
  const HeaderCard = (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Truck className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <CardTitle>ABC Supply</CardTitle>
              <CardDescription>
                Connect ABC Supply to sync pricing, product availability, material ordering, and order tracking.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={environment} onValueChange={(value) => setEnvironment(normalizeABCEnvironment(value))}>
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Sandbox</SelectItem>
                <SelectItem value="production">Production</SelectItem>
              </SelectContent>
            </Select>
            <Badge variant={isConnected ? 'default' : 'secondary'}>
              {isConnected ? (
                <><CheckCircle className="h-3 w-3 mr-1" /> Connected</>
              ) : connection?.connection_status === 'error' ? (
                <><XCircle className="h-3 w-3 mr-1" /> Error</>
              ) : connection?.connection_status === 'pending' ? (
                'Pending'
              ) : (
                'Disconnected'
              )}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {environment === 'sandbox' ? (
          <div className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-3 text-xs">
            <ShieldCheck className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium text-foreground">Sandbox mode.</span>{' '}
              Sandbox orders run in ABC QA only and are non-production. They do not create real material orders, invoices, or deliveries.
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium">Production is live.</span> Do not submit test orders in Production.
            </div>
          </div>
        )}
        {connection?.last_error && (
          <div className="mt-3 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
            {connection.last_error}
          </div>
        )}
      </CardContent>
    </Card>
  );

  // ────────────────────────────────────────────────────────────────────
  // B. Connection Setup Card
  // ────────────────────────────────────────────────────────────────────
  const ConnectionSetupCard = (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Connection Setup</CardTitle>
        <CardDescription>OAuth 2.0 credentials issued by ABC IT for your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
            <Label>OAuth Client ID</Label>
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="From ABC IT" />
          </div>
          <div className="space-y-2">
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

        <Accordion type="single" collapsible>
          <AccordionItem value="account-defaults" className="border-none">
            <AccordionTrigger className="text-xs text-muted-foreground py-2 hover:no-underline">
              Account Defaults (optional)
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                <div className="space-y-2">
                  <Label className="text-xs">ABC Account #</Label>
                  <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="e.g. 1234567" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Default Branch Code</Label>
                  <Input value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} placeholder="e.g. 1209" />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={handleSave} disabled={saving || !clientId}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {hasSecret ? 'Save & Replace Secret' : 'Save Credentials'}
          </Button>
          <Button onClick={startOAuth} disabled={!hasSecret || isConnected}>
            {isConnected ? <CheckCircle className="h-4 w-4 mr-2" /> : <ExternalLink className="h-4 w-4 mr-2" />}
            {isConnected ? 'ABC Supply Connected' : connection?.connection_status === 'error' ? 'Reconnect ABC Supply' : 'Connect ABC Supply'}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
            Test Token
          </Button>
          {hasSecret && (
            <Button variant="ghost" onClick={handleRevoke} className="text-destructive">
              <Unlink className="h-4 w-4 mr-2" />
              Disconnect
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  // ────────────────────────────────────────────────────────────────────
  // C. Compact Demo Readiness strip
  // ────────────────────────────────────────────────────────────────────
  const ReadinessStrip = (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <ReadinessPill
        label="Credentials"
        state={clientId && hasSecret ? 'ok' : 'warn'}
        detail={hasSecret ? `••••${connection?.client_secret_last_four}` : 'Missing'}
      />
      <ReadinessPill
        label="Token"
        state={isConnected ? 'ok' : connection?.connection_status === 'error' ? 'bad' : 'muted'}
        detail={isConnected ? 'Connected' : connection?.connection_status || 'Disconnected'}
      />
      <ReadinessPill
        label={environment === 'sandbox' ? 'Sandbox' : 'Production'}
        state={environment === 'sandbox' ? 'ok' : 'warn'}
        detail={environment === 'sandbox' ? 'Active (QA)' : 'Live'}
      />
      <ReadinessPill
        label="Last API Call"
        state={readiness?.auditLog ? (readiness.auditLog.error_code ? 'warn' : 'ok') : 'muted'}
        detail={
          readiness?.auditLog
            ? `${readiness.auditLog.action} · HTTP ${readiness.auditLog.status_code}`
            : 'No calls yet'
        }
      />
    </div>
  );

  // ────────────────────────────────────────────────────────────────────
  // D. Demo Workflow (sandbox only)
  // ────────────────────────────────────────────────────────────────────
  const stepStatus = {
    connect: isConnected,
    search: searchHits.length > 0,
    price: latestAction === 'price_items' && (latestResult?.success ?? false),
    submit: !!orderResult?.success,
  };

  const StepperPill = ({ n, label, done }: { n: number; label: string; done: boolean }) => (
    <div className="flex items-center gap-2">
      <div
        className={`h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-semibold ${
          done
            ? 'bg-emerald-500 text-white'
            : 'bg-muted text-muted-foreground border'
        }`}
      >
        {done ? <CheckCircle className="h-3.5 w-3.5" /> : n}
      </div>
      <span className={`text-xs ${done ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{label}</span>
    </div>
  );

  const DemoWorkflowCard = environment === 'sandbox' && allowSandboxDefaults && (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Sandbox Demo Workflow</CardTitle>
        <CardDescription>
          Sandy-approved sandbox defaults are pre-filled. Item Number is intentionally blank — run product search first
          and pick a real item at branch {SANDBOX_DEFAULTS.branch}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StepperPill n={1} label="Connect" done={stepStatus.connect} />
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
          <StepperPill n={2} label="Search" done={stepStatus.search} />
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
          <StepperPill n={3} label="Price" done={stepStatus.price} />
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
          <StepperPill n={4} label="Submit / Track" done={stepStatus.submit} />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Ship-To Number</Label>
            <Input value={shipToNumber} onChange={(e) => setShipToNumber(e.target.value)} placeholder={allowSandboxDefaults ? SANDBOX_DEFAULTS.shipTo : 'Ship-To #'} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Branch Number</Label>
            <Input value={branchNumber} onChange={(e) => setBranchNumber(e.target.value)} placeholder={allowSandboxDefaults ? SANDBOX_DEFAULTS.branch : 'Branch #'} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Item Number</Label>
            <Input
              value={itemNumber}
              onChange={(e) => setItemNumber(e.target.value)}
              placeholder="Run product search first"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  // ────────────────────────────────────────────────────────────────────
  // E. Sandbox Test Console
  // ────────────────────────────────────────────────────────────────────
  const TestConsoleCard = (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Sandbox Test Console</CardTitle>
        <CardDescription>
          {environment === 'sandbox'
            ? 'Submits a non-production ABC sandbox order to ABC QA.'
            : 'Production mode — submitting test orders is disabled.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Product Search */}
        <div className="rounded-md border p-3 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Search className="h-4 w-4" /> Product Search
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[160px]">
              <Label className="text-xs">Query</Label>
              <Input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="e.g. shingle" />
            </div>
            <div className="w-32">
              <Label className="text-xs">Branch</Label>
              <Input value={branchNumber} onChange={(e) => setBranchNumber(e.target.value)} />
            </div>
            <Button
              onClick={runProductSearch}
              disabled={actionBusy === 'search_products' || !productQuery.trim()}
            >
              {actionBusy === 'search_products' ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              Search
            </Button>
          </div>
          {searchHits.length > 0 && (
            <div className="rounded border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">Item #</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-32">Availability</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {searchHits.slice(0, 10).map((hit, i) => {
                    const itm = hit.itemNumber || '';
                    return (
                      <TableRow key={`${itm}-${i}`}>
                        <TableCell className="font-mono text-xs">{itm || '—'}</TableCell>
                        <TableCell className="text-xs">{hit.itemDescription || hit.description || '—'}</TableCell>
                        <TableCell className="text-xs">{hit.availability || hit.status || '—'}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!itm}
                            onClick={() => {
                              setItemNumber(itm);
                              toast({ title: 'Item selected', description: itm });
                            }}
                          >
                            Use
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Price Item */}
        <div className="rounded-md border p-3 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <DollarSign className="h-4 w-4" /> Price Item
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="w-40">
              <Label className="text-xs">Item Number</Label>
              <Input value={itemNumber} onChange={(e) => setItemNumber(e.target.value)} />
            </div>
            <div className="w-20">
              <Label className="text-xs">Qty</Label>
              <Input type="number" value={priceQty} onChange={(e) => setPriceQty(e.target.value)} />
            </div>
            <div className="w-32">
              <Label className="text-xs">Ship-To</Label>
              <Input value={shipToNumber} onChange={(e) => setShipToNumber(e.target.value)} />
            </div>
            <div className="w-28">
              <Label className="text-xs">Branch</Label>
              <Input value={branchNumber} onChange={(e) => setBranchNumber(e.target.value)} />
            </div>
            <Button
              onClick={runPriceItem}
              disabled={actionBusy === 'price_items' || !itemNumber.trim()}
              variant="outline"
            >
              {actionBusy === 'price_items' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <DollarSign className="h-4 w-4 mr-2" />}
              Get Price
            </Button>
          </div>
        </div>

        {/* Submit Test Order */}
        <div className="rounded-md border p-3 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Send className="h-4 w-4" /> Submit Sandbox Test Order
          </div>
          <p className="text-xs text-muted-foreground">
            Submits a non-production ABC sandbox order to ABC QA. Requires a real item from product search.
          </p>

          <Button
            onClick={handleSubmitTestOrder}
            disabled={submittingOrder || !canSubmitOrder || environment !== 'sandbox'}
          >
            {submittingOrder ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Submit Test Order
          </Button>
        </div>

        {/* Track Order */}
        <div className="rounded-md border p-3 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Package className="h-4 w-4" /> Track Order
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs">Order # or Confirmation #</Label>
              <Input
                value={orderStatusNumber}
                onChange={(e) => setOrderStatusNumber(e.target.value)}
                placeholder="Auto-filled after submit"
              />
            </div>
            <Button
              onClick={() => runTrackOrder()}
              disabled={actionBusy === 'get_order_status' || !orderStatusNumber.trim()}
              variant="outline"
            >
              {actionBusy === 'get_order_status' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Refresh Status
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  // ────────────────────────────────────────────────────────────────────
  // F. Latest Result Card
  // ────────────────────────────────────────────────────────────────────
  const LatestResultCard = latestResult && (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          {latestResult.success ? (
            <CheckCircle className="h-4 w-4 text-emerald-600" />
          ) : (
            <XCircle className="h-4 w-4 text-destructive" />
          )}
          Latest Result — {latestAction}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="grid gap-1 md:grid-cols-2">
          <div>
            <span className="text-muted-foreground">Endpoint:</span>{' '}
            <span className="font-mono break-all">{latestResult.endpoint || '—'}</span>
          </div>
          <div>
            <span className="text-muted-foreground">HTTP Status:</span>{' '}
            <Badge variant={latestResult.success ? 'default' : 'destructive'}>
              {latestResult.status ?? latestResult.orderResponse?.status ?? '—'}
            </Badge>
          </div>
        </div>
        {latestResult.interpretation && (
          <p className="text-muted-foreground">{latestResult.interpretation}</p>
        )}
        {latestResult.error_code && (
          <Badge variant="destructive">{latestResult.error_code}</Badge>
        )}
        <Accordion type="single" collapsible>
          <AccordionItem value="raw" className="border-none">
            <AccordionTrigger className="text-xs py-2 hover:no-underline">View Raw JSON</AccordionTrigger>
            <AccordionContent>
              <pre className="font-mono text-[10px] bg-muted/40 p-2 rounded overflow-x-auto max-h-80">
                {JSON.stringify(latestResult, null, 2)}
              </pre>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );

  // ────────────────────────────────────────────────────────────────────
  // G. ABC Submit Diagnostics (persistent, mirrors SRS pattern)
  // ────────────────────────────────────────────────────────────────────
  const DiagnosticsCard = <AbcDiagnosticsPanel />;



  // ────────────────────────────────────────────────────────────────────
  // H. Advanced / Developer Details
  // ────────────────────────────────────────────────────────────────────
  const AdvancedSection = (
    <Card>
      <CardContent className="pt-6">
        <Accordion type="single" collapsible value={forceAdvancedOpen} onValueChange={setForceAdvancedOpen}>
          <AccordionItem value="advanced" className="border-none">
            <AccordionTrigger className="text-sm hover:no-underline">
              <span className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Advanced / Developer Details
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4 pt-2">
                <div className="rounded-md border p-3 space-y-2 text-xs">
                  <p className="font-medium text-foreground text-sm">OAuth &amp; API endpoints</p>
                  <EndpointRow label="Authorization URL" value={ABC_CONFIG.authorizeUrl[environment]} />
                  <EndpointRow label="Token URL" value={ABC_CONFIG.tokenUrl[environment]} />
                  <EndpointRow label="Redirect URI" value={SERVER_REDIRECT_URI} hint="Register THIS exact URL with ABC IT" />
                  <EndpointRow label="Scopes" value={ABC_CONFIG.scopes} hint="PKCE (S256) + Basic auth on token endpoint" />
                  <EndpointRow
                    label={`API Base (${environment})`}
                    value={environment === 'production' ? ABC_CONFIG.apiBase.production : ABC_CONFIG.apiBase.sandbox}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={fetchOAuthDebug} disabled={oauthDebugBusy}>
                    {oauthDebugBusy ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 mr-2" />}
                    Inspect OAuth URL
                  </Button>
                  <Button variant="outline" size="sm" onClick={copyOAuthUrl} disabled={oauthDebugBusy}>
                    <Copy className="h-3.5 w-3.5 mr-2" />
                    Copy OAuth URL
                  </Button>
                  <Button variant="ghost" size="sm" onClick={loadReadiness} disabled={readinessBusy}>
                    {readinessBusy ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-2" />}
                    Refresh readiness
                  </Button>
                </div>

                {oauthDebug && (
                  <div className={`rounded-md border p-3 text-xs space-y-2 ${oauthDebug.success === false ? 'border-destructive/30 bg-destructive/5' : 'border-blue-500/30 bg-blue-500/5'}`}>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <ShieldCheck className="h-4 w-4" /> OAuth Debug
                      {oauthDebug.error_code && <Badge variant="destructive">{oauthDebug.error_code}</Badge>}
                    </div>
                    {oauthDebug.human_message && <p className="text-muted-foreground">{oauthDebug.human_message}</p>}
                    <div className="grid gap-1 md:grid-cols-2">
                      <EndpointRow label="authorization_url" value={oauthDebug.authorization_url ?? ''} />
                      <EndpointRow label="client_id" value={oauthDebug.client_id ?? ''} />
                      <EndpointRow label="redirect_uri" value={oauthDebug.redirect_uri ?? ''} />
                      <EndpointRow label="scopes" value={oauthDebug.scopes ?? ''} />
                      <EndpointRow label="state" value={oauthDebug.state ?? ''} />
                      <EndpointRow label="pkce" value={oauthDebug.pkce_enabled ? `enabled (${oauthDebug.code_challenge_method})` : 'disabled'} />
                      <EndpointRow label="environment" value={oauthDebug.environment ?? environment} />
                      <EndpointRow label="user authenticated" value={oauthDebug._authed ? `yes — ${oauthDebug._user_email ?? ''}` : 'no'} />
                    </div>
                  </div>
                )}

                <div className="rounded-md border p-3 space-y-2 text-xs">
                  <div className="text-sm font-medium">Full Readiness</div>
                  <div className="grid gap-1 md:grid-cols-2">
                    <EndpointRow label="OAuth Client ID" value={clientId || ''} />
                    <EndpointRow label="Client secret on server" value={hasSecret ? `••••${connection?.client_secret_last_four}` : ''} hint={!hasSecret ? 'Not set' : undefined} />
                    <EndpointRow label="Redirect URI" value={SERVER_REDIRECT_URI} />
                    <EndpointRow label="Environment" value={environment} />
                    <EndpointRow label="Scopes" value={ABC_CONFIG.scopes} />
                    <EndpointRow label="Token status" value={isConnected ? 'connected' : (connection?.connection_status || 'disconnected')} />
                    <EndpointRow label="Last token refresh" value={connection?.last_validated_at ? new Date(connection.last_validated_at).toLocaleString() : ''} />
                    <EndpointRow
                      label="Last callback hit"
                      value={readiness?.callbackLog
                        ? `${new Date(readiness.callbackLog.created_at).toLocaleString()} · code=${readiness.callbackLog.has_code} · err=${readiness.callbackLog.error || '—'}`
                        : ''}
                    />
                    <EndpointRow
                      label="Last ABC API call"
                      value={readiness?.auditLog
                        ? `${new Date(readiness.auditLog.created_at).toLocaleString()} · ${readiness.auditLog.action} · HTTP ${readiness.auditLog.status_code} · ${readiness.auditLog.error_code || 'ok'}`
                        : ''}
                    />
                    <EndpointRow
                      label="Sandbox test login configured"
                      value={sandboxLogin ? (sandboxLogin.configured ? 'yes' : 'no') : '—'}
                    />
                    <EndpointRow
                      label="Sandbox test username"
                      value={sandboxLogin?.username ?? ''}
                      hint={sandboxLogin?.configured ? 'Password: ******** (stored as Supabase secret; never displayed or logged)' : undefined}
                    />
                  </div>
                </div>

                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs space-y-1">
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <AlertTriangle className="h-4 w-4 text-amber-600" /> OAuth troubleshooting
                  </div>
                  <p className="text-muted-foreground">
                    If ABC sends you to the developer dashboard instead of redirecting back to Pitch, ABC did not complete the OAuth redirect. Confirm the redirect URI is registered exactly, the test user is assigned to the app, and login is performed with the customer test account rather than the developer portal account.
                  </p>
                  <p className="text-muted-foreground">
                    ABC sandbox OAuth test user: <code>connect_user@test.com</code>. Password is stored temporarily as a Supabase secret (<code>ABC_SANDBOX_TEST_PASSWORD</code>) and must not be committed, logged, displayed, or exposed.
                  </p>
                </div>

                {allowSandboxDefaults && (
                  <AbcWebhookPanel tenantId={effectiveTenantId ?? null} environment={environment} />
                )}

              </div>

            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      {HeaderCard}
      {ConnectionSetupCard}
      {ReadinessStrip}
      {DemoWorkflowCard}
      {TestConsoleCard}
      {LatestResultCard}
      {DiagnosticsCard}
      {AdvancedSection}
    </div>
  );
}
