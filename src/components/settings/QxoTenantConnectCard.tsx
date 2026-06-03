// Tenant-facing QXO / Beacon connect card.
//
// Normal contractors see ONLY:
//   * Status badge
//   * "Connect QXO Account" button -> minimal modal
//   * After connect: Account/Profile, Branch counts, Last Sync, View Orders,
//     Disconnect
//
// Sandbox/staging selectors, raw diagnostics, browser, AR dashboard, and
// activity panels stay in the legacy panel gated by
// `useSupplierDeveloperMode().canSeeRawDiagnostics`.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  CheckCircle,
  XCircle,
  Loader2,
  Truck,
  Unlink,
  RefreshCw,
  Link2,
  ExternalLink,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useQxoConnectionStatus } from '@/hooks/useQxoConnectionStatus';
import { useToast } from '@/hooks/use-toast';
import { useSupplierDeveloperMode } from '@/lib/supplierAccess';

function StatusBadge({ state }: { state: string }) {
  switch (state) {
    case 'connected':
      return (
        <Badge variant="default" className="gap-1">
          <CheckCircle className="h-3 w-3" /> Connected
        </Badge>
      );
    case 'pending':
      return <Badge variant="secondary">Connecting…</Badge>;
    case 'expired':
      return <Badge variant="secondary">Expired — Reconnect</Badge>;
    case 'error':
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" /> Error
        </Badge>
      );
    case 'unknown':
      return <Badge variant="secondary">…</Badge>;
    default:
      return <Badge variant="secondary">Not Connected</Badge>;
  }
}

export function QxoTenantConnectCard() {
  const tenantId = useEffectiveTenantId();
  const status = useQxoConnectionStatus();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [clientId, setClientId] = useState('');
  const [siteId, setSiteId] = useState('dealersChoice');

  const resetForm = () => {
    setUsername('');
    setPassword('');
    setClientId('');
    setSiteId('dealersChoice');
  };

  const handleConnect = async () => {
    if (!tenantId) {
      toast({ title: 'No active company', variant: 'destructive' });
      return;
    }
    if (!username.trim() || !password.trim()) {
      toast({
        title: 'Missing required fields',
        description: 'Username and password are required.',
        variant: 'destructive',
      });
      return;
    }
    setBusy(true);
    try {
      // Step 1: Save credentials
      const saveRes = await supabase.functions.invoke('qxo-save-credentials', {
        body: {
          tenant_id: tenantId,
          username: username.trim(),
          password,
          client_id: clientId.trim() || null,
          site_id: siteId,
          environment: 'production',
        },
      });
      if (saveRes.error) throw saveRes.error;
      if (!(saveRes.data as any)?.success) {
        throw new Error((saveRes.data as any)?.error || 'Failed to save credentials');
      }

      // Step 2: Validate
      const valRes = await supabase.functions.invoke('qxo-api-proxy', {
        body: { action: 'validate_connection', tenant_id: tenantId },
      });
      if (valRes.error) throw valRes.error;
      if (!(valRes.data as any)?.success) {
        throw new Error(
          (valRes.data as any)?.error ||
            'QXO could not validate your credentials.',
        );
      }

      toast({
        title: 'QXO / Beacon connected',
        description: 'Your account is linked and ready for ordering.',
      });
      resetForm();
      setOpen(false);
      await status.refresh();
    } catch (e: any) {
      toast({
        title: 'Could not connect QXO',
        description: e?.message ?? 'Please try again or contact support.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!tenantId) return;
    if (!confirm('Disconnect QXO / Beacon? Saved credentials will be removed.')) return;
    setDisconnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('qxo-save-credentials', {
        body: { tenant_id: tenantId, clear: true },
      });
      if (error) throw error;
      if (!(data as any)?.success) throw new Error((data as any)?.error || 'Disconnect failed');
      toast({ title: 'QXO / Beacon disconnected' });
      await status.refresh();
    } catch (e: any) {
      toast({
        title: 'Disconnect failed',
        description: e?.message,
        variant: 'destructive',
      });
    } finally {
      setDisconnecting(false);
    }
  };

  const isConnected = status.state === 'connected';
  const lastSync = status.row?.last_validated_at
    ? new Date(status.row.last_validated_at)
    : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Truck className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <CardTitle>QXO / Beacon</CardTitle>
              <CardDescription>
                Order materials, sync branches, and pull pricing from your QXO / Beacon account.
              </CardDescription>
            </div>
          </div>
          <StatusBadge state={status.state} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isConnected && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Link your QXO / Beacon account. Branches and ship-to locations will sync automatically after connect.
            </p>
            <Button onClick={() => setOpen(true)} disabled={!tenantId}>
              <Link2 className="h-4 w-4 mr-2" />
              {status.state === 'expired' || status.state === 'error'
                ? 'Reconnect QXO Account'
                : 'Connect QXO Account'}
            </Button>
          </div>
        )}

        {isConnected && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Account</div>
                <div className="text-sm font-semibold truncate">
                  {status.row?.account_id || status.row?.profile_id || '—'}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Branches</div>
                <div className="text-2xl font-semibold">{status.branchCount}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Ship-To</div>
                <div className="text-2xl font-semibold">{status.shipToCount}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Last Sync</div>
                <div className="text-sm font-medium">
                  {lastSync ? lastSync.toLocaleDateString() : '—'}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void status.refresh()}
                disabled={status.loading}
              >
                {status.loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Refresh
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/orders/history">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  View Orders
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="text-destructive hover:text-destructive"
              >
                {disconnecting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Unlink className="h-4 w-4 mr-2" />
                )}
                Disconnect
              </Button>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Connect QXO / Beacon</DialogTitle>
            <DialogDescription>
              Enter the credentials issued to you by QXO / Beacon partner integrations.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Site / Realm</Label>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dealersChoice">Beacon (dealersChoice)</SelectItem>
                  <SelectItem value="homeSite">HomeSite</SelectItem>
                  <SelectItem value="canada">Canada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Username / Email</Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="you@company.com"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label>Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1">
              <Label>API Client ID</Label>
              <Input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Provided by QXO partner integrations"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Required for orders, quotes, and invoices via v2 endpoints.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleConnect} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Connect & Validate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
