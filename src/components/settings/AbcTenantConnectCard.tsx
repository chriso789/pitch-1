// Tenant-facing ABC Supply connect card.
//
// Normal contractors NEVER see OAuth URLs, account-number inputs, branch
// inputs, ship-to inputs, or any developer diagnostics. They get exactly:
//
//   * Status badge (Disconnected / Connecting / Connected / Expired / Error)
//   * One button: Connect ABC Account → ABC Okta OAuth → callback
//   * After connect: the ship-to accounts + branches ABC returned
//   * Disconnect button
//
// Everything else (account number, branch picker, ship-to picker) is
// populated by the post-callback sync, not by user input. This matches
// ABC's partner integration model — the customer logs into ABC with their
// own identity, and ABC tells us which accounts/branches/ship-tos they
// have access to.

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CheckCircle,
  XCircle,
  ExternalLink,
  Loader2,
  Truck,
  Unlink,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useAbcConnectionStatus } from '@/hooks/useAbcConnectionStatus';
import { useAbcAccounts } from '@/lib/abc/useAbcConnection';
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

export function AbcTenantConnectCard() {
  const tenantId = useEffectiveTenantId();
  const status = useAbcConnectionStatus();
  const accountsQuery = useAbcAccounts();
  const { toast } = useToast();
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const isConnected = status.state === 'connected';

  const handleConnect = async () => {
    if (!tenantId) {
      toast({ title: 'No active company', variant: 'destructive' });
      return;
    }
    setConnecting(true);
    // Pre-open a popup so we don't lose the user gesture during the
    // server round-trip. ABC OAuth requires Okta login + redirect.
    let popup: Window | null = null;
    try {
      popup = window.open('about:blank', '_blank');
    } catch {
      popup = null;
    }
    try {
      const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
        body: {
          action: 'start_oauth',
          tenant_id: tenantId,
          // Tenant OAuth always uses production myABCsupply; sandbox is
          // developer-tools-only and would reject real customer credentials.
          environment: 'production',
          return_origin: window.location.origin,
        },
      });
      if (error) throw error;
      const url: string | undefined = (data as any)?.authorization_url;
      if (!url) {
        throw new Error((data as any)?.human_message || 'ABC did not return an authorization URL.');
      }
      if (popup && !popup.closed) {
        popup.location.replace(url);
      } else {
        window.location.href = url;
      }
      toast({
        title: 'Redirecting to ABC Supply',
        description: 'Log in with your ABC account to finish connecting.',
      });
    } catch (e: any) {
      if (popup && !popup.closed) popup.close();
      toast({
        title: 'Could not start ABC connection',
        description: e?.message ?? 'Please try again or contact support.',
        variant: 'destructive',
      });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!tenantId) return;
    if (!confirm('Disconnect ABC Supply? You will need to log in again to reconnect.')) return;
    setDisconnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
        body: {
          action: 'disconnect',
          tenant_id: tenantId,
          environment: status.environment || 'production',
        },
      });
      if (error) throw error;
      if ((data as any)?.success === false) {
        throw new Error((data as any)?.human_message || (data as any)?.error || 'Disconnect failed');
      }
      toast({ title: 'ABC Supply disconnected' });
      await status.refresh();
      await accountsQuery.refetch();
    } catch (e: any) {
      toast({ title: 'Disconnect failed', description: e?.message, variant: 'destructive' });
    } finally {
      setDisconnecting(false);
    }
  };

  const accounts = accountsQuery.data ?? [];
  const totalBranches = accounts.reduce((n, a) => n + (a.branches?.length ?? 0), 0);
  const primaryBranch = accounts.flatMap((a) => a.branches).find((b) => b.is_home_branch || b.is_default);

  return (
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
                Sync pricing, product availability, and material ordering directly from your ABC Supply account.
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
              You'll be redirected to ABC Supply to log in. After login, your accounts, branches,
              and ship-to locations will populate automatically — no account numbers or branch
              codes to type.
            </p>
            <Button onClick={handleConnect} disabled={connecting || !tenantId}>
              {connecting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4 mr-2" />
              )}
              {status.state === 'expired' || status.state === 'error'
                ? 'Reconnect ABC Account'
                : 'Connect ABC Account'}
            </Button>
          </div>
        )}

        {isConnected && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Ship-To accounts</div>
                <div className="text-2xl font-semibold">{accounts.length}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Branches</div>
                <div className="text-2xl font-semibold">{totalBranches}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Primary branch</div>
                <div className="text-sm font-medium truncate">
                  {primaryBranch
                    ? `${primaryBranch.branch_number}${primaryBranch.name ? ` · ${primaryBranch.name}` : ''}`
                    : status.defaultBranchCode || '—'}
                </div>
              </div>
            </div>

            {accountsQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts from ABC…
              </div>
            ) : accounts.length === 0 ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                No ship-to accounts have synced yet. This can take a moment after first connect —
                use Refresh, or contact support if it persists.
              </div>
            ) : (
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ship-To</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="w-32">Branches</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accounts.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono text-xs">
                          {a.ship_to_number}
                          {a.is_default && (
                            <Badge variant="secondary" className="ml-2 text-[10px]">Default</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-medium">{a.name || '—'}</div>
                          <div className="text-muted-foreground">
                            {[a.address_line1, a.city, a.state, a.postal_code].filter(Boolean).join(', ')}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {a.branches?.length ?? 0}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void status.refresh();
                  void accountsQuery.refetch();
                }}
                disabled={accountsQuery.isFetching}
              >
                {accountsQuery.isFetching ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Refresh
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
    </Card>
  );
}
