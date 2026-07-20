import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Building2, CheckCircle2, XCircle, RefreshCw, Unplug, AlertTriangle, ShieldAlert, LifeBuoy } from "lucide-react";
import { QuickBooksSyncErrors } from "./QuickBooksSyncErrors";
import { QuickBooksConnectDialog } from "./QuickBooksConnectDialog";
import { QuickBooksWebhookEvents } from "./QuickBooksWebhookEvents";
import { formatDistanceToNow } from "date-fns";

const JOB_TYPES = [
  { key: 'roof_repair', label: 'Roof Repair' },
  { key: 'roof_replacement', label: 'Roof Replacement' },
  { key: 'gutters', label: 'Gutters' },
  { key: 'interior_paint', label: 'Interior Paint' },
  { key: 'exterior_paint', label: 'Exterior Paint' },
  { key: 'handyman', label: 'Handyman' },
];

interface QBOConnection {
  id: string;
  tenant_id: string;
  realm_id: string;
  qbo_company_name: string;
  is_active: boolean;
  connected_at: string;
  token_expires_at: string;
}

interface QBOItem {
  Id: string;
  Name: string;
  Type: string;
}

interface JobTypeMapping {
  job_type: string;
  qbo_item_id: string | null;
  qbo_item_name: string | null;
}

async function extractFnError(err: any): Promise<string> {
  try {
    const res = err?.context?.response ?? err?.context;
    if (res && typeof res.clone === 'function') {
      const body = await res.clone().json();
      if (body?.error) return body.error;
      if (body?.message) return body.message;
    }
    if (res && typeof res.text === 'function') {
      const txt = await res.text();
      if (txt) return txt;
    }
  } catch {}
  return err?.message ?? 'Unknown error';
}

