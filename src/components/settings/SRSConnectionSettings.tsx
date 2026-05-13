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

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [customerCode, setCustomerCode] = useState('');
  const [environment, setEnvironment] = useState('staging');

  useEffect(() => {
    if (activeCompanyId) {
      loadConnection();
      loadAudit();
    }
  }, [activeCompanyId]);

  const loadConnection = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from('srs_connections')
        .select('id, tenant_id, customer_code, client_id, client_secret_last_four, client_secret_rotated_at, connection_status, last_validated_at, last_error, job_account_number, default_branch_code, valid_indicator, environment')
        .eq('tenant_id', activeCompanyId)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setConnection(data);
        setClientId(data.client_id || '');
        setClientSecret('');
        setCustomerCode(data.customer_code || '');
        setEnvironment(data.environment || 'staging');
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
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('srs-api-proxy', {
        body: { action: 'validate_connection', tenant_id: activeCompanyId },
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
    if (!activeCompanyId) return;
    try {
      const { data, error } = await supabase.functions.invoke('srs-api-proxy', {
        body: { action: 'sync_branches', tenant_id: activeCompanyId },
      });
      if (error) throw error;
      toast({ title: 'Branches synced', description: `${data?.branchCount || 0} branches loaded` });
    } catch (error: any) {
      toast({ title: 'Sync failed', description: error.message, variant: 'destructive' });
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
              <Button variant="outline" onClick={handleSyncBranches}>
                <RefreshCw className="h-4 w-4 mr-2" />
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
                <span className="text-muted-foreground">Default Branch</span>
                <p className="font-medium">{connection.default_branch_code || '—'}</p>
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

      {audit.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Credential Activity</CardTitle>
            <CardDescription>Most recent 20 events. Use this to detect unusual access.</CardDescription>
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
