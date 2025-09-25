import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  GitCompare, 
  Plus, 
  Minus, 
  Edit, 
  AlertCircle,
  ArrowRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface EstimateVersionDiffProps {
  version1Id: string;
  version2Id: string;
}

interface VersionDiff {
  field_name: string;
  old_value: string;
  new_value: string;
  change_type: 'added' | 'removed' | 'modified';
}

const EstimateVersionDiff = ({ version1Id, version2Id }: EstimateVersionDiffProps) => {
  const [diffs, setDiffs] = useState<VersionDiff[]>([]);
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState<{ v1: any; v2: any }>({ v1: null, v2: null });
  const { toast } = useToast();

  useEffect(() => {
    fetchVersionDiff();
  }, [version1Id, version2Id]);

  const fetchVersionDiff = async () => {
    try {
      setLoading(true);
      
      // Fetch both versions for metadata
      const [v1Response, v2Response] = await Promise.all([
        supabase.from('estimate_versions').select('*').eq('id', version1Id).single(),
        supabase.from('estimate_versions').select('*').eq('id', version2Id).single()
      ]);

      if (v1Response.error) throw v1Response.error;
      if (v2Response.error) throw v2Response.error;

      setVersions({ v1: v1Response.data, v2: v2Response.data });

      // Calculate diff manually since we need better control
      const v1Data = v1Response.data.snapshot_data;
      const v2Data = v2Response.data.snapshot_data;
      
      const calculatedDiffs: VersionDiff[] = [];
      const allKeys = new Set([...Object.keys(v1Data || {}), ...Object.keys(v2Data || {})]);

      allKeys.forEach(key => {
        const val1 = v1Data?.[key];
        const val2 = v2Data?.[key];

        if (JSON.stringify(val1) !== JSON.stringify(val2)) {
          let changeType: 'added' | 'removed' | 'modified' = 'modified';
          
          if (val1 === undefined || val1 === null) {
            changeType = 'added';
          } else if (val2 === undefined || val2 === null) {
            changeType = 'removed';
          }

          calculatedDiffs.push({
            field_name: key,
            old_value: formatValue(val1),
            new_value: formatValue(val2),
            change_type: changeType
          });
        }
      });

      setDiffs(calculatedDiffs);
    } catch (error) {
      console.error('Error fetching version diff:', error);
      toast({
        title: "Error",
        description: "Failed to load version differences",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    if (typeof value === 'number' && value > 1000) {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value);
    }
    return String(value);
  };

  const formatFieldName = (fieldName: string): string => {
    return fieldName
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase()
      .replace(/^./, str => str.toUpperCase());
  };

  const getChangeIcon = (changeType: string) => {
    switch (changeType) {
      case 'added': return Plus;
      case 'removed': return Minus;
      case 'modified': return Edit;
      default: return Edit;
    }
  };

  const getChangeColor = (changeType: string) => {
    switch (changeType) {
      case 'added': return 'text-success';
      case 'removed': return 'text-destructive';
      case 'modified': return 'text-warning';
      default: return 'text-muted-foreground';
    }
  };

  const getChangeBadgeVariant = (changeType: string) => {
    switch (changeType) {
      case 'added': return 'default';
      case 'removed': return 'destructive';
      case 'modified': return 'secondary';
      default: return 'outline';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            <span className="ml-2 text-sm text-muted-foreground">Comparing versions...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitCompare className="h-5 w-5" />
          Version Comparison
        </CardTitle>
        
        {versions.v1 && versions.v2 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">v{versions.v1.version_number}</Badge>
            <ArrowRight className="h-4 w-4" />
            <Badge variant="outline">v{versions.v2.version_number}</Badge>
          </div>
        )}
      </CardHeader>

      <CardContent>
        <ScrollArea className="h-96">
          {diffs.length === 0 ? (
            <div className="text-center py-8">
              <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No differences found between versions</p>
            </div>
          ) : (
            <div className="space-y-4">
              {diffs.map((diff, index) => {
                const ChangeIcon = getChangeIcon(diff.change_type);
                
                return (
                  <div key={index} className="border rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <ChangeIcon className={cn("h-4 w-4", getChangeColor(diff.change_type))} />
                      <span className="font-medium">{formatFieldName(diff.field_name)}</span>
                      <Badge variant={getChangeBadgeVariant(diff.change_type)} className="text-xs">
                        {diff.change_type}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {diff.change_type !== 'added' && (
                        <div className="space-y-2">
                          <span className="text-xs font-medium text-muted-foreground">Previous Value</span>
                          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-sm">
                            <pre className="whitespace-pre-wrap font-mono text-xs">
                              {diff.old_value}
                            </pre>
                          </div>
                        </div>
                      )}

                      {diff.change_type !== 'removed' && (
                        <div className="space-y-2">
                          <span className="text-xs font-medium text-muted-foreground">New Value</span>
                          <div className="p-3 bg-success/10 border border-success/20 rounded text-sm">
                            <pre className="whitespace-pre-wrap font-mono text-xs">
                              {diff.new_value}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default EstimateVersionDiff;