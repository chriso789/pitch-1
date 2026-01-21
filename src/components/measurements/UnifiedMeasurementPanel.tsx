import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { 
  CheckCircle2, Trash2, Ruler, Star, Plus, ChevronDown,
  Loader2, FileText, Eye, Home, Sparkles, Pencil, Calculator,
  Clock, ArrowRight
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from '@/components/ui/use-toast';
import { ImportReportButton } from './ImportReportButton';
import { PullMeasurementsButton } from './PullMeasurementsButton';
import { ManualMeasurementButton } from '@/components/estimates/ManualMeasurementButton';
import { useDeviceLayout } from '@/hooks/useDeviceLayout';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface SavedMeasurement {
  id: string;
  approved_at: string;
  saved_tags: Record<string, any>;
  approval_notes: string | null;
  report_generated?: boolean;
  report_document_id?: string | null;
}

interface UnifiedMeasurementPanelProps {
  pipelineEntryId: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  onMeasurementChange?: () => void;
}

type SourceConfig = {
  label: string;
  color: string;
  icon: typeof FileText;
  bgClass: string;
  textClass: string;
  borderClass: string;
};

const getSourceConfig = (savedTags: Record<string, any>): SourceConfig => {
  const source = (savedTags?.source || '').toLowerCase();
  
  if (source.includes('xactimate')) {
    return { 
      label: 'Xactimate', 
      color: 'warning',
      icon: FileText,
      bgClass: 'bg-warning/10',
      textClass: 'text-warning',
      borderClass: 'border-warning/30'
    };
  }
  if (source.includes('eagleview')) {
    return { 
      label: 'EagleView', 
      color: 'success',
      icon: Eye,
      bgClass: 'bg-success/10',
      textClass: 'text-success',
      borderClass: 'border-success/30'
    };
  }
  if (source.includes('roofr')) {
    return { 
      label: 'Roofr', 
      color: 'accent',
      icon: Home,
      bgClass: 'bg-accent/50',
      textClass: 'text-accent-foreground',
      borderClass: 'border-accent'
    };
  }
  if (source.includes('ai') || source.includes('google') || source.includes('solar')) {
    return { 
      label: 'AI-Pulled', 
      color: 'info',
      icon: Sparkles,
      bgClass: 'bg-info/10',
      textClass: 'text-info',
      borderClass: 'border-info/30'
    };
  }
  return { 
    label: 'Manual', 
    color: 'muted',
    icon: Pencil,
    bgClass: 'bg-muted',
    textClass: 'text-muted-foreground',
    borderClass: 'border-muted'
  };
};

const formatValue = (val: number | null | undefined): string => {
  if (val === null || val === undefined) return '—';
  return val.toLocaleString(undefined, { maximumFractionDigits: 1 });
};

export function UnifiedMeasurementPanel({ 
  pipelineEntryId, 
  latitude = 0,
  longitude = 0,
  address = '',
  onMeasurementChange 
}: UnifiedMeasurementPanelProps) {
  const queryClient = useQueryClient();
  const layout = useDeviceLayout();
  const [activeApprovalId, setActiveApprovalId] = useState<string | null>(null);
  const [isSettingActive, setIsSettingActive] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [approvalToDelete, setApprovalToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [addOptionsOpen, setAddOptionsOpen] = useState(false);

  // Fetch current active approval from pipeline entry metadata
  useEffect(() => {
    async function fetchActiveApproval() {
      const { data } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();
      
      const metadata = data?.metadata as any;
      if (metadata?.selected_measurement_approval_id) {
        setActiveApprovalId(metadata.selected_measurement_approval_id);
      }
    }
    fetchActiveApproval();
  }, [pipelineEntryId]);

  // Fetch all measurement approvals (saved/approved measurements)
  const { data: approvals, isLoading, refetch } = useQuery({
    queryKey: ['measurement-approvals', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('measurement_approvals')
        .select('id, approved_at, saved_tags, approval_notes, report_generated, report_document_id')
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('approved_at', { ascending: false });

      if (error) throw error;
      return data as SavedMeasurement[];
    },
    enabled: !!pipelineEntryId,
  });

  // Fetch raw vendor reports (roof_vendor_reports) for history
  const { data: vendorReports } = useQuery({
    queryKey: ['vendor-reports', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roof_vendor_reports')
        .select('id, provider, address, created_at, parsed')
        .eq('lead_id', pipelineEntryId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching vendor reports:', error);
        return [];
      }
      return (data || []).map(r => ({
        id: r.id,
        provider: r.provider,
        address: r.address,
        created_at: r.created_at,
        parsed: (r.parsed && typeof r.parsed === 'object' && !Array.isArray(r.parsed)) 
          ? r.parsed as Record<string, any>
          : null
      }));
    },
    enabled: !!pipelineEntryId,
  });

  // Fetch AI-pulled measurements (roof_measurements) for history
  const { data: aiMeasurements } = useQuery({
    queryKey: ['ai-measurements', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roof_measurements')
        .select('id, created_at, customer_id, total_area_adjusted_sqft, total_squares, predominant_pitch, facet_count, total_ridge_length, total_hip_length, total_valley_length')
        .eq('customer_id', pipelineEntryId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching AI measurements:', error);
        return [];
      }
      return data || [];
    },
    enabled: !!pipelineEntryId,
  });

  const handleSetActive = async (approvalId: string) => {
    setIsSettingActive(true);
    try {
      const { data: currentEntry } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();

      const currentMetadata = (currentEntry?.metadata as Record<string, any>) || {};
      
      const { error } = await supabase
        .from('pipeline_entries')
        .update({
          metadata: {
            ...currentMetadata,
            selected_measurement_approval_id: approvalId
          }
        })
        .eq('id', pipelineEntryId);

      if (error) throw error;

      setActiveApprovalId(approvalId);
      
      // Invalidate queries to refresh estimate templates
      queryClient.invalidateQueries({ queryKey: ['measurement-context', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['measurement-approvals', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['active-measurement', pipelineEntryId] });

      toast({
        title: 'Measurement Selected',
        description: 'This measurement will now be used for estimates',
      });

      onMeasurementChange?.();
    } catch (error: any) {
      console.error('Error setting active approval:', error);
      toast({
        title: 'Error',
        description: 'Failed to set active measurement',
        variant: 'destructive',
      });
    } finally {
      setIsSettingActive(false);
    }
  };

  const handleDeleteClick = (approvalId: string) => {
    setApprovalToDelete(approvalId);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!approvalToDelete) return;

    setIsDeleting(true);
    try {
      // If deleting the active measurement, clear the selection first
      if (approvalToDelete === activeApprovalId) {
        const { data: currentEntry } = await supabase
          .from('pipeline_entries')
          .select('metadata')
          .eq('id', pipelineEntryId)
          .single();

        const currentMetadata = (currentEntry?.metadata as Record<string, any>) || {};
        
        await supabase
          .from('pipeline_entries')
          .update({
            metadata: {
              ...currentMetadata,
              selected_measurement_approval_id: null
            }
          })
          .eq('id', pipelineEntryId);

        setActiveApprovalId(null);
      }

      // Delete the approval
      const { error } = await supabase
        .from('measurement_approvals')
        .delete()
        .eq('id', approvalToDelete);

      if (error) throw error;

      toast({
        title: 'Deleted',
        description: 'Measurement deleted successfully',
      });

      queryClient.invalidateQueries({ queryKey: ['measurement-approvals', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['measurement-context', pipelineEntryId] });
      
      onMeasurementChange?.();
    } catch (error: any) {
      console.error('Delete error:', error);
      toast({
        title: 'Delete Failed',
        description: error.message || 'Failed to delete measurement',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setApprovalToDelete(null);
    }
  };

  const handleMeasurementSuccess = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ['measurement-context', pipelineEntryId] });
    onMeasurementChange?.();
    setAddOptionsOpen(false);
  };

  // Separate active from other measurements
  const activeMeasurement = approvals?.find(a => a.id === activeApprovalId);
  const otherMeasurements = approvals?.filter(a => a.id !== activeApprovalId) || [];
  const hasAnyMeasurements = approvals && approvals.length > 0;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading measurements...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Ruler className="h-5 w-5" />
                Saved Measurements
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Select which measurement to use for estimates
              </p>
            </div>
            {hasAnyMeasurements && (
              <Badge variant="secondary" className="text-xs">
                {approvals!.length} saved
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Active Measurement - Highlighted */}
          {activeMeasurement && (
            <MeasurementCard
              measurement={activeMeasurement}
              isActive={true}
              isPhone={layout.isPhone}
              onSetActive={() => {}}
              onDelete={() => handleDeleteClick(activeMeasurement.id)}
              isSettingActive={false}
            />
          )}

          {/* Other Measurements */}
          {otherMeasurements.length > 0 && (
            <div className="space-y-2">
              {activeMeasurement && (
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Other Measurements
                </p>
              )}
              <ScrollArea className={otherMeasurements.length > 2 ? 'h-[280px]' : undefined}>
                <div className="space-y-2">
                  {otherMeasurements.map((measurement) => (
                    <MeasurementCard
                      key={measurement.id}
                      measurement={measurement}
                      isActive={false}
                      isPhone={layout.isPhone}
                      onSetActive={() => handleSetActive(measurement.id)}
                      onDelete={() => handleDeleteClick(measurement.id)}
                      isSettingActive={isSettingActive}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Empty State */}
          {!hasAnyMeasurements && (
            <div className="flex flex-col items-center justify-center py-8 gap-4 border-2 border-dashed rounded-lg">
              <div className="rounded-full bg-muted p-3">
                <Ruler className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="font-medium">No Saved Measurements</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Import a report or pull AI measurements to get started
                </p>
              </div>
            </div>
          )}

          {/* Measurement History Section */}
          <MeasurementHistorySection
            vendorReports={vendorReports || []}
            aiMeasurements={aiMeasurements || []}
            pipelineEntryId={pipelineEntryId}
            onSaveToApprovals={handleMeasurementSuccess}
            isPhone={layout.isPhone}
          />

          {/* Add Measurement Options */}
          <Collapsible open={addOptionsOpen} onOpenChange={setAddOptionsOpen}>
            <CollapsibleTrigger asChild>
              <Button 
                variant="outline" 
                className="w-full justify-between"
                style={{ minHeight: layout.isPhone ? 48 : 40 }}
              >
                <span className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add Measurement
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${addOptionsOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <div className={`flex flex-col gap-2 ${layout.isPhone ? '' : 'sm:flex-row'}`}>
                <ImportReportButton 
                  pipelineEntryId={pipelineEntryId}
                  onSuccess={handleMeasurementSuccess}
                />
                <PullMeasurementsButton 
                  propertyId={pipelineEntryId}
                  lat={latitude}
                  lng={longitude}
                  address={address}
                  onSuccess={handleMeasurementSuccess}
                />
                <ManualMeasurementButton
                  pipelineEntryId={pipelineEntryId}
                  onSuccess={handleMeasurementSuccess}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Measurement?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this saved measurement. 
              {approvalToDelete === activeApprovalId && 
                " Since this is your active measurement, you'll need to select another one for estimates."
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Individual Measurement Card Component
interface MeasurementCardProps {
  measurement: SavedMeasurement;
  isActive: boolean;
  isPhone: boolean;
  onSetActive: () => void;
  onDelete: () => void;
  isSettingActive: boolean;
}

function MeasurementCard({ 
  measurement, 
  isActive, 
  isPhone,
  onSetActive, 
  onDelete,
  isSettingActive 
}: MeasurementCardProps) {
  const tags = measurement.saved_tags || {};
  const sourceConfig = getSourceConfig(tags);
  const SourceIcon = sourceConfig.icon;

  // Extract measurement values
  const squares = tags['roof.squares'] || tags['xactimate.squares'] || 
    (tags['roof.plan_area'] ? (tags['roof.plan_area'] / 100).toFixed(1) : null);
  const sqft = tags['roof.total_sqft'] || tags['roof.plan_area'] || tags['xactimate.total_area'] || 0;
  const pitch = tags['roof.predominant_pitch'] || tags['xactimate.pitch'] || '—';
  const ridgeLf = tags['lf.ridge'] || tags['xactimate.ridge_lf'] || 0;
  const hipLf = tags['lf.hip'] || tags['xactimate.hip_lf'] || 0;
  const valleyLf = tags['lf.valley'] || tags['xactimate.valley_lf'] || 0;

  return (
    <div
      className={`
        relative p-4 rounded-lg border transition-all
        ${isActive 
          ? 'border-primary bg-primary/5 ring-2 ring-primary/20' 
          : 'border-border hover:border-muted-foreground/30 bg-card'
        }
      `}
    >
      {/* Header with Source Badge and Date */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge 
            variant="outline" 
            className={`${sourceConfig.bgClass} ${sourceConfig.textClass} ${sourceConfig.borderClass}`}
          >
            <SourceIcon className="h-3 w-3 mr-1" />
            {sourceConfig.label}
          </Badge>
          {isActive && (
            <Badge className="bg-primary text-primary-foreground">
              <Star className="h-3 w-3 mr-1 fill-current" />
              Active
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {format(new Date(measurement.approved_at), 'MMM d, yyyy')}
        </span>
      </div>

      {/* Measurements Grid */}
      <div className={`grid gap-x-4 gap-y-2 text-sm ${isPhone ? 'grid-cols-2' : 'grid-cols-3 sm:grid-cols-6'}`}>
        <div>
          <span className="text-muted-foreground text-xs">Squares</span>
          <p className="font-semibold">{formatValue(Number(squares))}</p>
        </div>
        <div>
          <span className="text-muted-foreground text-xs">Sq Ft</span>
          <p className="font-semibold">{formatValue(sqft)}</p>
        </div>
        <div>
          <span className="text-muted-foreground text-xs">Pitch</span>
          <p className="font-semibold">{pitch}</p>
        </div>
        <div>
          <span className="text-muted-foreground text-xs">Ridge</span>
          <p className="font-semibold">{formatValue(ridgeLf)} ft</p>
        </div>
        <div>
          <span className="text-muted-foreground text-xs">Hip</span>
          <p className="font-semibold">{formatValue(hipLf)} ft</p>
        </div>
        <div>
          <span className="text-muted-foreground text-xs">Valley</span>
          <p className="font-semibold">{formatValue(valleyLf)} ft</p>
        </div>
      </div>

      {/* Notes if any */}
      {measurement.approval_notes && (
        <p className="text-xs text-muted-foreground mt-2 truncate italic">
          "{measurement.approval_notes}"
        </p>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t">
        {!isActive && (
          <Button
            size="sm"
            variant="secondary"
            onClick={onSetActive}
            disabled={isSettingActive}
            style={{ minHeight: isPhone ? 44 : 32 }}
            className="flex-1"
          >
            {isSettingActive ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Calculator className="h-4 w-4 mr-1.5" />
                Use for Estimates
              </>
            )}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          style={{ minHeight: isPhone ? 44 : 32 }}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// Measurement History Section Component
interface MeasurementHistorySectionProps {
  vendorReports: Array<{
    id: string;
    provider: string | null;
    address: string | null;
    created_at: string;
    parsed: Record<string, any> | null;
  }>;
  aiMeasurements: Array<{
    id: string;
    created_at: string;
    customer_id: string;
    total_area_adjusted_sqft: number | null;
    total_squares: number | null;
    predominant_pitch: string | null;
    facet_count: number | null;
    total_ridge_length: number | null;
    total_hip_length: number | null;
    total_valley_length: number | null;
  }>;
  pipelineEntryId: string;
  onSaveToApprovals: () => void;
  isPhone: boolean;
}

function MeasurementHistorySection({
  vendorReports,
  aiMeasurements,
  pipelineEntryId,
  onSaveToApprovals,
  isPhone,
}: MeasurementHistorySectionProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const totalHistoryCount = (vendorReports?.length || 0) + (aiMeasurements?.length || 0);

  if (totalHistoryCount === 0) {
    return null;
  }

  const handleSaveVendorReport = async (report: MeasurementHistorySectionProps['vendorReports'][0]) => {
    setIsSaving(report.id);
    try {
      const { data: entry } = await supabase
        .from('pipeline_entries')
        .select('tenant_id, metadata')
        .eq('id', pipelineEntryId)
        .single();

      if (!entry?.tenant_id) throw new Error('No tenant found');

      const parsed = report.parsed || {};
      const totalSquares = parsed.total_area_sqft ? parsed.total_area_sqft / 100 : 0;

      const savedTags = {
        'roof.plan_area': parsed.total_area_sqft || 0,
        'roof.total_sqft': parsed.total_area_sqft || 0,
        'roof.squares': totalSquares,
        'roof.predominant_pitch': parsed.predominant_pitch || '6/12',
        'roof.faces_count': parsed.facet_count || 0,
        'lf.ridge': parsed.ridges_ft || 0,
        'lf.hip': parsed.hips_ft || 0,
        'lf.valley': parsed.valleys_ft || 0,
        'lf.rake': parsed.rakes_ft || 0,
        'lf.eave': parsed.eaves_ft || 0,
        'source': `imported_${report.provider || 'unknown'}`,
        'imported_at': report.created_at,
      };

      await supabase.from('measurement_approvals').insert({
        tenant_id: entry.tenant_id,
        pipeline_entry_id: pipelineEntryId,
        approved_at: new Date().toISOString(),
        saved_tags: savedTags,
        approval_notes: `Saved from ${report.provider} history - ${parsed.total_area_sqft?.toLocaleString() || 0} sqft`,
      });

      toast({
        title: 'Measurement Saved',
        description: `${report.provider} measurement added to saved list`,
      });

      queryClient.invalidateQueries({ queryKey: ['measurement-approvals', pipelineEntryId] });
      onSaveToApprovals();
    } catch (error: any) {
      console.error('Save error:', error);
      toast({
        title: 'Save Failed',
        description: error.message || 'Failed to save measurement',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(null);
    }
  };

  const handleSaveAiMeasurement = async (measurement: MeasurementHistorySectionProps['aiMeasurements'][0]) => {
    setIsSaving(measurement.id);
    try {
      const { data: entry } = await supabase
        .from('pipeline_entries')
        .select('tenant_id, metadata')
        .eq('id', pipelineEntryId)
        .single();

      if (!entry?.tenant_id) throw new Error('No tenant found');

      const totalSquares = measurement.total_squares || (measurement.total_area_adjusted_sqft ? measurement.total_area_adjusted_sqft / 100 : 0);

      const savedTags = {
        'roof.plan_area': measurement.total_area_adjusted_sqft || 0,
        'roof.total_sqft': measurement.total_area_adjusted_sqft || 0,
        'roof.squares': totalSquares,
        'roof.predominant_pitch': measurement.predominant_pitch || '6/12',
        'roof.faces_count': measurement.facet_count || 0,
        'lf.ridge': measurement.total_ridge_length || 0,
        'lf.hip': measurement.total_hip_length || 0,
        'lf.valley': measurement.total_valley_length || 0,
        'source': 'ai_pulled',
        'imported_at': measurement.created_at,
      };

      await supabase.from('measurement_approvals').insert({
        tenant_id: entry.tenant_id,
        pipeline_entry_id: pipelineEntryId,
        approved_at: new Date().toISOString(),
        saved_tags: savedTags,
        approval_notes: `Saved from AI measurement - ${measurement.total_area_adjusted_sqft?.toLocaleString() || 0} sqft`,
      });

      toast({
        title: 'Measurement Saved',
        description: 'AI measurement added to saved list',
      });

      queryClient.invalidateQueries({ queryKey: ['measurement-approvals', pipelineEntryId] });
      onSaveToApprovals();
    } catch (error: any) {
      console.error('Save error:', error);
      toast({
        title: 'Save Failed',
        description: error.message || 'Failed to save measurement',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(null);
    }
  };

  return (
    <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
      <CollapsibleTrigger asChild>
        <Button 
          variant="ghost" 
          className="w-full justify-between text-muted-foreground hover:text-foreground"
          style={{ minHeight: isPhone ? 44 : 36 }}
        >
          <span className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Measurement History ({totalHistoryCount})
          </span>
          <ChevronDown className={`h-4 w-4 transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 space-y-2">
        {/* Vendor Reports */}
        {vendorReports.map((report) => {
          const sqft = report.parsed?.total_area_sqft || 0;
          return (
            <div 
              key={report.id}
              className="flex items-center justify-between p-3 border rounded-lg bg-muted/30"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 shrink-0">
                  <FileText className="h-3 w-3 mr-1" />
                  {report.provider || 'Report'}
                </Badge>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {sqft.toLocaleString()} sqft
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(report.created_at), 'MMM d, yyyy')}
                  </p>
                </div>
              </div>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => handleSaveVendorReport(report)}
                disabled={isSaving === report.id}
                className="shrink-0"
              >
                {isSaving === report.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <ArrowRight className="h-4 w-4 mr-1" />
                    Save
                  </>
                )}
              </Button>
            </div>
          );
        })}

        {/* AI Measurements */}
        {aiMeasurements.map((measurement) => {
          const sqft = measurement.total_area_adjusted_sqft || 0;
          return (
            <div 
              key={measurement.id}
              className="flex items-center justify-between p-3 border rounded-lg bg-muted/30"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Badge variant="outline" className="bg-info/10 text-info border-info/30 shrink-0">
                  <Sparkles className="h-3 w-3 mr-1" />
                  AI-Pulled
                </Badge>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {sqft.toLocaleString()} sqft
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(measurement.created_at), 'MMM d, yyyy')}
                  </p>
                </div>
              </div>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => handleSaveAiMeasurement(measurement)}
                disabled={isSaving === measurement.id}
                className="shrink-0"
              >
                {isSaving === measurement.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <ArrowRight className="h-4 w-4 mr-1" />
                    Save
                  </>
                )}
              </Button>
            </div>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}

