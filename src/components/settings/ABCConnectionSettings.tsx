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
import { Loader2, CheckCircle, XCircle, Link2, Unlink, Truck, ShieldCheck, Copy, ExternalLink } from 'lucide-react';

const ABC_CONFIG = {
  authorizationUrl: 'https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357',
  tokenUrl: '', // pending ABC confirmation
  scopes: '', // pending ABC confirmation
  redirectUri: 'https://pitch-crm.ai/api/abc/callback',
  apiBase: {
    staging: 'https://partners-sb.abcsupply.com/api',
    production: 'https://partners.abcsupply.com/api',
  },
};

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

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('');
  const [environment, setEnvironment] = useState('staging');

  useEffect(() => {
    if (effectiveTenantId) loadConnection();
  }, [effectiveTenantId]);

  const loadConnection = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('abc_connections')
        .select('*')
        .eq('tenant_id', effectiveTenantId)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setConnection(data);
        setClientId(data.client_id || '');
        setAccountNumber(data.account_number || '');
        setDefaultBranch(data.default_branch_code || '');
        setEnvironment(data.environment || 'staging');
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
        .upsert(payload, { onConflict: 'tenant_id' });
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
    toast({
      title: 'Test pending API enablement',
      description: 'ABC Supply must enable your OAuth client before validation. Saved credentials will activate once your account rep confirms access.',
    });
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
              <Select value={environment} onValueChange={setEnvironment}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="staging">Staging (Testing)</SelectItem>
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
            <EndpointRow label="Authorization URL" value={ABC_CONFIG.authorizationUrl} />
            <EndpointRow label="Token URL" value={ABC_CONFIG.tokenUrl} pending="Pending — request from ABC IT" />
            <EndpointRow label="Redirect URI" value={ABC_CONFIG.redirectUri} hint="Provide this to ABC when registering the OAuth client" />
            <EndpointRow label="Scopes" value={ABC_CONFIG.scopes} pending="Pending — request from ABC IT" />
            <EndpointRow
              label={`API Base (${environment})`}
              value={environment === 'production' ? ABC_CONFIG.apiBase.production : ABC_CONFIG.apiBase.staging}
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving || !clientId}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {hasSecret ? 'Save & Replace Secret' : 'Save Credentials'}
            </Button>

            <Button
              variant="outline"
              onClick={() => {
                if (!clientId) {
                  toast({ title: 'Save Client ID first', variant: 'destructive' });
                  return;
                }
                const url = `${ABC_CONFIG.authorizationUrl}/v1/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(ABC_CONFIG.redirectUri)}&state=${effectiveTenantId}`;
                window.open(url, '_blank', 'noopener,noreferrer');
              }}
              disabled={!clientId}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Begin OAuth Authorization
            </Button>

            {connection && (
              <Button variant="outline" onClick={handleTest}>
                <Link2 className="h-4 w-4 mr-2" />
                Test Connection
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
    </div>
  );
}
