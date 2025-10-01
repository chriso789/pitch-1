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

export default function QuickBooksSettings() {
  const { toast } = useToast();
  const [connection, setConnection] = useState<QBOConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [qboItems, setQboItems] = useState<QBOItem[]>([]);
  const [mappings, setMappings] = useState<Record<string, JobTypeMapping>>({});
  const [savingMappings, setSavingMappings] = useState(false);

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

      // Open OAuth window
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      const authWindow = window.open(
        data.authUrl,
        'QuickBooks OAuth',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      // Listen for OAuth callback
      const handleMessage = async (event: MessageEvent) => {
        if (event.data.type === 'qbo-oauth-success') {
          const { code, realmId } = event.data;

          const { error: callbackError } = await supabase.functions.invoke('qbo-oauth-connect', {
            body: {
              action: 'callback',
              code,
              realmId,
              state: data.state,
            },
          });

          if (callbackError) throw callbackError;

          toast({
            title: "Connected to QuickBooks",
            description: "Your QuickBooks account has been connected successfully.",
          });

          await loadConnection();
          authWindow?.close();
        }
      };

      window.addEventListener('message', handleMessage);

      // Clean up
      const checkClosed = setInterval(() => {
        if (authWindow?.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handleMessage);
          setConnecting(false);
        }
      }, 500);

    } catch (error: any) {
      console.error('Error connecting to QuickBooks:', error);
      toast({
        title: "Connection Failed",
        description: error.message,
        variant: "destructive",
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
      toast({
        title: "Error",
        description: error.message,
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
          )}
        </CardContent>
      </Card>

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
