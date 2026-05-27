import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Webhook, RefreshCw, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface WebhookEvent {
  id: string;
  realm_id: string | null;
  oauth_app_env: string | null;
  signature_valid: boolean | null;
  event_count: number | null;
  received_at: string;
  processed_at: string | null;
  error_code: string | null;
  error_message: string | null;
}

interface Props {
  tenantId: string;
}

export function QuickBooksWebhookEvents({ tenantId }: Props) {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('qbo_webhook_events' as any)
      .select('id, realm_id, oauth_app_env, signature_valid, event_count, received_at, processed_at, error_code, error_message')
      .eq('tenant_id', tenantId)
      .order('received_at', { ascending: false })
      .limit(10);
    setEvents((data as any as WebhookEvent[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    if (tenantId) load();
  }, [tenantId]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Webhook className="h-5 w-5" />
            <div>
              <CardTitle className="text-base">Recent QuickBooks webhooks</CardTitle>
              <CardDescription>
                Last 10 inbound deliveries from Intuit (signature, mode, processing result).
              </CardDescription>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No webhook deliveries recorded yet for this tenant.
          </p>
        ) : (
          <div className="space-y-2">
            {events.map((e) => {
              const ok = e.signature_valid === true && !e.error_code;
              return (
                <div
                  key={e.id}
                  className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    {ok ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                    ) : e.signature_valid === false ? (
                      <XCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={e.oauth_app_env === 'production' ? 'default' : 'secondary'}>
                          {e.oauth_app_env ?? 'unknown'}
                        </Badge>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          realm {e.realm_id ?? '—'}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={
                            e.signature_valid === true
                              ? 'text-emerald-700 border-emerald-500'
                              : e.signature_valid === false
                                ? 'text-destructive border-destructive'
                                : ''
                          }
                        >
                          {e.signature_valid === true
                            ? 'Signature OK'
                            : e.signature_valid === false
                              ? 'Signature INVALID'
                              : 'Signature unknown'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {e.event_count ?? 0} event{(e.event_count ?? 0) === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Received {formatDistanceToNow(new Date(e.received_at), { addSuffix: true })}
                        {e.processed_at && <> · Processed {formatDistanceToNow(new Date(e.processed_at), { addSuffix: true })}</>}
                      </div>
                      {e.error_code && (
                        <div className="mt-1 text-xs text-destructive break-words">
                          <span className="font-medium">{e.error_code}</span>
                          {e.error_message && <>: {e.error_message}</>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
