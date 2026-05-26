import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Building2, CheckCircle2, XCircle, RefreshCw, Unplug } from "lucide-react";
import { QuickBooksSyncErrors } from "./QuickBooksSyncErrors";

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

  const handleConnect = async () => {
    try {
      setConnecting(true);

      const { data, error } = await supabase.functions.invoke('qbo-oauth-connect', {
        body: { action: 'initiate' },
      });

      if (error) throw error;

      setLastAuthUrl(data.authUrl);
      console.log('[QBO] Auth URL:', data.authUrl);

      // Open OAuth in a popup. The callback page (https://pitch-crm.ai/quickbooks/callback)
      // posts a message back here and we finish the exchange.
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const authWindow = window.open(
        data.authUrl,
        'qbo-oauth',
        `popup=yes,width=${width},height=${height},left=${left},top=${top}`
      );

      if (!authWindow) {
        toast({
          title: 'Popup blocked',
          description: 'Please allow popups for this site and try again.',
          variant: 'destructive',
        });
        setConnecting(false);
        return;
      }

      const handleMessage = async (event: MessageEvent) => {
        // Accept messages only from our callback origin(s).
        const okOrigins = [
          'https://pitch-crm.ai',
          'https://www.pitch-crm.ai',
          window.location.origin,
        ];
        if (!okOrigins.includes(event.origin)) return;

        if (event.data?.type === 'qbo-oauth-success') {
          const { code, realmId } = event.data;
          try {
            const { error: callbackError } = await supabase.functions.invoke('qbo-oauth-connect', {
              body: { action: 'callback', code, realmId, state: data.state },
            });
            if (callbackError) throw callbackError;

            toast({
              title: 'Connected to QuickBooks',
              description: 'Your QuickBooks account has been connected successfully.',
            });
            await loadConnection();
          } catch (e: any) {
            toast({
              title: 'Connection Failed',
              description: await extractFnError(e),
              variant: 'destructive',
            });
          } finally {
            window.removeEventListener('message', handleMessage);
            try { authWindow?.close(); } catch {}
            setConnecting(false);
          }
        } else if (event.data?.type === 'qbo-oauth-error') {
          toast({
            title: 'QuickBooks connection failed',
            description: event.data.description ?? event.data.error ?? 'Unknown error',
            variant: 'destructive',
          });
          window.removeEventListener('message', handleMessage);
          setConnecting(false);
        }
      };

      window.addEventListener('message', handleMessage);
    } catch (error: any) {
      console.error('Error connecting to QuickBooks:', error);
      const description = await extractFnError(error);
      toast({
        title: 'Connection Failed',
        description,
        variant: 'destructive',
      });
      setConnecting(false);
    }
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
                  <span className="text-sm font-medium">Connected</span>
                  <span className="text-sm text-muted-foreground">
                    {new Date(connection.connected_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={handleDisconnect}
                className="w-full gap-2"
              >
                <Unplug className="h-4 w-4" />
                Disconnect QuickBooks
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
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
                  'Connect to QuickBooks'
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