export default function QuickBooksSettings() {
  const { toast } = useToast();
  const [connection, setConnection] = useState<QBOConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [qboItems, setQboItems] = useState<QBOItem[]>([]);
  const [mappings, setMappings] = useState<Record<string, JobTypeMapping>>({});
  const [savingMappings, setSavingMappings] = useState(false);
  const [lastAuthUrl, setLastAuthUrl] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<any>(null);
  const [verifyInfo, setVerifyInfo] = useState<any>(null);
  const [selectedMode, setSelectedMode] = useState<'development' | 'production'>('development');
  const [connectOpen, setConnectOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [returnStatus, setReturnStatus] = useState<{ status: string; reason?: string } | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [refreshingToken, setRefreshingToken] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? null;
      setUserId(uid);
      if (uid) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('tenant_id, active_tenant_id')
          .eq('id', uid)
          .single();
        // Coalesce to match public.get_user_tenant_id() so RLS-scoped writes
        // (legal_acceptances, integration_consents, qbo_connections) succeed
        // even when the company switcher has flipped active_tenant_id.
        const p = prof as { tenant_id: string | null; active_tenant_id: string | null } | null;
        setTenantId(p?.active_tenant_id ?? p?.tenant_id ?? null);
      }
    })();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('provider') === 'qbo' && params.get('status')) {
      const reason = params.get('reason') ?? undefined;
      setReturnStatus({ status: params.get('status') as string, reason });
      if (reason && /reauth/i.test(reason)) setReauthRequired(true);
      const tone = params.get('status') === 'connected' ? 'default' : 'destructive';
      toast({
        title: params.get('status') === 'connected' ? 'QuickBooks connected' : 'QuickBooks connection issue',
        description: params.get('reason') ?? params.get('status') ?? '',
        variant: tone as any,
      });
      // Clean the URL so reloads don't re-fire.
      const url = new URL(window.location.href);
      url.searchParams.delete('provider');
      url.searchParams.delete('status');
      url.searchParams.delete('reason');
      url.searchParams.delete('realm');
      url.searchParams.delete('env');
      window.history.replaceState({}, '', url.toString());
    }
  }, [toast]);


  const runDiagnostic = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('qbo-oauth-connect', {
        body: { action: 'verify' },
      });
      if (error) throw error;
      setDiagnostic(data);
    } catch (e: any) {
      setDiagnostic({ error: await extractFnError(e) });
    }
  };

  // Load backend-controlled defaults + credential availability on mount.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.functions.invoke('qbo-oauth-connect', {
          body: { action: 'verify' },
        });
        if (data) {
          setVerifyInfo(data);
          const def = data.qbo_default_environment === 'production' ? 'production' : 'development';
          setSelectedMode(def);
        }
      } catch {}
    })();
  }, []);


  useEffect(() => {
    loadConnection();
  }, []);

  const loadConnection = async () => {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      if (!profile) return;

      // Match public.get_user_tenant_id() which coalesces active_tenant_id
      // first — RLS on qbo_connections / integration_consents / legal_acceptances
      // enforces `tenant_id = get_user_tenant_id(auth.uid())`. If we used the
      // home tenant while a company switcher had set active_tenant_id, the
      // consent insert would silently fail RLS and the connect dialog would
      // toast "Could not start QuickBooks connection".
      const effectiveTenantId = (profile as { tenant_id: string; active_tenant_id: string | null })
        .active_tenant_id ?? (profile as { tenant_id: string }).tenant_id;

      const { data, error } = await supabase
        .from('qbo_connections' as any)
        .select('*')
        .eq('tenant_id', effectiveTenantId)
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;

      setConnection(data as any);

      if (data) {
        await loadQBOItems();
        await loadMappings(effectiveTenantId);
      }
    } catch (error) {
      console.error('Error loading connection:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadQBOItems = async () => {
    try {
      // This would call an edge function to fetch items from QBO
      // For now, we'll just show the interface
      setQboItems([]);
    } catch (error) {
      console.error('Error loading QBO items:', error);
    }
  };

  // Job-type mappings live in <JobTypeQBOMapping /> against `job_type_item_map`.
  // The old `job_type_qbo_mapping` table was removed as part of Sub-plan F
  // (schema hardening). Kept as a no-op so the render path below stays intact.
  const loadMappings = async (_tenantId: string) => {
    setMappings({});
  };

  const openConnectDialog = () => {
    if (!userId || !tenantId) {
      toast({
        title: 'Not ready',
        description: 'Loading your profile — try again in a moment.',
        variant: 'destructive',
      });
      return;
    }
    setConnectOpen(true);
  };

  const handleDisconnect = async () => {
    try {
      const { error } = await supabase.functions.invoke('qbo-oauth-connect', {
        body: { action: 'disconnect' },
      });

      if (error) throw error;

      setConnection(null);
      toast({
        title: "Disconnected",
        description: "QuickBooks has been disconnected.",
      });
    } catch (error: any) {
      const description = await extractFnError(error);
      toast({
        title: "Error",
        description,
        variant: "destructive",
      });
    }
  };

  const handleSwitchAccount = async () => {
    try {
      const { error } = await supabase.functions.invoke('qbo-oauth-connect', {
        body: { action: 'disconnect' },
      });
      if (error) throw error;
      setConnection(null);
      setReauthRequired(false);
      toast({
        title: 'Disconnected',
        description: 'Review the legal acceptances again to connect a different QuickBooks account.',
      });
      openConnectDialog();
    } catch (error: any) {
      const description = await extractFnError(error);
      toast({ title: 'Error', description, variant: 'destructive' });
    }
  };

  const handleRefreshToken = async () => {
    setRefreshingToken(true);
    try {
      const { data, error } = await supabase.functions.invoke('qbo-oauth-connect', {
        body: { action: 'refresh' },
      });
      if (error) {
        const description = await extractFnError(error);
        if (/reauth_required/i.test(description)) {
          setReauthRequired(true);
          toast({
            title: 'Reauthorization required',
            description: 'QuickBooks rejected the saved refresh token. Reconnect to continue syncing.',
            variant: 'destructive',
          });
        } else {
          toast({ title: 'Refresh failed', description, variant: 'destructive' });
        }
        return;
      }
      if (data?.error === 'reauth_required') {
        setReauthRequired(true);
        toast({
          title: 'Reauthorization required',
          description: 'QuickBooks rejected the saved refresh token. Reconnect to continue syncing.',
          variant: 'destructive',
        });
        return;
      }
      setReauthRequired(false);
      toast({ title: 'Token refreshed', description: 'QuickBooks access token is fresh.' });
      // Pull updated timestamps into the banner.
      try {
        const { data: v } = await supabase.functions.invoke('qbo-oauth-connect', { body: { action: 'verify' } });
        if (v) setVerifyInfo(v);
      } catch { /* ignore */ }
    } catch (e: any) {
      const description = await extractFnError(e);
      toast({ title: 'Refresh failed', description, variant: 'destructive' });
    } finally {
      setRefreshingToken(false);
    }
  };



  const handleMappingChange = (jobType: string, itemId: string, itemName: string) => {
    setMappings(prev => ({
      ...prev,
      [jobType]: {
        job_type: jobType,
        qbo_item_id: itemId,
        qbo_item_name: itemName,
      },
    }));
  };

  const handleSaveMappings = async () => {
    try {
      setSavingMappings(true);

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, id')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      if (!profile) throw new Error('Profile not found');

      // Save each mapping
      for (const [jobType, mapping] of Object.entries(mappings)) {
        if (mapping.qbo_item_id) {
          const { error } = await supabase
            .from('job_type_qbo_mapping' as any)
            .upsert({
              tenant_id: profile.tenant_id,
              job_type: jobType,
              qbo_item_id: mapping.qbo_item_id,
              qbo_item_name: mapping.qbo_item_name,
              created_by: profile.id,
            }, {
              onConflict: 'tenant_id,job_type',
            });

          if (error) throw error;
        }
      }

      toast({
        title: "Mappings Saved",
        description: "Job type mappings have been saved successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSavingMappings(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sync Errors */}
      {connection && (
        <QuickBooksSyncErrors tenantId={connection.tenant_id} />
      )}
      
      {/* Connection Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Building2 className="h-5 w-5" />
              <div>
                <CardTitle>QuickBooks Online</CardTitle>
                <CardDescription>
                  Connect your QuickBooks account to sync invoices and payments
                </CardDescription>
              </div>
            </div>
            {connection?.is_active ? (
              <Badge variant="default" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Connected
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1">
                <XCircle className="h-3 w-3" />
                Not Connected
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {connection ? (
            (() => {
              // Prefer fresh verify data when available (carries timestamps).
              const v = verifyInfo?.connection ?? {};
              const companyName = v.qbo_company_name ?? connection.qbo_company_name;
              const env = v.oauth_app_env ?? (connection as any).oauth_app_env ?? ((connection as any).is_sandbox ? 'development' : 'production');
              const tokenExp = v.token_expires_at ?? (connection as any).token_expires_at ?? null;
              const refreshExp = v.refresh_token_expires_at ?? (connection as any).refresh_token_expires_at ?? null;
              const lastRefresh = v.last_refresh_at ?? (connection as any).last_refresh_at ?? null;
              const refreshExpMs = refreshExp ? new Date(refreshExp).getTime() : 0;
              const refreshNearExpiry = refreshExpMs > 0 && refreshExpMs - Date.now() < 7 * 24 * 3600 * 1000;
              return (
            <div className="space-y-4">
              {reauthRequired && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
                  <ShieldAlert className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                  <div className="space-y-1">
                    <div className="font-medium text-destructive">Reauthorization required</div>
                    <p className="text-destructive/90 text-xs">
                      Intuit rejected the saved refresh token (invalid_grant). Reconnect QuickBooks to resume syncing.
                    </p>
                  </div>
                </div>
              )}
              {!reauthRequired && refreshNearExpiry && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-amber-800 dark:text-amber-200">
                    Refresh token expires {formatDistanceToNow(new Date(refreshExp), { addSuffix: true })}. Reconnect soon to avoid an interruption.
                  </div>
                </div>
              )}
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Company</span>
                  <span className="text-sm text-muted-foreground">
                    {companyName ?? '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Environment</span>
                  <Badge variant={env === 'production' ? 'default' : 'secondary'}>
                    {env}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Realm ID</span>
                  <span className="text-xs text-muted-foreground font-mono">{connection.realm_id}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Connected</span>
                  <span className="text-sm text-muted-foreground">
                    {new Date(connection.connected_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Last token refresh</span>
                  <span className="text-sm text-muted-foreground">
                    {lastRefresh ? formatDistanceToNow(new Date(lastRefresh), { addSuffix: true }) : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Access token expires</span>
                  <span className="text-sm text-muted-foreground">
                    {tokenExp ? formatDistanceToNow(new Date(tokenExp), { addSuffix: true }) : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Refresh token expires</span>
                  <span className={`text-sm ${refreshNearExpiry ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>
                    {refreshExp ? formatDistanceToNow(new Date(refreshExp), { addSuffix: true }) : '—'}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {reauthRequired ? (
                  <Button
                    variant="destructive"
                    onClick={openConnectDialog}
                    disabled={!userId || !tenantId}
                    className="w-full gap-2 sm:col-span-3"
                  >
                    <ShieldAlert className="h-4 w-4" />
                    Reauthorize QuickBooks
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="default"
                      onClick={handleSwitchAccount}
                      disabled={connecting}
                      className="w-full gap-2"
                    >
                      <RefreshCw className={`h-4 w-4 ${connecting ? 'animate-spin' : ''}`} />
                      Switch Account
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={handleRefreshToken}
                      disabled={refreshingToken}
                      className="w-full gap-2"
                    >
                      <RefreshCw className={`h-4 w-4 ${refreshingToken ? 'animate-spin' : ''}`} />
                      Refresh token now
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleDisconnect}
                      className="w-full gap-2"
                    >
                      <Unplug className="h-4 w-4" />
                      Disconnect
                    </Button>
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Tip: If Intuit auto-signs you back into the same account, open
                {' '}<a href="https://accounts.intuit.com" target="_blank" rel="noreferrer" className="underline">accounts.intuit.com</a>{' '}
                in another tab and sign out first, or use a private/incognito window for the popup.
              </p>

            </div>
              );
            })()
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="qbo-mode">Environment</Label>
                <Select value={selectedMode} onValueChange={(v) => setSelectedMode(v as 'development' | 'production')}>
                  <SelectTrigger id="qbo-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="development" disabled={verifyInfo && !verifyInfo.has_development_credentials && !verifyInfo.has_legacy_credentials}>
                      Sandbox (development)
                    </SelectItem>
                    <SelectItem value="production" disabled={verifyInfo && !verifyInfo.has_production_credentials && !verifyInfo.has_legacy_credentials}>
                      Production
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Default: <span className="font-mono">{verifyInfo?.qbo_default_environment ?? 'development'}</span>. Production connections require master-level approval until smoke-test cutover is complete.
                </p>
              </div>
              <Button
                onClick={openConnectDialog}
                disabled={connecting || !userId || !tenantId}
                className="w-full"
              >
                Review legal terms & connect to QuickBooks ({selectedMode})
              </Button>
              <p className="text-xs text-muted-foreground">
                You will be asked to accept the Privacy Policy, Terms of Service, and
                QuickBooks Integration Consent before being redirected to Intuit.
              </p>


              {/* Diagnostic panel */}
              <div className="rounded-md border border-dashed p-3 text-xs space-y-2 bg-muted/30">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-muted-foreground">Troubleshooting</span>
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={runDiagnostic}>
                    Run diagnostic
                  </Button>
                </div>
                {lastAuthUrl && (
                  <div className="space-y-1">
                    <p className="text-muted-foreground">
                      Popup blank/spinning? Open Intuit's URL directly to see the real error:
                    </p>
                    <a
                      href={lastAuthUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline break-all"
                    >
                      Open OAuth URL in new tab ↗
                    </a>
                  </div>
                )}
                {diagnostic && (
                  <pre className="bg-background border rounded p-2 overflow-x-auto text-[10px] leading-tight">
                    {JSON.stringify(diagnostic, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}

        </CardContent>
      </Card>

      {/* Invoice Creation Notice */}
      {connection && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              <strong>Note:</strong> Invoice creation is now available directly on job detail pages. 
              Navigate to any job and click the "QuickBooks" tab to create invoices from estimates.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Job Type Mappings live in <JobTypeQBOMapping /> (rendered by
          Settings.tsx directly). The previous inline block here targeted a
          non-existent `job_type_qbo_mapping` table — removed to prevent
          duplicate/conflicting UI for tenants. */}


      {userId && tenantId && (
        <QuickBooksConnectDialog
          open={connectOpen}
          onOpenChange={setConnectOpen}
          tenantId={tenantId}
          userId={userId}
          defaultMode={selectedMode}
          hasDevelopmentCredentials={!!(verifyInfo?.has_development_credentials || verifyInfo?.has_legacy_credentials)}
          hasProductionCredentials={!!(verifyInfo?.has_production_credentials || verifyInfo?.has_legacy_credentials)}
        />
      )}

      {/* Support card — surfaces tenant + realm + last intuit_tid in a mailto link.
           Required by Intuit production review (in-app support contact). Never includes tokens. */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <LifeBuoy className="h-5 w-5 text-primary" />
            <CardTitle>Get support with this QuickBooks connection</CardTitle>
          </div>
          <CardDescription>
            Email PITCH support with your connection context pre-filled. We never include access or refresh tokens.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(() => {
            const env = (connection as any)?.oauth_app_env ?? ((connection as any)?.is_sandbox ? 'development' : 'production');
            const company = (connection as any)?.qbo_company_name ?? '—';
            const realm = (connection as any)?.realm_id ?? '—';
            const lines = [
              'Hi PITCH support,',
              '',
              'I need help with the QuickBooks Online integration.',
              '',
              `Tenant: ${tenantId ?? '(unknown)'}`,
              `QBO Company: ${company}`,
              `Realm ID: ${realm}`,
              `Environment: ${env}`,
              '',
              'What is happening: ',
              '',
              'What I expected: ',
              '',
              '— Sent from PITCH CRM → Settings → QuickBooks.',
            ].join('\n');
            const subject = `[QBO] ${company} (${env}) — support request`;
            const mailto = `mailto:support@pitch-crm.ai?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines)}`;
            return (
              <>
                <a href={mailto} className="inline-block">
                  <Button variant="default" className="gap-2">
                    <LifeBuoy className="h-4 w-4" />
                    Email support@pitch-crm.ai
                  </Button>
                </a>
                <p className="text-xs text-muted-foreground">
                  Reviewer note: the request body includes only tenant id, QBO company name, realm id and environment.
                  No access tokens, refresh tokens, client secrets or Intuit verifier tokens are sent.
                </p>
              </>
            );
          })()}
        </CardContent>
      </Card>

      {connection && tenantId && (
        <QuickBooksWebhookEvents tenantId={tenantId} />
      )}
    </div>
  );
}

