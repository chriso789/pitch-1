import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Building2, CheckCircle2, XCircle, RefreshCw, Unplug, AlertTriangle } from "lucide-react";
import { QuickBooksSyncErrors } from "./QuickBooksSyncErrors";
import { QuickBooksConnectDialog } from "./QuickBooksConnectDialog";

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

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? null;
      setUserId(uid);
      if (uid) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('id', uid)
          .single();
        setTenantId((prof as any)?.tenant_id ?? null);
      }
    })();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('provider') === 'qbo' && params.get('status')) {
      setReturnStatus({ status: params.get('status') as string, reason: params.get('reason') ?? undefined });
      const tone =
        params.get('status') === 'connected' ? 'default' : 'destructive';
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
        .select('tenant_id')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      if (!profile) return;

      const { data, error } = await supabase
        .from('qbo_connections' as any)
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;

      setConnection(data as any);

      if (data) {
        await loadQBOItems();
        await loadMappings(profile.tenant_id);
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

  const loadMappings = async (tenantId: string) => {
    try {
      const { data, error } = await supabase
        .from('job_type_qbo_mapping' as any)
        .select('*')
        .eq('tenant_id', tenantId);

      if (error) throw error;




      const mappingsMap: Record<string, JobTypeMapping> = {};
      (data as any)?.forEach((mapping: any) => {
        mappingsMap[mapping.job_type] = {
          job_type: mapping.job_type,
          qbo_item_id: mapping.qbo_item_id,
          qbo_item_name: mapping.qbo_item_name,
        };
      });

      setMappings(mappingsMap);
    } catch (error) {
      console.error('Error loading mappings:', error);
    }
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
            <div className="space-y-4">
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Company</span>
                  <span className="text-sm text-muted-foreground">
                    {connection.qbo_company_name}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Environment</span>
                  <Badge variant={(connection as any).oauth_app_env === 'production' ? 'default' : 'secondary'}>
                    {(connection as any).oauth_app_env ?? ((connection as any).is_sandbox ? 'development' : 'production')}
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
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                  variant="outline"
                  onClick={handleDisconnect}
                  className="w-full gap-2"
                >
                  <Unplug className="h-4 w-4" />
                  Disconnect QuickBooks
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Tip: If Intuit auto-signs you back into the same account, open
                {' '}<a href="https://accounts.intuit.com" target="_blank" rel="noreferrer" className="underline">accounts.intuit.com</a>{' '}
                in another tab and sign out first, or use a private/incognito window for the popup.
              </p>

            </div>
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
                onClick={handleConnect}
                disabled={connecting}
                className="w-full"
              >
                {connecting ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  `Connect to QuickBooks (${selectedMode})`
                )}
              </Button>

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

      {/* Job Type Mappings */}
      {connection && (
        <Card>
          <CardHeader>
            <CardTitle>Job Type Mappings</CardTitle>
            <CardDescription>
              Map your PITCH job types to QuickBooks Service Items for accurate invoicing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {JOB_TYPES.map((jobType) => (
                <div key={jobType.key} className="flex items-center gap-4">
                  <Label className="w-40 flex-shrink-0">{jobType.label}</Label>
                  <Select
                    value={mappings[jobType.key]?.qbo_item_id || ''}
                    onValueChange={(value) => {
                      const item = qboItems.find(i => i.Id === value);
                      if (item) {
                        handleMappingChange(jobType.key, item.Id, item.Name);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select QuickBooks Item" />
                    </SelectTrigger>
                    <SelectContent>
                      {qboItems.length === 0 ? (
                        <SelectItem value="none" disabled>
                          Create items in QuickBooks first
                        </SelectItem>
                      ) : (
                        qboItems.map((item) => (
                          <SelectItem key={item.Id} value={item.Id}>
                            {item.Name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              <Button
                onClick={handleSaveMappings}
                disabled={savingMappings || Object.keys(mappings).length === 0}
                className="w-full"
              >
                {savingMappings ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Mappings'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
