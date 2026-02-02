import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface QBOItem {
  id: string;
  name: string;
  description: string;
  unitPrice: number;
}

interface JobTypeMapping {
  id: string;
  job_type: string;
  qbo_item_id: string;
  qbo_item_name: string;
  is_active: boolean;
}

const JOB_TYPES = [
  { value: 'roof_repair', label: 'Roof Repair' },
  { value: 'roof_replacement', label: 'Roof Replacement' },
  { value: 'gutters', label: 'Gutters' },
  { value: 'interior_paint', label: 'Interior Paint' },
  { value: 'exterior_paint', label: 'Exterior Paint' },
  { value: 'handyman', label: 'Handyman' },
];

interface QBOConnection {
  id: string;
  tenant_id: string;
  is_active: boolean;
}

export function JobTypeQBOMapping() {
  const queryClient = useQueryClient();
  const [selectedMappings, setSelectedMappings] = useState<Record<string, string>>({});

  // Check if QBO is connected first
  const { data: qboConnection, isLoading: loadingConnection } = useQuery({
    queryKey: ['qbo-connection-check'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .single();

      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) return null;

      const { data } = await (supabase as any)
        .from('qbo_connections')
        .select('id, tenant_id, is_active')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .maybeSingle();

      return data as QBOConnection | null;
    },
  });

  const isQBOConnected = !!qboConnection;

  // Fetch QBO Service Items - only when connected
  const { data: qboItems, isLoading: loadingItems, refetch: refetchItems } = useQuery({
    queryKey: ['qbo-items'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('qbo-fetch-items');
      if (error) throw error;
      return data.items as QBOItem[];
    },
    retry: 1,
    enabled: isQBOConnected, // Only fetch when QBO is connected
  });

  // Fetch existing mappings
  const { data: mappings, isLoading: loadingMappings } = useQuery({
    queryKey: ['job-type-mappings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_type_qbo_mapping' as any)
        .select('*')
        .eq('is_active', true);
      if (error) throw error;
      return (data || []) as unknown as JobTypeMapping[];
    },
  });

  // Initialize selected mappings from existing data
  useEffect(() => {
    if (mappings) {
      const initialMappings: Record<string, string> = {};
      mappings.forEach(m => {
        initialMappings[m.job_type] = m.qbo_item_id;
      });
      setSelectedMappings(initialMappings);
    }
  }, [mappings]);

  // Save mapping mutation
  const saveMappingMutation = useMutation({
    mutationFn: async ({ jobType, qboItemId, qboItemName }: { jobType: string; qboItemId: string; qboItemName: string }) => {
      const { error } = await supabase
        .from('job_type_qbo_mapping' as any)
        .upsert({
          job_type: jobType,
          qbo_item_id: qboItemId,
          qbo_item_name: qboItemName,
          is_active: true,
        }, {
          onConflict: 'tenant_id,job_type',
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-type-mappings'] });
      toast.success('Mapping saved successfully');
    },
    onError: (error) => {
      toast.error(`Failed to save mapping: ${error.message}`);
    },
  });

  const handleMappingChange = (jobType: string, qboItemId: string) => {
    setSelectedMappings(prev => ({ ...prev, [jobType]: qboItemId }));
    
    const qboItem = qboItems?.find(item => item.id === qboItemId);
    if (qboItem) {
      saveMappingMutation.mutate({
        jobType,
        qboItemId,
        qboItemName: qboItem.name,
      });
    }
  };

  const allMapped = JOB_TYPES.every(jt => selectedMappings[jt.value]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Job Type to QBO Item Mapping</CardTitle>
            <CardDescription>
              Map your service types to QuickBooks Service Items for invoice creation
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {allMapped && (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                All Mapped
              </Badge>
            )}
            {!allMapped && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                <AlertCircle className="h-3 w-3 mr-1" />
                Incomplete
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchItems()}
              disabled={loadingItems}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loadingItems ? 'animate-spin' : ''}`} />
              Refresh Items
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadingConnection ? (
          <div className="text-center py-8 text-muted-foreground">
            Checking QuickBooks connection...
          </div>
        ) : !isQBOConnected ? (
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground mb-4">
              Connect to QuickBooks first to configure job type mappings.
            </p>
            <p className="text-sm text-muted-foreground">
              Go to Settings → QuickBooks Integration to connect your account.
            </p>
          </div>
        ) : loadingMappings || loadingItems ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading mappings...
          </div>
        ) : !qboItems || qboItems.length === 0 ? (
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-amber-500" />
            <p className="text-muted-foreground mb-4">
              No QuickBooks Service Items found. Create Service Items in QuickBooks first.
            </p>
            <Button variant="outline" onClick={() => refetchItems()}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {JOB_TYPES.map(jobType => (
              <div key={jobType.value} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex-1">
                  <p className="font-medium">{jobType.label}</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedMappings[jobType.value] ? (
                      <span className="text-green-600">
                        Mapped to: {qboItems.find(i => i.id === selectedMappings[jobType.value])?.name}
                      </span>
                    ) : (
                      <span className="text-amber-600">Not mapped</span>
                    )}
                  </p>
                </div>
                <Select
                  value={selectedMappings[jobType.value] || ''}
                  onValueChange={(value) => handleMappingChange(jobType.value, value)}
                >
                  <SelectTrigger className="w-[300px]">
                    <SelectValue placeholder="Select QBO Service Item" />
                  </SelectTrigger>
                  <SelectContent>
                    {qboItems.map(item => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name} {item.description && `- ${item.description}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
        
        {!allMapped && (
          <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-800">
              <AlertCircle className="h-4 w-4 inline mr-2" />
              Complete all mappings before creating QuickBooks invoices
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
