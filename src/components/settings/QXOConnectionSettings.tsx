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
import { Loader2, CheckCircle, XCircle, Link2, Unlink, Truck, ShieldCheck } from 'lucide-react';
import { QXOArDashboard } from './QXOArDashboard';
import { QXOActivityPanel } from './QXOActivityPanel';
import { QXOBrowser } from './QXOBrowser';

// NOTE: Secrets (username/password/client_id/tokens) are stored in the
// service-role-only `qxo_credentials` table and are never read by the
// browser. This component only ever sees non-sensitive status fields.
interface QXOConnection {
  id: string;
  tenant_id: string;
  site_id: string | null;
  account_id: string | null;
  profile_id: string | null;
  default_branch_code: string | null;
  connection_status: string;
  last_validated_at: string | null;
  last_error: string | null;
  valid_indicator: boolean;
  environment: string;
  has_credentials: boolean;
}

export function QXOConnectionSettings() {
  const { activeCompanyId } = useCompanySwitcher();
  const { canChangeEnvironment } = useSupplierDeveloperMode();
  const { toast } = useToast();

  const [connection, setConnection] = useState<QXOConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Credential inputs are always blank — we never hydrate secrets back to the UI.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [clientId, setClientId] = useState('');
  const [siteId, setSiteId] = useState('dealersChoice');
  const [environment, setEnvironment] = useState('staging');

  useEffect(() => {
    if (activeCompanyId) loadConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId]);

  const loadConnection = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from('qxo_connections')
        .select('id, tenant_id, site_id, account_id, profile_id, default_branch_code, connection_status, last_validated_at, last_error, valid_indicator, environment, has_credentials')
        .eq('tenant_id', activeCompanyId)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setConnection(data);
        setSiteId(data.site_id || 'dealersChoice');
        setEnvironment(data.environment || 'staging');
      }
    } catch (error) {
      console.error('Failed to load QXO connection:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!activeCompanyId) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('qxo-save-credentials', {
        body: {
          tenant_id: activeCompanyId,
          username,
          password,
          client_id: clientId || null,
          site_id: siteId,
          environment,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Save failed');
      toast({ title: 'QXO credentials saved', description: 'Click "Test Connection" to validate.' });
      // Clear the password field after save; never re-display secrets.
      setPassword('');
      await loadConnection();
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
      const { data, error } = await supabase.functions.invoke('qxo-api-proxy', {
        body: { action: 'validate_connection', tenant_id: activeCompanyId },
      });
      if (error) throw error;
      if (data?.success) {
        toast({ title: 'Connection successful!', description: `Profile: ${data.profileId || 'N/A'}` });
      } else {
        toast({ title: 'Connection failed', description: data?.error || 'Validation failed', variant: 'destructive' });
      }
      await loadConnection();
    } catch (error: any) {
      toast({ title: 'Test failed', description: error.message, variant: 'destructive' });
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!activeCompanyId) return;
    try {
      const { data, error } = await supabase.functions.invoke('qxo-save-credentials', {
        body: { tenant_id: activeCompanyId, clear: true },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Disconnect failed');
      toast({ title: 'Disconnected from QXO', description: 'Stored credentials were removed.' });
      setUsername('');
      setPassword('');
      setClientId('');
      await loadConnection();
    } catch (error: any) {
      toast({ title: 'Disconnect failed', description: error.message, variant: 'destructive' });
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
  const hasCredentials = !!connection?.has_credentials;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Truck className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <CardTitle>QXO / Beacon</CardTitle>
                <CardDescription>Connect to QXO (Beacon) to order materials, pull pricing, and sync invoices</CardDescription>
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
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
              {connection.last_error}
            </div>
          )}

          {hasCredentials && (
            <div className="p-3 bg-muted/40 border rounded-md text-sm flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 mt-0.5 text-green-600" />
              <div>
                <div className="font-medium">Credentials stored securely</div>
                <div className="text-muted-foreground text-xs">
                  Username, password, and API client ID are encrypted server-side and never sent to the browser.
                  Re-enter them only if you need to update or rotate.
                </div>
              </div>
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
              <Label>Site / Realm</Label>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dealersChoice">Beacon (dealersChoice)</SelectItem>
                  <SelectItem value="homeSite">HomeSite</SelectItem>
                  <SelectItem value="canada">Canada</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Username / Email</Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={hasCredentials ? '•••••• (set — re-enter to change)' : 'you@company.com'}
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label>Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={hasCredentials ? '•••••• (set — re-enter to change)' : '••••••••'}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>API Client ID</Label>
              <Input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder={hasCredentials ? '•••••• (set — re-enter to change)' : 'Provided by QXO/Beacon partner integrations'}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Required to obtain Bearer access tokens for v2 endpoints (orders, quotes, invoices).
              </p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Don't have API access? Contact your QXO/Beacon partner integrations rep to get your credentials and client_id provisioned.
          </p>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving || !username || !password}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {hasCredentials ? 'Update Credentials' : 'Save Credentials'}
            </Button>

            {hasCredentials && (
              <Button
                variant="outline"
                onClick={handleTestConnection}
                disabled={testing}
              >
                {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
                Test Connection
              </Button>
            )}

            {hasCredentials && (
              <Button variant="ghost" onClick={handleDisconnect} className="text-destructive">
                <Unlink className="h-4 w-4 mr-2" />
                Disconnect
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {isConnected && activeCompanyId && (
        <>
          <QXOBrowser tenantId={activeCompanyId} />
          <QXOArDashboard tenantId={activeCompanyId} />
          <QXOActivityPanel tenantId={activeCompanyId} />
        </>
      )}
    </div>
  );
}
