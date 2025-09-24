import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
  History, 
  Clock, 
  User, 
  GitBranch, 
  Undo, 
  Eye,
  CheckCircle,
  AlertCircle,
  ArrowRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface EstimateVersionHistoryProps {
  estimateId: string;
  onVersionSelect?: (versionId: string) => void;
  onVersionCompare?: (version1: string, version2: string) => void;
  onVersionRollback?: (versionId: string) => void;
}

interface EstimateVersion {
  id: string;
  version_number: number;
  change_reason: string;
  created_at: string;
  created_by: string;
  is_current: boolean;
  snapshot_data: any;
  profiles?: {
    first_name: string;
    last_name: string;
  } | null;
}

const EstimateVersionHistory = ({ 
  estimateId, 
  onVersionSelect,
  onVersionCompare,
  onVersionRollback 
}: EstimateVersionHistoryProps) => {
  const [versions, setVersions] = useState<EstimateVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    fetchVersionHistory();
  }, [estimateId]);

  const fetchVersionHistory = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('estimate_versions')
        .select(`
          *,
          profiles:created_by (
            first_name,
            last_name
          )
        `)
        .eq('estimate_id', estimateId)
        .order('version_number', { ascending: false });

      if (error) throw error;
      
      // Transform the data to match our interface
      const transformedVersions = (data || []).map((version: any) => ({
        id: version.id,
        version_number: version.version_number,
        change_reason: version.change_reason,
        created_at: version.created_at,
        created_by: version.created_by,
        is_current: version.is_current,
        snapshot_data: version.snapshot_data,
        profiles: version.profiles && !version.profiles.error ? version.profiles : null
      }));
      
      setVersions(transformedVersions);
    } catch (error) {
      console.error('Error fetching version history:', error);
      toast({
        title: "Error",
        description: "Failed to load version history",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleVersionSelect = (versionId: string) => {
    if (selectedVersions.includes(versionId)) {
      setSelectedVersions(prev => prev.filter(id => id !== versionId));
    } else if (selectedVersions.length < 2) {
      setSelectedVersions(prev => [...prev, versionId]);
    } else {
      // Replace oldest selection
      setSelectedVersions([selectedVersions[1], versionId]);
    }
    onVersionSelect?.(versionId);
  };

  const handleCompareVersions = () => {
    if (selectedVersions.length === 2) {
      onVersionCompare?.(selectedVersions[0], selectedVersions[1]);
    }
  };

  const handleRollbackVersion = async (versionId: string) => {
    try {
      const { data, error } = await supabase.rpc('rollback_estimate_to_version', {
        estimate_id_param: estimateId,
        version_id_param: versionId
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Estimate has been rolled back to the selected version",
      });

      fetchVersionHistory();
      onVersionRollback?.(versionId);
    } catch (error) {
      console.error('Error rolling back version:', error);
      toast({
        title: "Error",
        description: "Failed to rollback to selected version",
        variant: "destructive",
      });
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getVersionIcon = (version: EstimateVersion) => {
    if (version.is_current) return CheckCircle;
    if (version.change_reason?.includes('rollback')) return Undo;
    if (version.change_reason?.includes('status')) return GitBranch;
    return Clock;
  };

  const getVersionColor = (version: EstimateVersion) => {
    if (version.is_current) return 'text-success';
    if (version.change_reason?.includes('rollback')) return 'text-warning';
    return 'text-muted-foreground';
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          Version History
        </CardTitle>
        
        {selectedVersions.length === 2 && (
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCompareVersions}>
              <Eye className="h-4 w-4 mr-2" />
              Compare Selected
            </Button>
          </div>
        )}
      </CardHeader>

      <CardContent>
        <ScrollArea className="h-96">
          <div className="space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                <span className="ml-2 text-sm text-muted-foreground">Loading versions...</span>
              </div>
            ) : versions.length === 0 ? (
              <div className="text-center py-8">
                <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No version history found</p>
              </div>
            ) : (
              versions.map((version, index) => {
                const VersionIcon = getVersionIcon(version);
                const isSelected = selectedVersions.includes(version.id);
                
                return (
                  <div key={version.id}>
                    <div 
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                        isSelected 
                          ? "border-primary bg-primary/5" 
                          : "border-border hover:border-primary/50",
                        version.is_current && "ring-2 ring-success/20"
                      )}
                      onClick={() => handleVersionSelect(version.id)}
                    >
                      <div className={cn(
                        "flex-shrink-0 p-2 rounded-full",
                        version.is_current ? "bg-success/10" : "bg-muted"
                      )}>
                        <VersionIcon className={cn("h-4 w-4", getVersionColor(version))} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-medium">
                              v{version.version_number}
                            </span>
                            {version.is_current && (
                              <Badge variant="default" className="text-xs">
                                Current
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(version.created_at).toLocaleDateString()}
                          </div>
                        </div>

                        <p className="text-sm mb-2 text-muted-foreground">
                          {version.change_reason || 'No description'}
                        </p>

                        {version.snapshot_data?.selling_price && (
                          <div className="flex items-center gap-4 text-xs">
                            <span className="font-medium">
                              {formatCurrency(version.snapshot_data.selling_price)}
                            </span>
                            <span className="text-muted-foreground">
                              Status: {version.snapshot_data.status}
                            </span>
                          </div>
                        )}

                        {version.profiles && (
                          <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                            <User className="h-3 w-3" />
                            <span>
                              {version.profiles.first_name} {version.profiles.last_name}
                            </span>
                          </div>
                        )}
                      </div>

                      {!version.is_current && (
                        <div className="flex flex-col gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRollbackVersion(version.id);
                            }}
                          >
                            <Undo className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>

                    {index < versions.length - 1 && (
                      <div className="flex justify-center py-2">
                        <ArrowRight className="h-4 w-4 text-muted-foreground rotate-90" />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default EstimateVersionHistory;