import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';
import { useToast } from '@/hooks/use-toast';
import { SrsDiagnosticsPanel } from '@/components/orders/SrsDiagnosticsPanel';
import { Loader2, CheckCircle, XCircle, Link2, Unlink, Truck, RefreshCw, AlertTriangle, ShieldCheck } from 'lucide-react';

interface SRSConnection {
  id: string;
  tenant_id: string;
  customer_code: string | null;
  client_id: string | null;
  client_secret_last_four: string | null;
  client_secret_rotated_at: string | null;
  connection_status: string;
  last_validated_at: string | null;
  last_error: string | null;
  job_account_number: number | null;
  default_branch_code: string | null;
  integration_key: string | null;
  valid_indicator: boolean;
  environment: string;
}


interface AuditRow {
  id: string;
  action: string;
  success: boolean;
  error: string | null;
  actor_email: string | null;
  ip_address: string | null;
  created_at: string;
}

const ROTATION_RECOMMENDED_DAYS = 90;
const ROTATION_MANDATORY_DAYS = 180;

export function SRSConnectionSettings() {
  const { activeCompanyId } = useCompanySwitcher();
  const { toast } = useToast();
  const [connection, setConnection] = useState<SRSConnection | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [branches, setBranches] = useState<any[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [submittingTestOrder, setSubmittingTestOrder] = useState(false);
  const [testOrderResult, setTestOrderResult] = useState<any>(null);
  const [savingBranch, setSavingBranch] = useState(false);
  const [branchOverride, setBranchOverride] = useState<string>('');


  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [customerCode, setCustomerCode] = useState('');
  const [environment, setEnvironment] = useState('staging');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [billedAmount, setBilledAmount] = useState('');
  const [integrationKey, setIntegrationKey] = useState('');

  useEffect(() => {
    if (activeCompanyId) {
      loadConnection();
      loadAudit();
      loadBranches();
    }
  }, [activeCompanyId]);

  const loadBranches = async () => {
    if (!activeCompanyId) return;
    setLoadingBranches(true);
    try {
      const { data, error } = await (supabase as any)
        .from('srs_branches')
        .select('branch_code, branch_name, city, state, zip, phone')
        .eq('tenant_id', activeCompanyId)
        .order('branch_name');
      if (error) throw error;
      setBranches(data || []);
    } catch (e) {
      console.error('Failed to load SRS branches:', e);
    } finally {
      setLoadingBranches(false);
    }
  };

  const loadConnection = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from('srs_connections')
        .select('id, tenant_id, customer_code, client_id, client_secret_last_four, client_secret_rotated_at, connection_status, last_validated_at, last_error, job_account_number, default_branch_code, integration_key, valid_indicator, environment')
        .eq('tenant_id', activeCompanyId)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setConnection(data);
        setClientId(data.client_id || '');
        setClientSecret('');
        setCustomerCode(data.customer_code || '');
        setEnvironment(data.environment || 'staging');
        setIntegrationKey(data.integration_key || '');
      }
    } catch (error) {
      console.error('Failed to load SRS connection:', error);
    } finally {
      setLoading(false);
    }
  };


  const loadAudit = async () => {
    try {
      const { data } = await (supabase as any)
        .from('srs_credential_audit')
        .select('id, action, success, error, actor_email, ip_address, created_at')
        .eq('tenant_id', activeCompanyId)
        .order('created_at', { ascending: false })
        .limit(20);
      setAudit(data || []);
    } catch (e) {
      console.error('Failed to load SRS audit log:', e);
    }
  };

  const handleSave = async (rotation = false) => {
    if (!activeCompanyId) return;
    if (!clientId.trim() || !clientSecret.trim()) {
      toast({ title: 'Missing credentials', description: 'Client ID and Client Secret are required.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('srs-api-proxy', {
        body: {
          action: rotation ? 'rotate_credentials' : 'save_credentials',
          tenant_id: activeCompanyId,
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
          customer_code: customerCode.trim(),
          environment,
          integration_key: integrationKey.trim() || undefined,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Save failed');

      toast({ title: rotation ? 'Credentials rotated' : 'Credentials saved', description: 'Click "Test Connection" to validate.' });
      setClientSecret('');
      await loadConnection();
      await loadAudit();
    } catch (error: any) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!activeCompanyId) return;
    if (!integrationKey.trim() && (!invoiceNumber.trim() || (!invoiceDate.trim() && !billedAmount.trim()))) {
      toast({
        title: 'Validation info required',
        description: 'Provide either an SRS Integration Key OR Invoice # + Invoice Date/Billed Amount.',
        variant: 'destructive',
      });
      return;
    }
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('srs-api-proxy', {
        body: {
          action: 'validate_connection',
          tenant_id: activeCompanyId,
          environment,
          integration_key: integrationKey.trim() || undefined,
          invoice_number: invoiceNumber.trim() || undefined,
          invoice_date: invoiceDate.trim() || undefined,
          billed_amount: billedAmount.trim() || undefined,
        },
      });
      if (error) throw error;
      if (data?.success) {
        toast({ title: 'Connection successful!', description: `Customer validated. Account: ${data.jobAccountNumber || 'N/A'}` });
      } else {
        toast({ title: 'Connection failed', description: data?.error || 'Validation failed', variant: 'destructive' });
      }
      await loadConnection();
      await loadAudit();
    } catch (error: any) {
      toast({ title: 'Test failed', description: error.message, variant: 'destructive' });
    } finally {
      setTesting(false);
    }
  };

  const handleRevoke = async () => {
    if (!activeCompanyId || !connection) return;
    if (!confirm('Revoke SRS credentials? This clears the saved secret and disconnects the integration.')) return;
    try {
      const { error } = await supabase.functions.invoke('srs-api-proxy', {
        body: { action: 'revoke_credentials', tenant_id: activeCompanyId },
      });
      if (error) throw error;
      toast({ title: 'Credentials revoked' });
      setClientSecret('');
      await loadConnection();
      await loadAudit();
    } catch (error: any) {
      toast({ title: 'Revoke failed', description: error.message, variant: 'destructive' });
    }
  };

  const handleSyncBranches = async () => {
    if (!activeCompanyId) {
      toast({ title: 'No active company', description: 'Switch to a tenant before syncing branches.', variant: 'destructive' });
      return;
    }
    setSyncing(true);
    try {
      console.log('[SRS] sync_branches invoke', { tenant_id: activeCompanyId });
      const { data, error } = await supabase.functions.invoke('srs-api-proxy', {
        body: { action: 'sync_branches', tenant_id: activeCompanyId },
      });
      console.log('[SRS] sync_branches result', { data, error });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: 'Branches synced', description: `${data?.branchCount ?? 0} branches loaded` });
      await loadBranches();
    } catch (error: any) {
      toast({ title: 'Sync failed', description: error?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  const handleSubmitTestOrder = async () => {
    if (!activeCompanyId) return;
    setSubmittingTestOrder(true);
    setTestOrderResult(null);
    try {
      const overrideBranch = branchOverride.trim();
      const { data, error } = await supabase.functions.invoke('srs-api-proxy', {
        body: {
          action: 'submit_test_order',
          tenant_id: activeCompanyId,
          ...(overrideBranch ? { branch_code: overrideBranch } : {}),
        },
      });

      if (error) throw error;
      setTestOrderResult(data);
      if (data?.success) {
        const orderNum = data?.response?.orderNumber || data?.response?.orderId || data?.response?.confirmationNumber;
        toast({
          title: 'Test order submitted to SRS STG',
          description: orderNum ? `SRS confirmation: ${orderNum}` : 'SRS accepted the order. See response below.',
        });
      } else {
        toast({
          title: 'SRS rejected test order',
          description: data?.error || 'See response below for details.',
          variant: 'destructive',
        });
      }
      await loadAudit();
    } catch (error: any) {
      toast({ title: 'Test order failed', description: error?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setSubmittingTestOrder(false);
    }
  };

  const handleSaveBranch = async (newBranch: string) => {
    if (!activeCompanyId || !newBranch) return;
    setSavingBranch(true);
    try {
      const { data, error } = await supabase.functions.invoke('srs-api-proxy', {
        body: {
          action: 'update_connection_settings',
          tenant_id: activeCompanyId,
          default_branch_code: newBranch,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: 'Default branch updated', description: `Now ordering from ${newBranch}.` });
      await loadConnection();
      await loadAudit();
    } catch (e: any) {
      toast({ title: 'Failed to update branch', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setSavingBranch(false);
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
  const rotatedAt = connection?.client_secret_rotated_at ? new Date(connection.client_secret_rotated_at) : null;
  const daysSinceRotation = rotatedAt ? Math.floor((Date.now() - rotatedAt.getTime()) / 86_400_000) : null;
  const rotationOverdue = daysSinceRotation !== null && daysSinceRotation >= ROTATION_MANDATORY_DAYS;
  const rotationDueSoon = daysSinceRotation !== null && daysSinceRotation >= ROTATION_RECOMMENDED_DAYS && !rotationOverdue;
  const canSubmitTestOrder = isConnected && !!connection?.customer_code;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <Truck className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <CardTitle>SRS Distribution</CardTitle>
                <CardDescription>Connect to SRS to order materials and track deliveries</CardDescription>
              </div>
            </div>
            <Badge variant={isConnected ? 'default' : 'secondary'}>
              {isConnected ? (
                <><CheckCircle className="h-3 w-3 mr-1" /> Connected</>
              ) : connection?.connection_status === 'error' ? (
                <><XCircle className="h-3 w-3 mr-1" /> Error</>
              ) : (
                'Disconnected'
              )}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {connection?.last_error && (
            <div className="space-y-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
              <p>{connection.last_error}</p>
            </div>
          )}

          {rotationOverdue && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Rotation overdue ({daysSinceRotation} days)</p>
                <p className="text-xs">SRS enforces credential rotation every 6 months. Rotate now to avoid integration downtime.</p>
              </div>
            </div>
          )}
          {rotationDueSoon && (
            <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Rotation recommended ({daysSinceRotation} days since last rotation)</p>
                <p className="text-xs">SRS recommends rotating credentials every 90 days.</p>
              </div>
            </div>
          )}

          {hasSecret && (
            <div className="flex items-center gap-2 p-3 bg-muted/40 border rounded-md text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              <span>
                Secret on file ending <code className="font-mono">••••{connection?.client_secret_last_four}</code>
                {rotatedAt && <> · last rotated {rotatedAt.toLocaleDateString()}</>}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Environment</Label>
              <Select value={environment} onValueChange={setEnvironment}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="staging">Staging (Testing)</SelectItem>
                  <SelectItem value="production">Production (Live)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Customer Code</Label>
              <Input value={customerCode} onChange={(e) => setCustomerCode(e.target.value)} placeholder="e.g. ABC123" />
            </div>

            <div className="space-y-2">
              <Label>Client ID</Label>
              <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="From SRS API team" />
            </div>

            <div className="space-y-2">
              <Label>Client Secret {hasSecret && <span className="text-xs text-muted-foreground">(enter to replace)</span>}</Label>
              <Input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={hasSecret ? `Leave blank to keep ••••${connection?.client_secret_last_four}` : '••••••••'}
                autoComplete="new-password"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Secrets are stored server-side and never returned to the browser. Don't have credentials? Email{' '}
            <strong>APISupportTeam@srsdistribution.com</strong> with your company name to request API access.
          </p>

          <div className="space-y-3 p-4 border rounded-md bg-muted/20">
            <div>
              <Label className="text-sm font-semibold">Validate Customer Account</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Provide an SRS-issued <strong>Integration Key</strong> (fastest) OR a recent Invoice # plus
                Invoice Date / Billed Amount. Only needed for the initial validation.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Integration Key (recommended)</Label>
              <Input value={integrationKey} onChange={(e) => setIntegrationKey(e.target.value)} placeholder="e.g. B0Z17e" />
            </div>
            <div className="text-xs text-muted-foreground">— or —</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Invoice #</Label>
                <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="e.g. 0040412114-001" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Invoice Date</Label>
                <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Billed Amount ($)</Label>
                <Input type="number" step="0.01" value={billedAmount} onChange={(e) => setBilledAmount(e.target.value)} placeholder="e.g. 1234.56" />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={() => handleSave(false)} disabled={saving || !clientId || !clientSecret}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {hasSecret ? 'Save & Replace Secret' : 'Save Credentials'}
            </Button>

            {hasSecret && (
              <Button variant="outline" onClick={() => handleSave(true)} disabled={saving || !clientSecret}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Rotate Secret
              </Button>
            )}

            {connection && (
              <Button variant="outline" onClick={handleTestConnection} disabled={testing || !connection.client_id}>
                {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
                Test Connection
              </Button>
            )}

            {isConnected && (
              <Button variant="outline" onClick={handleSyncBranches} disabled={syncing}>
                {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Sync Branches
              </Button>
            )}

            {hasSecret && (
              <Button variant="ghost" onClick={handleRevoke} className="text-destructive">
                <Unlink className="h-4 w-4 mr-2" />
                Revoke & Disconnect
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {isConnected && connection && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Connection Details</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Customer Code</span>
                <p className="font-medium">{connection.customer_code || '—'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Job Account #</span>
                <p className="font-medium">{connection.job_account_number || '—'}</p>
              </div>
              <div>
                <span className="text-muted-foreground flex items-center gap-1">
                  Default Branch {savingBranch && <Loader2 className="h-3 w-3 animate-spin" />}
                </span>
                {branches.length > 0 ? (
                  <Select
                    value={connection.default_branch_code || ''}
                    onValueChange={(v) => handleSaveBranch(v)}
                    disabled={savingBranch}
                  >
                    <SelectTrigger className="h-8 mt-1">
                      <SelectValue placeholder="Select branch" />
                    </SelectTrigger>
                    <SelectContent className="max-h-80">
                      {branches.map((b) => (
                        <SelectItem key={b.branch_code} value={b.branch_code}>
                          <span className="font-mono mr-2">{b.branch_code}</span>
                          <span className="text-muted-foreground">{b.branch_name || ''}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="font-medium">
                    {connection.default_branch_code || '—'}{' '}
                    <span className="text-xs text-muted-foreground">(sync branches to edit)</span>
                  </p>
                )}
              </div>

              <div>
                <span className="text-muted-foreground">Last Validated</span>
                <p className="font-medium">
                  {connection.last_validated_at ? new Date(connection.last_validated_at).toLocaleDateString() : '—'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isConnected && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-lg">Synced Branches</CardTitle>
                <CardDescription>
                  {branches.length > 0
                    ? `${branches.length} branches available for ordering.`
                    : 'No branches synced yet. Click "Sync Branches" above.'}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={loadBranches} disabled={loadingBranches}>
                {loadingBranches ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {branches.length === 0 ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : (
              <div className="text-xs max-h-80 overflow-auto border rounded-md">
                <div className="grid grid-cols-12 gap-2 font-medium text-muted-foreground border-b px-3 py-2 sticky top-0 bg-background">
                  <div className="col-span-2">Code</div>
                  <div className="col-span-4">Name</div>
                  <div className="col-span-3">City / State</div>
                  <div className="col-span-3">Phone</div>
                </div>
                {branches.map((b) => (
                  <div key={b.branch_code} className="grid grid-cols-12 gap-2 px-3 py-2 border-b last:border-b-0">
                    <div className="col-span-2 font-mono">{b.branch_code}</div>
                    <div className="col-span-4 truncate">{b.branch_name || '—'}</div>
                    <div className="col-span-3 truncate text-muted-foreground">
                      {[b.city, b.state].filter(Boolean).join(', ') || '—'}
                    </div>
                    <div className="col-span-3 truncate text-muted-foreground">{b.phone || '—'}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isConnected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">SRS Staging End-to-End Test</CardTitle>
            <CardDescription>
              Sends a real test order to SRS staging using the default branch ({connection?.default_branch_code || 'SRORL'})
              and customer code {connection?.customer_code || '—'}. SRS uses the round-trip response to confirm certification.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              onClick={handleSubmitTestOrder}
              disabled={submittingTestOrder || !canSubmitTestOrder}
            >
              {submittingTestOrder ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Truck className="h-4 w-4 mr-2" />}
              Send Test Order to SRS
            </Button>
            {!canSubmitTestOrder && (
              <p className="text-xs text-muted-foreground">
                Validate the customer connection first so the test order can use the SRS customer code.
              </p>
            )}
            {testOrderResult && (
              <div className="space-y-2">
                <div className={`flex items-center gap-2 text-sm font-medium ${testOrderResult.success ? 'text-emerald-600' : 'text-destructive'}`}>
                  {testOrderResult.success ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  {testOrderResult.success ? 'SRS accepted the order' : 'SRS rejected the order'}
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">SRS Response</p>
                  <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-64">
{JSON.stringify(testOrderResult.response, null, 2)}
                  </pre>
                </div>
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">View request payload sent to SRS</summary>
                  <pre className="bg-muted p-3 rounded-md overflow-auto max-h-64 mt-2">
{JSON.stringify(testOrderResult.request, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isConnected && <SrsDiagnosticsPanel />}

      {audit.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Credential Activity</CardTitle>
            <CardDescription>Credential, validation, and test-order events only. Real job order status is shown above.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-xs">
              <div className="grid grid-cols-12 gap-2 font-medium text-muted-foreground border-b pb-2">
                <div className="col-span-3">When</div>
                <div className="col-span-2">Action</div>
                <div className="col-span-1">Status</div>
                <div className="col-span-3">User</div>
                <div className="col-span-3">IP / Detail</div>
              </div>
              {audit.map((row) => (
                <div key={row.id} className="grid grid-cols-12 gap-2 py-2 border-b last:border-b-0">
                  <div className="col-span-3">{new Date(row.created_at).toLocaleString()}</div>
                  <div className="col-span-2 font-mono">{row.action}</div>
                  <div className="col-span-1">
                    {row.success ? (
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-destructive" />
                    )}
                  </div>
                  <div className="col-span-3 truncate">{row.actor_email || '—'}</div>
                  <div className="col-span-3 truncate text-muted-foreground">
                    {row.error || row.ip_address || '—'}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
