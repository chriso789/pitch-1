import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SegmentHoverProvider } from '@/contexts/SegmentHoverContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
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
import { QuickEstimateButton } from './QuickEstimateButton';
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

  // REALTIME: Auto-refresh when new measurements are saved
  // This ensures UI updates immediately when AI analysis completes
  useEffect(() => {
    const channel = supabase
      .channel(`measurement-updates-${pipelineEntryId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'measurement_approvals',
        filter: `pipeline_entry_id=eq.${pipelineEntryId}`
      }, (payload) => {
        console.log('📊 New measurement detected via Realtime:', payload);
        refetch();
        queryClient.invalidateQueries({ queryKey: ['ai-measurements', pipelineEntryId] });
        queryClient.invalidateQueries({ queryKey: ['measurement-context', pipelineEntryId] });
      })
      .subscribe();
      
    return () => {
      supabase.removeChannel(channel);
    };
  }, [pipelineEntryId, refetch, queryClient]);

  // Fetch raw vendor reports (roof_vendor_reports) for history
  // Include reports linked to this lead AND recent reports from same tenant
  const { data: vendorReports } = useQuery({
    queryKey: ['vendor-reports-history', pipelineEntryId, address],
    queryFn: async () => {
      // First, get reports directly linked to this lead
      const { data: byLead, error: leadError } = await supabase
        .from('roof_vendor_reports')
        .select('id, provider, address, created_at, parsed, lead_id')
        .eq('lead_id', pipelineEntryId)
        .order('created_at', { ascending: false });

      if (leadError) {
        console.error('Error fetching vendor reports by lead:', leadError);
      }

      // Also get recent reports (last 60 days) - only show reports linked to this specific lead
      // to avoid showing training data from other locations
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recentAll, error: recentError } = await supabase
        .from('roof_vendor_reports')
        .select('id, provider, address, created_at, parsed, lead_id')
        .eq('lead_id', pipelineEntryId)
        .gte('created_at', sixtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(20);

      if (recentError) {
        console.error('Error fetching recent vendor reports:', recentError);
      }

      // Merge and dedupe, marking which are linked to this lead
      const combined = new Map<string, {
        id: string;
        provider: string | null;
        address: string | null;
        created_at: string;
        parsed: Record<string, any> | null;
        linkedToLead: boolean;
      }>();

      (byLead || []).forEach(r => {
        combined.set(r.id, {
          id: r.id,
          provider: r.provider,
          address: r.address,
          created_at: r.created_at,
          parsed: (r.parsed && typeof r.parsed === 'object' && !Array.isArray(r.parsed)) 
            ? r.parsed as Record<string, any>
            : null,
          linkedToLead: true,
        });
      });

      (recentAll || []).forEach(r => {
        if (!combined.has(r.id)) {
          combined.set(r.id, {
            id: r.id,
            provider: r.provider,
            address: r.address,
            created_at: r.created_at,
            parsed: (r.parsed && typeof r.parsed === 'object' && !Array.isArray(r.parsed)) 
              ? r.parsed as Record<string, any>
              : null,
            linkedToLead: r.lead_id === pipelineEntryId,
          });
        }
      });

      return Array.from(combined.values());
    },
    enabled: !!pipelineEntryId,
  });

  // Fetch AI-pulled measurements (roof_measurements) for history
  const { data: aiMeasurements } = useQuery({
    queryKey: ['ai-measurements', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roof_measurements')
        .select('id, created_at, customer_id, total_area_adjusted_sqft, total_squares, predominant_pitch, facet_count, total_ridge_length, total_hip_length, total_valley_length, total_eave_length, total_rake_length, footprint_source, detection_method')
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

  const handleMeasurementSuccess = async () => {
    // Force immediate refetch and cache invalidation
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['measurement-context', pipelineEntryId] });
    queryClient.invalidateQueries({ queryKey: ['ai-measurements', pipelineEntryId] });
    queryClient.invalidateQueries({ queryKey: ['measurement-approvals', pipelineEntryId] });
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
            <div className="flex items-center gap-2">
              {hasAnyMeasurements && (
                <Badge variant="secondary" className="text-xs">
                  {approvals!.length} saved
                </Badge>
              )}
              <QuickEstimateButton
                pipelineEntryId={pipelineEntryId}
                hasMeasurement={!!activeMeasurement}
              />
            </div>
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
  
  // Additional linear measurements from Xactimate
  const perimeterLf = tags['lf.perimeter'] || tags['xactimate.perimeter_lf'] || 0;
  const eaveLf = tags['lf.eave'] || tags['xactimate.eave_lf'] || 0;

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

      {/* Measurements Grid - Two Rows */}
      <div className={`grid gap-x-4 gap-y-3 text-sm ${isPhone ? 'grid-cols-2' : 'grid-cols-4'}`}>
        {/* Row 1: Area Measurements */}
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
          <span className="text-muted-foreground text-xs">Perimeter</span>
          <p className="font-semibold">{formatValue(perimeterLf)} ft</p>
        </div>
        
        {/* Row 2: Linear Features */}
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
        <div>
          <span className="text-muted-foreground text-xs">Eave</span>
          <p className="font-semibold">{formatValue(eaveLf)} ft</p>
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
    linkedToLead?: boolean;
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
    footprint_source?: string | null;
    detection_method?: string | null;
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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteType, setDeleteType] = useState<'vendor' | 'ai' | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const queryClient = useQueryClient();

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);

  const totalHistoryCount = (vendorReports?.length || 0) + (aiMeasurements?.length || 0);

  // Reset selection when closing select mode
  const handleToggleSelectMode = () => {
    if (selectMode) {
      setSelectedIds(new Set());
    }
    setSelectMode(!selectMode);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    const allIds = [
      ...vendorReports.map(r => r.id),
      ...aiMeasurements.map(m => m.id)
    ];
    setSelectedIds(new Set(allIds));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleBulkDelete = async () => {
    setIsBulkDeleting(true);
    try {
      const selectedArray = Array.from(selectedIds);
      
      // Separate vendor and AI IDs
      const vendorIds = selectedArray.filter(id => 
        vendorReports.some(r => r.id === id)
      );
      const aiIds = selectedArray.filter(id => 
        aiMeasurements.some(m => m.id === id)
      );

      // Delete in parallel
      if (vendorIds.length > 0) {
        await supabase.from('roof_vendor_reports').delete().in('id', vendorIds);
      }
      
      if (aiIds.length > 0) {
        await supabase.from('roof_measurements').delete().in('id', aiIds);
      }

      toast({
        title: 'Deleted Successfully',
        description: `Removed ${selectedArray.length} measurement(s) from history`,
      });

      // Reset state and invalidate queries
      setSelectedIds(new Set());
      setSelectMode(false);
      setBulkDeleteDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ['vendor-reports-history'] });
      queryClient.invalidateQueries({ queryKey: ['ai-measurements'] });
    } catch (error) {
      console.error('Bulk delete error:', error);
      toast({
        title: 'Delete Failed',
        description: 'Some measurements could not be deleted',
        variant: 'destructive',
      });
    } finally {
      setIsBulkDeleting(false);
    }
  };

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

      const eaveLength = (measurement as any).total_eave_length || 0;
      const rakeLength = (measurement as any).total_rake_length || 0;
      const perimeter = eaveLength + rakeLength;

      const savedTags = {
        'roof.plan_area': measurement.total_area_adjusted_sqft || 0,
        'roof.total_sqft': measurement.total_area_adjusted_sqft || 0,
        'roof.squares': totalSquares,
        'roof.predominant_pitch': measurement.predominant_pitch || '6/12',
        'roof.faces_count': measurement.facet_count || 0,
        'lf.ridge': measurement.total_ridge_length || 0,
        'lf.hip': measurement.total_hip_length || 0,
        'lf.valley': measurement.total_valley_length || 0,
        'lf.eave': eaveLength,
        'lf.rake': rakeLength,
        'lf.perimeter': perimeter,
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


  const handleDeleteVendorReport = async (reportId: string) => {
    setIsDeleting(true);
    try {
      await supabase.from('roof_vendor_reports').delete().eq('id', reportId);
      toast({ title: 'Report Deleted', description: 'Removed from history' });
      queryClient.invalidateQueries({ queryKey: ['vendor-reports-history'] });
    } catch (error) {
      toast({ title: 'Delete Failed', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
      setDeleteConfirmId(null);
    }
  };

  const handleDeleteAiMeasurement = async (measurementId: string) => {
    setIsDeleting(true);
    try {
      await supabase.from('roof_measurements').delete().eq('id', measurementId);
      toast({ title: 'Measurement Deleted', description: 'Removed from history' });
      queryClient.invalidateQueries({ queryKey: ['ai-measurements'] });
    } catch (error) {
      toast({ title: 'Delete Failed', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
      setDeleteConfirmId(null);
    }
  };

  const allSelected = selectedIds.size === totalHistoryCount && totalHistoryCount > 0;

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
        {/* Bulk Actions Toolbar */}
        <div className="flex items-center justify-between gap-2 pb-2 border-b">
          <Button
            size="sm"
            variant={selectMode ? "secondary" : "ghost"}
            onClick={handleToggleSelectMode}
            className="text-xs"
          >
            {selectMode ? 'Cancel' : 'Select Multiple'}
          </Button>
          
          {selectMode && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={allSelected ? handleDeselectAll : handleSelectAll}
                className="text-xs"
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </Button>
              {selectedIds.size > 0 && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setBulkDeleteDialogOpen(true)}
                  className="text-xs"
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Delete ({selectedIds.size})
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Vendor Reports */}
        {vendorReports.map((report) => {
          const sqft = report.parsed?.total_area_sqft || 0;
          const isLinked = report.linkedToLead;
          const hasValidData = sqft >= 500; // Minimum reasonable roof size
          const isSelected = selectedIds.has(report.id);
          
          return (
            <div 
              key={report.id}
              className={`flex items-center justify-between p-3 border rounded-lg ${
                isLinked ? 'bg-primary/5 border-primary/20' : 'bg-muted/30'
              } ${isSelected ? 'ring-2 ring-primary' : ''}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                {selectMode && (
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleSelection(report.id)}
                    className="shrink-0"
                  />
                )}
                <div className="flex flex-col gap-1">
                  <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 shrink-0">
                    <FileText className="h-3 w-3 mr-1" />
                    {report.provider || 'Report'}
                  </Badge>
                  {isLinked && (
                    <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                      This Lead
                    </Badge>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {hasValidData ? `${sqft.toLocaleString()} sqft` : 'No valid data'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(report.created_at), 'MMM d, yyyy')}
                  </p>
                  {report.address && (
                    <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                      {report.address}
                    </p>
                  )}
                </div>
              </div>
              {!selectMode && (
                <div className="flex gap-1 shrink-0">
                  <Button 
                    size="sm" 
                    variant={hasValidData ? "outline" : "ghost"}
                    onClick={() => handleSaveVendorReport(report)}
                    disabled={isSaving === report.id || !hasValidData}
                    title={!hasValidData ? "Report has no valid measurement data" : "Save to this lead"}
                  >
                    {isSaving === report.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : hasValidData ? (
                      <>
                        <ArrowRight className="h-4 w-4 mr-1" />
                        Save
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Invalid</span>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDeleteConfirmId(report.id);
                      setDeleteType('vendor');
                    }}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    title="Delete from history"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}

        {/* AI Measurements */}
        {aiMeasurements.map((measurement) => {
          const sqft = measurement.total_area_adjusted_sqft || 0;
          const isManualEntry = measurement.footprint_source === 'manual_entry' || measurement.detection_method === 'manual_entry';
          const isSelected = selectedIds.has(measurement.id);
          
          return (
            <div 
              key={measurement.id}
              className={`flex items-center justify-between p-3 border rounded-lg bg-muted/30 ${
                isSelected ? 'ring-2 ring-primary' : ''
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                {selectMode && (
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleSelection(measurement.id)}
                    className="shrink-0"
                  />
                )}
                {isManualEntry ? (
                  <Badge variant="outline" className="bg-muted text-muted-foreground border-muted-foreground/30 shrink-0">
                    <Pencil className="h-3 w-3 mr-1" />
                    Manual Entry
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-info/10 text-info border-info/30 shrink-0">
                    <Sparkles className="h-3 w-3 mr-1" />
                    AI-Pulled
                  </Badge>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {sqft.toLocaleString()} sqft
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(measurement.created_at), 'MMM d, yyyy')}
                  </p>
                </div>
              </div>
              {!selectMode && (
                <div className="flex gap-1 shrink-0">
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={() => handleSaveAiMeasurement(measurement)}
                    disabled={isSaving === measurement.id}
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
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDeleteConfirmId(measurement.id);
                      setDeleteType('ai');
                    }}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    title="Delete from history"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </CollapsibleContent>

      {/* Single Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmId !== null} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete from History?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this {deleteType === 'vendor' ? 'imported report' : 'AI measurement'} from history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                if (deleteConfirmId) {
                  if (deleteType === 'vendor') {
                    handleDeleteVendorReport(deleteConfirmId);
                  } else {
                    handleDeleteAiMeasurement(deleteConfirmId);
                  }
                }
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} Measurements?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected measurements from history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isBulkDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                `Delete ${selectedIds.size} Items`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Collapsible>
  );
}

