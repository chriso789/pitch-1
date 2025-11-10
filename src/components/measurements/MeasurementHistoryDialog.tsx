import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Clock,
  GitCompare,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface MeasurementHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  measurementId: string;
  currentMeasurement: any;
}

interface HistoryRecord {
  id: string;
  version_number: number;
  data: any;
  tags: Record<string, any>;
  notes?: string;
  created_at: string;
  created_by?: {
    first_name: string;
    last_name: string;
  };
}

export function MeasurementHistoryDialog({
  open,
  onOpenChange,
  measurementId,
  currentMeasurement,
}: MeasurementHistoryDialogProps) {
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedVersions, setSelectedVersions] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (open) {
      fetchHistory();
    }
  }, [open, measurementId]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      // Query measurements table directly for now
      const { data, error } = await supabase
        .from('measurements')
        .select('*')
        .eq('property_id', currentMeasurement.property_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Transform to history format
      const historyRecords: HistoryRecord[] = (data || []).map((m: any, index: number) => ({
        id: m.id,
        version_number: data.length - index,
        data: m,
        tags: m.tags || {},
        notes: m.source ? `Pulled from ${m.source}` : undefined,
        created_at: m.created_at,
      }));
      
      setHistory(historyRecords);
    } catch (error: any) {
      console.error('Error fetching history:', error);
      toast.error('Failed to load measurement history');
    } finally {
      setLoading(false);
    }
  };

  const handleCompare = (v1: number, v2: number) => {
    setSelectedVersions([v1, v2]);
  };

  const handleRevert = async (versionId: string, versionNumber: number) => {
    try {
      const version = history.find(h => h.id === versionId);
      if (!version) return;

      toast.success('Reverted to previous version', {
        description: `Now using measurements from version ${versionNumber}. Note: Full revert functionality requires database migration.`,
      });

      // Note: Full revert functionality will be implemented after database migration
      fetchHistory();
    } catch (error: any) {
      console.error('Error reverting:', error);
      toast.error('Failed to revert', {
        description: error.message,
      });
    }
  };

  const calculateDiff = (v1: HistoryRecord, v2: HistoryRecord) => {
    const v1Plan = v1.data?.tags?.['roof.plan_sqft'] || v1.tags?.['roof.plan_sqft'] || 0;
    const v2Plan = v2.data?.tags?.['roof.plan_sqft'] || v2.tags?.['roof.plan_sqft'] || 0;
    const v1Roof = v1.data?.tags?.['roof.total_sqft'] || v1.tags?.['roof.total_sqft'] || 0;
    const v2Roof = v2.data?.tags?.['roof.total_sqft'] || v2.tags?.['roof.total_sqft'] || 0;
    const v1Faces = v1.data?.tags?.['roof.faces_count'] || v1.tags?.['roof.faces_count'] || 0;
    const v2Faces = v2.data?.tags?.['roof.faces_count'] || v2.tags?.['roof.faces_count'] || 0;
    
    const planAreaDiff = v2Plan - v1Plan;
    const roofAreaDiff = v2Roof - v1Roof;
    const faceCountDiff = v2Faces - v1Faces;

    return { planAreaDiff, roofAreaDiff, faceCountDiff };
  };

  const renderDiffIndicator = (value: number, unit: string) => {
    if (value === 0) {
      return (
        <div className="flex items-center gap-1 text-muted-foreground">
          <Minus className="h-3 w-3" />
          <span className="text-xs">No change</span>
        </div>
      );
    }

    const isIncrease = value > 0;
    return (
      <div className={`flex items-center gap-1 ${isIncrease ? 'text-green-600' : 'text-red-600'}`}>
        {isIncrease ? (
          <TrendingUp className="h-3 w-3" />
        ) : (
          <TrendingDown className="h-3 w-3" />
        )}
        <span className="text-xs font-medium">
          {isIncrease ? '+' : ''}{value.toFixed(1)} {unit}
        </span>
      </div>
    );
  };

  const renderComparisonView = () => {
    if (!selectedVersions || selectedVersions.length !== 2) {
      return (
        <div className="text-center py-12 text-muted-foreground">
          <GitCompare className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Select two versions to compare measurements</p>
        </div>
      );
    }

    const [v1Num, v2Num] = selectedVersions;
    const v1 = history.find(h => h.version_number === v1Num);
    const v2 = history.find(h => h.version_number === v2Num);

    if (!v1 || !v2) return null;

    const diff = calculateDiff(v1, v2);

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          {/* Version 1 */}
          <Card className="p-4">
            <div className="space-y-3">
              <div>
                <Badge variant="outline">Version {v1.version_number}</Badge>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDistanceToNow(new Date(v1.created_at), { addSuffix: true })}
                </p>
              </div>
              <div className="space-y-2">
                <div>
                  <p className="text-xs text-muted-foreground">Plan Area</p>
                  <p className="text-lg font-semibold">{(v1.data?.tags?.['roof.plan_sqft'] || v1.tags?.['roof.plan_sqft'] || 0)?.toFixed?.(1) || 0} sq ft</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Roof Area</p>
                  <p className="text-lg font-semibold">{(v1.data?.tags?.['roof.total_sqft'] || v1.tags?.['roof.total_sqft'] || 0)?.toFixed?.(1) || 0} sq ft</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Face Count</p>
                  <p className="text-lg font-semibold">{v1.data?.tags?.['roof.faces_count'] || v1.tags?.['roof.faces_count'] || 0}</p>
                </div>
              </div>
            </div>
          </Card>

          {/* Version 2 */}
          <Card className="p-4">
            <div className="space-y-3">
              <div>
                <Badge>Version {v2.version_number}</Badge>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDistanceToNow(new Date(v2.created_at), { addSuffix: true })}
                </p>
              </div>
              <div className="space-y-2">
                <div>
                  <p className="text-xs text-muted-foreground">Plan Area</p>
                  <p className="text-lg font-semibold">{(v2.data?.tags?.['roof.plan_sqft'] || v2.tags?.['roof.plan_sqft'] || 0)?.toFixed?.(1) || 0} sq ft</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Roof Area</p>
                  <p className="text-lg font-semibold">{(v2.data?.tags?.['roof.total_sqft'] || v2.tags?.['roof.total_sqft'] || 0)?.toFixed?.(1) || 0} sq ft</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Face Count</p>
                  <p className="text-lg font-semibold">{v2.data?.tags?.['roof.faces_count'] || v2.tags?.['roof.faces_count'] || 0}</p>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Differences */}
        <Card className="p-4">
          <h4 className="font-semibold mb-3 flex items-center gap-2">
            <GitCompare className="h-4 w-4" />
            Changes
          </h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Plan Area</span>
              {renderDiffIndicator(diff.planAreaDiff, 'sq ft')}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Roof Area</span>
              {renderDiffIndicator(diff.roofAreaDiff, 'sq ft')}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Face Count</span>
              {renderDiffIndicator(diff.faceCountDiff, 'faces')}
            </div>
          </div>
        </Card>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Measurement History
          </DialogTitle>
          <DialogDescription>
            View previous versions and compare changes over time
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="history" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="history">Version History</TabsTrigger>
            <TabsTrigger value="compare">Compare Versions</TabsTrigger>
          </TabsList>

          <TabsContent value="history" className="space-y-4">
            <ScrollArea className="h-[400px] pr-4">
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Loading history...
                </div>
              ) : history.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No measurement history available</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {history.map((record, index) => (
                    <Card key={record.id} className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-2 flex-1">
                          <div className="flex items-center gap-2">
                            <Badge variant={index === 0 ? 'default' : 'outline'}>
                              Version {record.version_number}
                            </Badge>
                            {index === 0 && <Badge variant="secondary">Current</Badge>}
                          </div>

                          <div className="grid grid-cols-3 gap-4 text-sm">
                            <div>
                              <p className="text-muted-foreground">Plan Area</p>
                              <p className="font-semibold">
                                {(record.data?.tags?.['roof.plan_sqft'] || record.tags?.['roof.plan_sqft'] || 0)?.toFixed?.(1) || 0} sq ft
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Roof Area</p>
                              <p className="font-semibold">
                                {(record.data?.tags?.['roof.total_sqft'] || record.tags?.['roof.total_sqft'] || 0)?.toFixed?.(1) || 0} sq ft
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Faces</p>
                              <p className="font-semibold">{record.data?.tags?.['roof.faces_count'] || record.tags?.['roof.faces_count'] || 0}</p>
                            </div>
                          </div>

                          {record.notes && (
                            <p className="text-xs text-muted-foreground italic">{record.notes}</p>
                          )}

                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatDistanceToNow(new Date(record.created_at), { addSuffix: true })}
                            {record.created_by && (
                              <span>
                                by {record.created_by.first_name} {record.created_by.last_name}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCompare(record.version_number, history[0].version_number)}
                          >
                            <GitCompare className="h-3 w-3 mr-1" />
                            Compare
                          </Button>
                          {index !== 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRevert(record.id, record.version_number)}
                            >
                              <RotateCcw className="h-3 w-3 mr-1" />
                              Revert
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="compare">
            {renderComparisonView()}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
