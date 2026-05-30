// Tenant-facing SRS Distribution connect card.
//
// Normal contractors see ONLY:
//   * Status badge
//   * One "Connect SRS Account" button -> minimal modal
//   * After connect: Customer Code, Branch/Ship-To counts, Last Sync,
//     View Orders, Disconnect
//
// All developer surface area (API URLs, audit log, raw payloads, sandbox
// toggles, branch picker, test orders) stays in the legacy panel which is
// rendered only when `useSupplierDeveloperMode().canSeeRawDiagnostics` is
// true. This card never exposes any of that.
//
// SRS is NOT OAuth — credentials are owned by the tenant. The modal
// collects: Customer Code, Client ID, Client Secret, Integration Key
// (required), plus optional invoice trio as an alternate validation path.

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
import { useSrsConnectionStatus } from '@/hooks/useSrsConnectionStatus';
import { useToast } from '@/hooks/use-toast';

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

export function SrsTenantConnectCard() {
  const tenantId = useEffectiveTenantId();
  const status = useSrsConnectionStatus();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Modal fields
  const [customerCode, setCustomerCode] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [integrationKey, setIntegrationKey] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [billedAmount, setBilledAmount] = useState('');

  const resetForm = () => {
    setCustomerCode('');
    setClientId('');
    setClientSecret('');
    setIntegrationKey('');
    setInvoiceNumber('');
    setInvoiceDate('');
    setBilledAmount('');
  };

  const handleConnect = async () => {
    if (!tenantId) {
      toast({ title: 'No active company', variant: 'destructive' });
      return;
    }
    if (!customerCode.trim() || !clientId.trim() || !clientSecret.trim()) {
      toast({
        title: 'Missing required fields',
        description: 'Customer Code, Client ID, and Client Secret are required.',
        variant: 'destructive',
      });
      return;
    }
    const hasValidator =
      integrationKey.trim() ||
      (invoiceNumber.trim() && (invoiceDate.trim() || billedAmount.trim()));
    if (!hasValidator) {
      toast({
        title: 'Validation info required',
        description:
          'Provide an SRS Integration Key OR Invoice # plus Invoice Date / Billed Amount.',
        variant: 'destructive',
      });
      return;
    }
    setBusy(true);
    try {
      // Step 1: Save credentials
      const saveRes = await supabase.functions.invoke('srs-api-proxy', {
        body: {
          action: 'save_credentials',
          tenant_id: tenantId,
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
          customer_code: customerCode.trim(),
          environment: 'production',
          integration_key: integrationKey.trim() || undefined,
        },
      });
      if (saveRes.error) throw saveRes.error;
      if (!(saveRes.data as any)?.success) {
        throw new Error((saveRes.data as any)?.error || 'Failed to save credentials');
      }

      // Step 2: Validate
      const valRes = await supabase.functions.invoke('srs-api-proxy', {
        body: {
          action: 'validate_connection',
          tenant_id: tenantId,
          integration_key: integrationKey.trim() || undefined,
          invoice_number: invoiceNumber.trim() || undefined,
          invoice_date: invoiceDate.trim() || undefined,
          billed_amount: billedAmount.trim() || undefined,
        },
      });
      if (valRes.error) throw valRes.error;
      if (!(valRes.data as any)?.success) {
        throw new Error(
          (valRes.data as any)?.error ||
            'SRS could not validate your account. Double-check the invoice / integration key.',
        );
      }

      // Step 3: Sync branches (best-effort)
      try {
        await supabase.functions.invoke('srs-api-proxy', {
          body: { action: 'sync_branches', tenant_id: tenantId },
        });
      } catch (e) {
        console.warn('[SRS] sync_branches after connect failed', e);
      }

      toast({
        title: 'SRS Distribution connected',
        description: 'Branches and ship-to locations are syncing.',
      });
      resetForm();
      setOpen(false);
      await status.refresh();
    } catch (e: any) {
      toast({
        title: 'Could not connect SRS',
        description: e?.message ?? 'Please try again or contact support.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!tenantId) return;
    if (
      !confirm('Disconnect SRS Distribution? Saved credentials will be removed.')
    )
      return;
    setDisconnecting(true);
    try {
      const { error, data } = await supabase.functions.invoke('srs-api-proxy', {
        body: { action: 'revoke_credentials', tenant_id: tenantId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: 'SRS Distribution disconnected' });
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
            <div className="h-10 w-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <Truck className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <CardTitle>SRS Distribution</CardTitle>
              <CardDescription>
                Order materials, sync branches, and track deliveries through your SRS Distribution account.
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
              Connect using credentials issued by SRS. Branches and ship-to locations will sync automatically.
            </p>
            <Button onClick={() => setOpen(true)} disabled={!tenantId}>
              <Link2 className="h-4 w-4 mr-2" />
              {status.state === 'expired' || status.state === 'error'
                ? 'Reconnect SRS Account'
                : 'Connect SRS Account'}
            </Button>
          </div>
        )}

        {isConnected && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Customer Code</div>
                <div className="text-sm font-semibold truncate">
                  {status.row?.customer_code || '—'}
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect SRS Distribution</DialogTitle>
            <DialogDescription>
              Enter the credentials issued by SRS. Don't have them? Email{' '}
              <strong>APISupportTeam@srsdistribution.com</strong> to request API access.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Customer Code</Label>
              <Input
                value={customerCode}
                onChange={(e) => setCustomerCode(e.target.value)}
                placeholder="e.g. ABC123"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Client ID</Label>
                <Input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="From SRS"
                />
              </div>
              <div className="space-y-1">
                <Label>Client Secret</Label>
                <Input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Integration Key (recommended)</Label>
              <Input
                value={integrationKey}
                onChange={(e) => setIntegrationKey(e.target.value)}
                placeholder="e.g. B0Z17e"
              />
            </div>
            <div className="text-xs text-muted-foreground text-center">— or validate with a recent invoice —</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Invoice #</Label>
                <Input
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="0040412114-001"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Amount ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={billedAmount}
                  onChange={(e) => setBilledAmount(e.target.value)}
                  placeholder="1234.56"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleConnect} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Connect & Sync
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
