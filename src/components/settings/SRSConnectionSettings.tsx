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
import { Loader2, CheckCircle, XCircle, Link2, Unlink, Truck, RefreshCw } from 'lucide-react';

interface SRSConnection {
  id: string;
  tenant_id: string;
  customer_code: string | null;
  client_id: string | null;
  client_secret: string | null;
  connection_status: string;
  last_validated_at: string | null;
  last_error: string | null;
  job_account_number: number | null;
  default_branch_code: string | null;
  valid_indicator: boolean;
  environment: string;
}

export function SRSConnectionSettings() {
  const { activeCompanyId } = useCompanySwitcher();
  const { toast } = useToast();
  const [connection, setConnection] = useState<SRSConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [customerCode, setCustomerCode] = useState('');
  const [environment, setEnvironment] = useState('staging');

  useEffect(() => {
    if (activeCompanyId) loadConnection();
  }, [activeCompanyId]);

  const loadConnection = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from('srs_connections')
        .select('*')
        .eq('tenant_id', activeCompanyId)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setConnection(data);
        setClientId(data.client_id || '');
        setClientSecret(data.client_secret || '');
        setCustomerCode(data.customer_code || '');
        setEnvironment(data.environment || 'staging');
      }
    } catch (error) {
      console.error('Failed to load SRS connection:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!activeCompanyId) return;
    setSaving(true);
    try {
      const payload = {
        tenant_id: activeCompanyId,
        client_id: clientId,
        client_secret: clientSecret,
        customer_code: customerCode,
        environment,
        connection_status: 'disconnected',
      };

      if (connection) {
        const { error } = await (supabase as any)
          .from('srs_connections')
          .update(payload)
          .eq('id', connection.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from('srs_connections')
          .insert(payload);
        if (error) throw error;
      }

      toast({ title: 'SRS credentials saved', description: 'Click "Test Connection" to validate.' });
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
      // Update status to validating
      await (supabase as any)
        .from('srs_connections')
        .update({ connection_status: 'validating' })
        .eq('tenant_id', activeCompanyId);

      const { data, error } = await supabase.functions.invoke('srs-api-proxy', {
        body: {
          action: 'validate_connection',
          tenant_id: activeCompanyId,
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast({ title: 'Connection successful!', description: `Customer validated. Account: ${data.jobAccountNumber || 'N/A'}` });
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
    if (!connection) return;
    try {
      await (supabase as any)
        .from('srs_connections')
        .update({ 
          connection_status: 'disconnected',
          access_token: null,
          token_expires_at: null,
          valid_indicator: false,
        })
        .eq('id', connection.id);

      toast({ title: 'Disconnected from SRS' });
      await loadConnection();
    } catch (error: any) {
      toast({ title: 'Disconnect failed', description: error.message, variant: 'destructive' });
    }
  };

  const handleSyncBranches = async () => {
    if (!activeCompanyId) return;
    try {
      const { data, error } = await supabase.functions.invoke('srs-api-proxy', {
        body: {
          action: 'sync_branches',
          tenant_id: activeCompanyId,
        }
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
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
              {connection.last_error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Environment</Label>
              <Select value={environment} onValueChange={setEnvironment}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="staging">Staging (Testing)</SelectItem>
                  <SelectItem value="production">Production (Live)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Customer Code</Label>
              <Input
                value={customerCode}
                onChange={(e) => setCustomerCode(e.target.value)}
                placeholder="e.g. ABC123"
              />
            </div>

            <div className="space-y-2">
              <Label>Client ID</Label>
              <Input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="From SRS API team"
              />
            </div>

            <div className="space-y-2">
              <Label>Client Secret</Label>
              <Input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Don't have credentials? Email <strong>APISupportTeam@srsdistribution.com</strong> with your company name to request API access.
          </p>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving || !clientId || !clientSecret}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Credentials
            </Button>

            {connection && (
              <Button 
                variant="outline" 
                onClick={handleTestConnection} 
                disabled={testing || !connection.client_id}
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4 mr-2" />
                )}
                Test Connection
              </Button>
            )}

            {isConnected && (
              <>
                <Button variant="outline" onClick={handleSyncBranches}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Sync Branches
                </Button>
                <Button variant="ghost" onClick={handleDisconnect} className="text-destructive">
                  <Unlink className="h-4 w-4 mr-2" />
                  Disconnect
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Connection Details */}
      {isConnected && connection && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Connection Details</CardTitle>
          </CardHeader>
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
                  {connection.last_validated_at
                    ? new Date(connection.last_validated_at).toLocaleDateString()
                    : '—'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
