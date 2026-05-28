/**
 * ABC Webhook Panel — developer-only.
 *
 * Renders inside the Advanced / Developer Details section of ABCConnectionSettings.
 * Lets a developer/O'Brien sandbox user:
 *  - Register a new ABC webhook (sandbox-first, calls supplier-api → register_webhook)
 *  - List existing local webhook rows for the tenant
 *  - See callback URL, environment, subscribed events, secret_stored, last activity,
 *    last event type, last quarantine reason.
 *
 * Never renders the webhook secret value or any Authorization header.
 */

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Webhook, ShieldCheck, AlertTriangle, Copy, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props {
  tenantId: string | null;
  environment: 'sandbox' | 'production';
}

interface WebhookRow {
  id: string;
  webhook_id: string | null;
  status: string | null;
  environment: string | null;
  events: string[] | null;
  url: string | null;
  active_since: string | null;
  last_event_received_at: string | null;
  created_at: string | null;
}

interface LastEvent {
  event_type: string | null;
  quarantine_reason: string | null;
  signature_valid: boolean | null;
  created_at: string | null;
}

export function AbcWebhookPanel({ tenantId, environment }: Props) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [lastEvents, setLastEvents] = useState<Record<string, LastEvent | null>>({});
  const [error, setError] = useState<string | null>(null);

  const loadWebhooks = async () => {
    if (!tenantId) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
        body: { action: 'list_webhooks', tenant_id: tenantId, environment },
      });
      if (error) throw error;
      const rows: WebhookRow[] = (data as any)?.webhooks ?? [];
      setWebhooks(rows);

      // Pull the latest event per webhook (small, capped)
      const ids = rows.map((r) => r.id);
      if (ids.length) {
        const { data: ev } = await supabase
          .from('abc_webhook_events')
          .select('webhook_id,event_type,quarantine_reason,signature_valid,created_at')
          .in('webhook_id', ids)
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
          .limit(50);
        const map: Record<string, LastEvent | null> = {};
        for (const id of ids) map[id] = null;
        for (const e of (ev as any[]) ?? []) {
          if (!map[e.webhook_id]) map[e.webhook_id] = e as LastEvent;
        }
        setLastEvents(map);
      } else {
        setLastEvents({});
      }
    } catch (e: any) {
      setError(e?.message || 'list_webhooks failed');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (tenantId) loadWebhooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, environment]);

  const handleRegister = async () => {
    if (!tenantId) return;
    setRegistering(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
        body: { action: 'register_webhook', tenant_id: tenantId, environment },
      });
      if (error) throw error;
      const d = data as any;
      if (d?.success === false) {
        toast({
          title: 'ABC registration failed',
          description: d?.interpretation || d?.error || 'See diagnostics',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Webhook registered',
          description: `Callback: ${d?.callback_url ?? '—'} (secret stored)`,
        });
      }
      await loadWebhooks();
    } catch (e: any) {
      setError(e?.message || 'register_webhook failed');
    } finally {
      setRegistering(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    toast({ title: 'Copied', description: text.length > 60 ? `${text.slice(0, 60)}…` : text });
  };

  return (
    <div className="rounded-md border p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Webhook className="h-4 w-4" /> ABC Webhooks ({environment})
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={loadWebhooks} disabled={busy || !tenantId}>
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
            List
          </Button>
          <Button size="sm" onClick={handleRegister} disabled={registering || !tenantId}>
            {registering ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1" />}
            Register ABC Webhook
          </Button>
        </div>
      </div>

      <p className="text-muted-foreground">
        Sandbox-first. No HMAC — ABC issues an opaque secret per registration. The secret is stored
        server-side and never displayed. ABC retries on non-2xx, so duplicate deliveries return 200.
      </p>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5" />
          <span className="text-destructive">{error}</span>
        </div>
      )}

      {!tenantId && (
        <p className="text-muted-foreground">No tenant resolved — sign in to a tenant to register webhooks.</p>
      )}

      {webhooks.length === 0 && tenantId && !busy && (
        <p className="text-muted-foreground">No webhooks registered for this tenant yet.</p>
      )}

      {webhooks.map((w) => {
        const ev = lastEvents[w.id];
        const secretStored = w.status === 'active'; // active only after secret persisted
        const statusVariant: 'default' | 'destructive' | 'secondary' =
          w.status === 'active' ? 'default' : w.status === 'error' ? 'destructive' : 'secondary';
        return (
          <div key={w.id} className="rounded-md border p-2 space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant}>{w.status ?? 'unknown'}</Badge>
                <Badge variant="outline">{w.environment ?? '—'}</Badge>
                {secretStored ? (
                  <Badge variant="outline" className="text-green-700 border-green-700/40">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> secret stored
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-amber-700 border-amber-700/40">
                    secret missing
                  </Badge>
                )}
              </div>
              <span className="text-muted-foreground">id: {w.id.slice(0, 8)}…</span>
            </div>

            <div className="grid gap-1 md:grid-cols-2">
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Callback:</span>
                <code className="truncate flex-1">{w.url || '—'}</code>
                {w.url && (
                  <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => copy(w.url!)}>
                    <Copy className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">Events:</span>{' '}
                {(w.events ?? []).join(', ') || '—'}
              </div>
              <div>
                <span className="text-muted-foreground">ABC webhook id:</span>{' '}
                <code>{w.webhook_id || '—'}</code>
              </div>
              <div>
                <span className="text-muted-foreground">Last event at:</span>{' '}
                {w.last_event_received_at ? new Date(w.last_event_received_at).toLocaleString() : '—'}
              </div>
              <div>
                <span className="text-muted-foreground">Last event type:</span>{' '}
                {ev?.event_type ?? '—'}
                {ev?.signature_valid === false && (
                  <Badge variant="destructive" className="ml-2">invalid signature</Badge>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">Last quarantine reason:</span>{' '}
                {ev?.quarantine_reason ?? '—'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
