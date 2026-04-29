import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SegmentHoverProvider } from '@/contexts/SegmentHoverContext';
import { useMeasurementJob } from '@/hooks/useMeasurementJob';
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
import { BlueprintUploadButton } from './BlueprintUploadButton';

import { ManualMeasurementButton } from '@/components/estimates/ManualMeasurementButton';
import { ManualMeasurementDialog, type MeasurementFormData } from '@/components/estimates/ManualMeasurementDialog';
import { SchematicRoofDiagram } from '@/components/measurements/SchematicRoofDiagram';
// RoofDiagramViewer intentionally not rendered inline — diagrams only show in the View Report dialog
import MeasurementReportDialog from '@/components/measurements/MeasurementReportDialog';

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
  measurement_id?: string | null;
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

const MAX_AUTO_ROOF_AREA_SQFT = 30000;

const isPlausibleRoofSqft = (value: unknown): boolean => {
  const sqft = Number(value || 0);
  return sqft > 0 && sqft <= MAX_AUTO_ROOF_AREA_SQFT;
};

const isPlausibleSavedMeasurement = (measurement: SavedMeasurement): boolean => {
  const tags = measurement.saved_tags || {};
  return isPlausibleRoofSqft(tags['roof.total_sqft'] || tags['roof.plan_area']);
};

const isPlausibleRoofMeasurement = (measurement: any): boolean => (
  isPlausibleRoofSqft(measurement?.total_area_adjusted_sqft || measurement?.total_area_flat_sqft)
);

// Stricter than isPlausibleRoofMeasurement: also rejects rows the backend
// flagged for internal review, placeholder geometry, and Solar bbox-only
// rectangles. Used to keep failed-QA rows out of customer-facing flows.
const hasCustomerSafeGeometry = (measurement: any): boolean => {
  if (!isPlausibleRoofMeasurement(measurement)) return false;
  const status = String(measurement?.validation_status || '').toLowerCase();
  if (status === 'needs_internal_review') return false;
  const grj = measurement?.geometry_report_json || {};
  if (grj?.is_placeholder === true) return false;
  if (grj?.geometry_source === 'google_solar_bbox') return false;
  const footprintSource = String(measurement?.footprint_source || '').toLowerCase();
  if (footprintSource === 'google_solar_bbox') return false;
  return true;
};

const getFallbackSatelliteTileUrl = (measurement: any): string | undefined => {
  const lat = measurement?.target_lat ?? measurement?.center_lat ?? measurement?.gps_coordinates?.lat;
  const lng = measurement?.target_lng ?? measurement?.center_lng ?? measurement?.gps_coordinates?.lng;
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return undefined;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://alxelfrbjzkmtnsulcei.supabase.co';
  const zoom = measurement?.analysis_zoom || 20;
  return `${supabaseUrl}/functions/v1/satellite-tile?lat=${lat}&lng=${lng}&zoom=${zoom}&size=640`;
};

const getMeasurementSatelliteUrl = (measurement: any): string | undefined => {
  const selectedSource = (measurement?.selected_image_source || measurement?.image_source || '').toLowerCase();
  if (selectedSource.includes('mapbox') && measurement?.mapbox_image_url) return measurement.mapbox_image_url;
  if (selectedSource.includes('google') && measurement?.google_maps_image_url) return measurement.google_maps_image_url;
  return measurement?.satellite_overlay_url || measurement?.google_maps_image_url || measurement?.mapbox_image_url || getFallbackSatelliteTileUrl(measurement);
};

const buildReportTagsFromRoofMeasurement = (measurement: any): Record<string, any> => ({
  'roof.plan_area': measurement?.total_area_flat_sqft || measurement?.total_area_adjusted_sqft || 0,
  'roof.total_sqft': measurement?.total_area_adjusted_sqft || 0,
  'roof.squares': measurement?.total_squares || 0,
  'roof.predominant_pitch': measurement?.predominant_pitch || '—',
  'roof.faces_count': measurement?.facet_count || 0,
  'lf.ridge': measurement?.total_ridge_length || 0,
  'lf.hip': measurement?.total_hip_length || 0,
  'lf.valley': measurement?.total_valley_length || 0,
  'lf.eave': measurement?.total_eave_length || 0,
  'lf.rake': measurement?.total_rake_length || 0,
});

const buildReportMeasurementFromRoofMeasurement = (measurement: any, pipelineEntryId: string) => {
  const linearFeatures = Array.isArray(measurement?.linear_features_wkt) && measurement.linear_features_wkt.length > 0
    ? measurement.linear_features_wkt
    : (Array.isArray(measurement?.ai_detection_data?.linear_features) ? measurement.ai_detection_data.linear_features : []);
  const faces = Array.isArray(measurement?.faces_wkt) && measurement.faces_wkt.length > 0
    ? measurement.faces_wkt
    : (Array.isArray(measurement?.ai_detection_data?.faces) ? measurement.ai_detection_data.faces : []);
  const satelliteUrl = getMeasurementSatelliteUrl(measurement);

  return {
    id: measurement?.id,
    ai_measurement_job_id: measurement?.ai_measurement_job_id || null,
    validation_status: measurement?.validation_status || null,
    geometry_report_json: measurement?.geometry_report_json || null,
    report_pdf_url: measurement?.report_pdf_url || null,
    report_pdf_path: measurement?.report_pdf_path || null,
    property_id: pipelineEntryId,
    summary: {
      total_area_sqft: measurement?.total_area_adjusted_sqft || 0,
      total_squares: measurement?.total_squares || 0,
      waste_pct: measurement?.waste_factor_percent || measurement?.waste_factor_pct || 10,
      ridge_ft: measurement?.total_ridge_length || 0,
      hip_ft: measurement?.total_hip_length || 0,
      valley_ft: measurement?.total_valley_length || 0,
      eave_ft: measurement?.total_eave_length || 0,
      rake_ft: measurement?.total_rake_length || 0,
      perimeter_ft: (measurement?.total_eave_length || 0) + (measurement?.total_rake_length || 0),
    },
    linear_features: linearFeatures,
    faces,
    perimeter_wkt: measurement?.perimeter_wkt || measurement?.ai_detection_data?.perimeter_wkt,
    center_lat: measurement?.target_lat,
    center_lng: measurement?.target_lng,
    gps_coordinates: measurement?.gps_coordinates || { lat: measurement?.target_lat, lng: measurement?.target_lng },
    analysis_zoom: measurement?.analysis_zoom || 20,
    analysis_image_size: measurement?.analysis_image_size || { width: 640, height: 640 },
    image_bounds: measurement?.image_bounds,
    google_maps_image_url: measurement?.google_maps_image_url,
    satellite_overlay_url: satelliteUrl,
    mapbox_image_url: measurement?.mapbox_image_url,
    selected_image_source: measurement?.selected_image_source,
    image_source: measurement?.image_source,
    footprint_vertices_geo: measurement?.footprint_vertices_geo,
    footprint_source: measurement?.footprint_source,
    footprint_confidence: measurement?.footprint_confidence,
    detection_method: measurement?.detection_method,
    solar_building_footprint_sqft: measurement?.solar_building_footprint_sqft,
    measurement_confidence: measurement?.measurement_confidence,
    requires_manual_review: measurement?.requires_manual_review || false,
    facet_count: measurement?.facet_count || 0,
    overlay_schema: measurement?.overlay_schema || null,
    ai_detection_data: measurement?.ai_detection_data || null,
  };
};

const getApprovalMeasurementId = (measurement: SavedMeasurement): string | null => {
  return measurement.measurement_id || (measurement.saved_tags as any)?.measurement_id || null;
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
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingApproval, setEditingApproval] = useState<SavedMeasurement | null>(null);
  const [reportState, setReportState] = useState<{
    open: boolean;
    measurement: any | null;
    tags: Record<string, any>;
  }>({ open: false, measurement: null, tags: {} });

  // Track async measurement jobs
  const { job: activeJob, isActive: jobIsActive } = useMeasurementJob(pipelineEntryId);

  // Build initialValues from saved_tags for edit mode
  const getInitialValuesFromTags = (tags: Record<string, any>): MeasurementFormData => {
    return {
      areaType: 'pitch_adjusted',
      area: tags['roof.total_sqft'] || tags['roof.plan_area'] || 0,
      pitch: tags['roof.predominant_pitch'] || '6/12',
      flatSectionArea: tags['flat_section_sqft'] || 0,
      ridges: tags['lf.ridge'] || 0,
      hips: tags['lf.hip'] || 0,
      valleys: tags['lf.valley'] || 0,
      eaves: tags['lf.eave'] || 0,
      rakes: tags['lf.rake'] || 0,
      stepFlashing: tags['lf.step'] || 0,
      wallFlashing: tags['lf.wall'] || 0,
      facets: tags['roof.faces_count'] || 1,
      wastePercentage: 10,
    };
  };

  const handleEditMeasurement = (measurement: SavedMeasurement) => {
    setEditingApproval(measurement);
    setEditDialogOpen(true);
  };

  const handleEditSuccess = async () => {
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['measurement-context', pipelineEntryId] });
    queryClient.invalidateQueries({ queryKey: ['active-measurement', pipelineEntryId] });
    onMeasurementChange?.();
    setEditDialogOpen(false);
    setEditingApproval(null);
  };

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
        .select('id, approved_at, measurement_id, saved_tags, approval_notes, report_generated, report_document_id')
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('approved_at', { ascending: false });

      if (error) throw error;
      return ((data as SavedMeasurement[]) || []).filter(isPlausibleSavedMeasurement);
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
      // Include both AI-pulled and manual measurements so users see full history
      const { data, error } = await supabase
        .from('roof_measurements')
        .select('id, created_at, customer_id, ai_measurement_job_id, validation_status, geometry_report_json, report_pdf_url, report_pdf_path, total_area_flat_sqft, total_area_adjusted_sqft, total_squares, predominant_pitch, facet_count, total_ridge_length, total_hip_length, total_valley_length, total_eave_length, total_rake_length, footprint_source, detection_method, google_maps_image_url, linear_features_wkt, perimeter_wkt, target_lat, target_lng, footprint_vertices_geo, footprint_confidence, satellite_overlay_url, gps_coordinates, analysis_zoom, analysis_image_size, image_bounds, bounding_box, mapbox_image_url, selected_image_source, image_source, measurement_confidence, requires_manual_review, overlay_schema, solar_building_footprint_sqft, ai_detection_data')
        .eq('customer_id', pipelineEntryId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching AI measurements:', error);
        return [];
      }
      return (data || []).filter(hasCustomerSafeGeometry);
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

  const handleViewSavedReport = useCallback(async (approval: SavedMeasurement) => {
    try {
      const linkedMeasurementId = getApprovalMeasurementId(approval);
      const approvalTags = approval.saved_tags || {};

      if (!linkedMeasurementId) {
        setReportState({
          open: true,
          measurement: buildReportMeasurementFromRoofMeasurement({
            id: approval.id,
            total_area_adjusted_sqft: approvalTags['roof.total_sqft'] || approvalTags['roof.plan_area'] || 0,
            total_area_flat_sqft: approvalTags['roof.plan_area'] || 0,
            total_squares: approvalTags['roof.squares'] || 0,
            predominant_pitch: approvalTags['roof.predominant_pitch'],
            facet_count: approvalTags['roof.faces_count'],
            total_ridge_length: approvalTags['lf.ridge'] || 0,
            total_hip_length: approvalTags['lf.hip'] || 0,
            total_valley_length: approvalTags['lf.valley'] || 0,
            total_eave_length: approvalTags['lf.eave'] || 0,
            total_rake_length: approvalTags['lf.rake'] || 0,
            target_lat: latitude,
            target_lng: longitude,
            gps_coordinates: { lat: latitude, lng: longitude },
            footprint_source: approvalTags.source,
          }, pipelineEntryId),
          tags: approvalTags,
        });
        return;
      }

      const { data, error } = await supabase
        .from('roof_measurements')
        .select('id, created_at, customer_id, ai_measurement_job_id, validation_status, geometry_report_json, report_pdf_url, report_pdf_path, total_area_flat_sqft, total_area_adjusted_sqft, total_squares, predominant_pitch, facet_count, total_ridge_length, total_hip_length, total_valley_length, total_eave_length, total_rake_length, footprint_source, detection_method, google_maps_image_url, linear_features_wkt, perimeter_wkt, target_lat, target_lng, footprint_vertices_geo, footprint_confidence, satellite_overlay_url, gps_coordinates, analysis_zoom, analysis_image_size, image_bounds, bounding_box, mapbox_image_url, selected_image_source, image_source, measurement_confidence, requires_manual_review, overlay_schema, solar_building_footprint_sqft, ai_detection_data, waste_factor_percent')
        .eq('id', linkedMeasurementId)
        .maybeSingle();

      if (error) throw error;

      const sourceMeasurement = data || {
        id: linkedMeasurementId,
        total_area_adjusted_sqft: approvalTags['roof.total_sqft'] || approvalTags['roof.plan_area'] || 0,
        total_area_flat_sqft: approvalTags['roof.plan_area'] || 0,
        total_squares: approvalTags['roof.squares'] || 0,
        predominant_pitch: approvalTags['roof.predominant_pitch'],
        facet_count: approvalTags['roof.faces_count'],
        total_ridge_length: approvalTags['lf.ridge'] || 0,
        total_hip_length: approvalTags['lf.hip'] || 0,
        total_valley_length: approvalTags['lf.valley'] || 0,
        total_eave_length: approvalTags['lf.eave'] || 0,
        total_rake_length: approvalTags['lf.rake'] || 0,
        target_lat: latitude,
        target_lng: longitude,
        gps_coordinates: { lat: latitude, lng: longitude },
        footprint_source: approvalTags.source,
      };

      setReportState({
        open: true,
        measurement: buildReportMeasurementFromRoofMeasurement(sourceMeasurement, pipelineEntryId),
        tags: { ...buildReportTagsFromRoofMeasurement(sourceMeasurement), ...approvalTags },
      });
    } catch (error: any) {
      console.error('Error opening measurement report:', error);
      toast({
        title: 'Report Unavailable',
        description: error.message || 'Could not load the aerial trace report for this measurement',
        variant: 'destructive',
      });
    }
  }, [latitude, longitude, pipelineEntryId]);

  const handleViewAiHistoryReport = useCallback((measurement: any) => {
    setReportState({
      open: true,
      measurement: buildReportMeasurementFromRoofMeasurement(measurement, pipelineEntryId),
      tags: buildReportTagsFromRoofMeasurement(measurement),
    });
  }, [pipelineEntryId]);

  // Quick save an AI measurement directly from the banner
  const [isSavingDirect, setIsSavingDirect] = useState(false);
  const [showAiReport, setShowAiReport] = useState(false);
  const handleSaveAiMeasurementDirect = async (measurement: any) => {
    if (!hasCustomerSafeGeometry(measurement)) {
      toast({
        title: 'Measurement not saved',
        description: 'This AI measurement did not pass QA and cannot be saved to estimates.',
        variant: 'destructive',
      });
      return;
    }
    setIsSavingDirect(true);
    try {
      const { data: entry } = await supabase
        .from('pipeline_entries')
        .select('tenant_id')
        .eq('id', pipelineEntryId)
        .single();

      if (!entry?.tenant_id) throw new Error('No tenant found');

      const totalSquares = measurement.total_squares || (measurement.total_area_adjusted_sqft ? measurement.total_area_adjusted_sqft / 100 : 0);
      const eaveLength = measurement.total_eave_length || 0;
      const rakeLength = measurement.total_rake_length || 0;

      const savedTags = {
        'roof.plan_area': measurement.total_area_flat_sqft || measurement.total_area_adjusted_sqft || 0,
        'roof.total_sqft': measurement.total_area_adjusted_sqft || 0,
        'roof.squares': totalSquares,
        'roof.predominant_pitch': measurement.predominant_pitch || '6/12',
        'roof.faces_count': measurement.facet_count || 0,
        'lf.ridge': measurement.total_ridge_length || 0,
        'lf.hip': measurement.total_hip_length || 0,
        'lf.valley': measurement.total_valley_length || 0,
        'lf.eave': eaveLength,
        'lf.rake': rakeLength,
        'lf.perimeter': eaveLength + rakeLength,
        'source': 'ai_pulled',
        'measurement_id': measurement.id,
        'imported_at': measurement.created_at,
      };

      await supabase.from('measurement_approvals').insert({
        tenant_id: entry.tenant_id,
        pipeline_entry_id: pipelineEntryId,
        measurement_id: measurement.id,
        approved_at: new Date().toISOString(),
        saved_tags: savedTags,
        approval_notes: `AI measurement - ${measurement.total_area_adjusted_sqft?.toLocaleString() || 0} sqft`,
      });

      toast({ title: 'Measurement Saved', description: 'AI measurement added to saved list' });
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['measurement-context', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['ai-measurements', pipelineEntryId] });
      onMeasurementChange?.();
    } catch (error: any) {
      toast({ title: 'Save Failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsSavingDirect(false);
    }
  };

  // Separate active from other measurements
  // Default to most recently approved measurement when none is explicitly selected,
  // so we always show the one being used for estimates rather than 2 cards.
  const activeMeasurement = approvals?.find(a => a.id === activeApprovalId) || approvals?.[0];
  const otherMeasurements = approvals?.filter(a => a.id !== (activeMeasurement?.id || activeApprovalId)) || [];
  const hasAnyMeasurements = approvals && approvals.length > 0;

  // Find the latest AI measurement that hasn't been saved as an approval yet.
  // Suppress the "Latest AI Measurement" card whenever a saved measurement already
  // exists for this lead — the user has already chosen what to use for estimates,
  // so showing a duplicate raw AI row just creates noise (and is often the same
  // run that was already saved, or an earlier inaccurate attempt).
  const latestUnapprovedAI = useMemo(() => {
    if (!aiMeasurements?.length) return null;
    if (approvals && approvals.length > 0) return null;
    const latest = aiMeasurements[0];
    if (latest?.total_area_adjusted_sqft && latest.total_area_adjusted_sqft > 0) {
      return latest;
    }
    return null;
  }, [aiMeasurements, approvals]);

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
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-1.5 text-base">
                <Ruler className="h-4 w-4" />
                Saved Measurements
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Select which measurement to use for estimates
              </p>
            </div>
            <div className="flex items-center gap-2">
              {hasAnyMeasurements && (
                <Badge variant="secondary" className="text-xs">
                  {approvals!.length} saved
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3 px-4 pb-4">
          {/* Active Measurement - Highlighted */}
          {activeMeasurement && (
            <MeasurementCard
              measurement={activeMeasurement}
              isActive={true}
              isPhone={layout.isPhone}
              onSetActive={() => {}}
              onDelete={() => handleDeleteClick(activeMeasurement.id)}
              onEdit={() => handleEditMeasurement(activeMeasurement)}
              onViewReport={() => handleViewSavedReport(activeMeasurement)}
              isSettingActive={false}
            />
          )}

          {/* Job Progress Banner */}
          {jobIsActive && activeJob && (
            <div className="flex items-center gap-3 p-4 rounded-lg border border-primary/30 bg-primary/5 animate-pulse">
              <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-sm">AI Measurement in Progress</p>
                <p className="text-xs text-muted-foreground truncate">
                  {activeJob.progress_message || 'Processing...'}
                </p>
              </div>
            </div>
          )}

          {/* Latest Unapproved AI Result — prominent card with roof diagram */}
          {!jobIsActive && latestUnapprovedAI && (() => {
            const ai = latestUnapprovedAI as any;
            const diagramTags: Record<string, any> = {
              'linear.ridge_ft': ai.total_ridge_length || 0,
              'linear.hip_ft': ai.total_hip_length || 0,
              'linear.valley_ft': ai.total_valley_length || 0,
              'linear.eave_ft': ai.total_eave_length || 0,
              'linear.rake_ft': ai.total_rake_length || 0,
            };
            // Prefer the image source matching what was used for analysis
            const satUrl = (() => {
              const src = (ai.selected_image_source || ai.image_source || '').toLowerCase();
              if (src.includes('mapbox') && ai.mapbox_image_url) return ai.mapbox_image_url;
              if (src.includes('google') && ai.google_maps_image_url) return ai.google_maps_image_url;
              return ai.satellite_overlay_url || ai.google_maps_image_url || ai.mapbox_image_url || getFallbackSatelliteTileUrl(ai);
            })();
            const diagramMeasurement = {
              id: ai.id,
              created_at: ai.created_at,
              report_pdf_url: (ai as any).report_pdf_url,
              report_pdf_path: (ai as any).report_pdf_path,
              target_lat: ai.target_lat,
              target_lng: ai.target_lng,
              gps_coordinates: ai.gps_coordinates || { lat: ai.target_lat, lng: ai.target_lng },
              analysis_zoom: ai.analysis_zoom || 20,
              analysis_image_size: ai.analysis_image_size || { width: 640, height: 640 },
              image_bounds: ai.image_bounds,
              linear_features_wkt: ai.linear_features_wkt,
              perimeter_wkt: ai.perimeter_wkt,
              footprint_vertices_geo: ai.footprint_vertices_geo,
              footprint_confidence: ai.footprint_confidence,
              footprint_source: ai.footprint_source,
              detection_method: ai.detection_method,
              total_adjusted_area: ai.total_area_adjusted_sqft || 0,
              measurement_confidence: ai.measurement_confidence,
              requires_manual_review: ai.requires_manual_review,
              selected_image_source: ai.selected_image_source,
              image_source: ai.image_source,
              google_maps_image_url: ai.google_maps_image_url,
              satellite_overlay_url: satUrl,
              mapbox_image_url: ai.mapbox_image_url,
              geometry_report_json: (ai as any).geometry_report_json,
              overlay_schema: (ai as any).overlay_schema || (ai as any).geometry_report_json?.overlay_schema,
              validation_status: (ai as any).validation_status,
              facet_count: (ai as any).facet_count,
              solar_building_footprint_sqft: ai.solar_building_footprint_sqft,
            };
            const hasGeometry = ai.linear_features_wkt && (Array.isArray(ai.linear_features_wkt) ? ai.linear_features_wkt.length > 0 : true);

            return (
              <div className="p-3 rounded-lg border-2 border-primary/40 bg-primary/5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-sm">Latest AI Measurement</span>
                    <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                      Unsaved
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(ai.created_at), 'MMM d, yyyy')}
                  </span>
                </div>

                {/* Diagram intentionally hidden — open via "View Report" */}

                {/* Key Stats */}
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs">Squares</span>
                    <p className="font-semibold">{formatValue(ai.total_squares)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Sq Ft</span>
                    <p className="font-semibold">{formatValue(ai.total_area_adjusted_sqft)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Pitch</span>
                    <p className="font-semibold">{ai.predominant_pitch || '—'}</p>
                  </div>
                </div>

                {/* Linear Measurements Grid */}
                <div className="grid grid-cols-5 gap-2 text-xs border-t border-border pt-2">
                  <div className="text-center">
                    <span className="block font-medium" style={{ color: '#90EE90' }}>Ridge</span>
                    <span className="text-foreground">{formatValue(ai.total_ridge_length)} ft</span>
                  </div>
                  <div className="text-center">
                    <span className="block font-medium" style={{ color: '#9B59B6' }}>Hip</span>
                    <span className="text-foreground">{formatValue(ai.total_hip_length)} ft</span>
                  </div>
                  <div className="text-center">
                    <span className="block font-medium" style={{ color: '#DC3545' }}>Valley</span>
                    <span className="text-foreground">{formatValue(ai.total_valley_length)} ft</span>
                  </div>
                  <div className="text-center">
                    <span className="block font-medium" style={{ color: '#006400' }}>Eave</span>
                    <span className="text-foreground">{formatValue(ai.total_eave_length)} ft</span>
                  </div>
                  <div className="text-center">
                    <span className="block font-medium" style={{ color: '#17A2B8' }}>Rake</span>
                    <span className="text-foreground">{formatValue(ai.total_rake_length)} ft</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    variant="outline"
                    className="flex-1"
                    onClick={() => setShowAiReport(true)}
                  >
                    <Eye className="h-4 w-4 mr-1.5" />
                    View Report
                  </Button>
                  <Button 
                    size="sm" 
                    className="flex-1"
                    onClick={() => handleSaveAiMeasurementDirect(latestUnapprovedAI)}
                    disabled={isSavingDirect}
                  >
                    {isSavingDirect ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <ArrowRight className="h-4 w-4 mr-1.5" />
                    )}
                    Save to Estimates
                  </Button>
                </div>

                <MeasurementReportDialog
                  open={showAiReport}
                  onOpenChange={setShowAiReport}
                  aiMeasurementJobId={(ai as any).ai_measurement_job_id || null}
                  measurement={{
                    id: ai.id,
                    property_id: pipelineEntryId,
                    ai_measurement_job_id: (ai as any).ai_measurement_job_id,
                    validation_status: (ai as any).validation_status,
                    requires_manual_review: (ai as any).requires_manual_review,
                    facet_count: (ai as any).facet_count,
                    geometry_report_json: (ai as any).geometry_report_json,
                    summary: {
                      total_area_sqft: ai.total_area_adjusted_sqft || 0,
                      total_squares: ai.total_squares || 0,
                      waste_pct: ai.waste_factor_pct || 10,
                      ridge_ft: ai.total_ridge_length || 0,
                      hip_ft: ai.total_hip_length || 0,
                      valley_ft: ai.total_valley_length || 0,
                      eave_ft: ai.total_eave_length || 0,
                      rake_ft: ai.total_rake_length || 0,
                    },
                    linear_features: (Array.isArray(ai.linear_features_wkt) && ai.linear_features_wkt.length > 0
                      ? ai.linear_features_wkt
                      : (ai.ai_detection_data?.linear_features || [])),
                    faces: (Array.isArray((ai as any).faces_wkt) && (ai as any).faces_wkt.length > 0
                      ? (ai as any).faces_wkt
                      : (ai.ai_detection_data?.faces || [])),
                    perimeter_wkt: ai.perimeter_wkt || ai.ai_detection_data?.perimeter_wkt,
                    center_lat: ai.target_lat,
                    center_lng: ai.target_lng,
                    gps_coordinates: ai.gps_coordinates || { lat: ai.target_lat, lng: ai.target_lng },
                    analysis_zoom: ai.analysis_zoom || 20,
                    analysis_image_size: ai.analysis_image_size || { width: 640, height: 640 },
                    image_bounds: ai.image_bounds,
                    google_maps_image_url: ai.google_maps_image_url,
                    satellite_overlay_url: satUrl,
                    mapbox_image_url: ai.mapbox_image_url,
                    selected_image_source: ai.selected_image_source,
                    image_source: ai.image_source,
                    overlay_schema: (ai as any).overlay_schema || (ai as any).geometry_report_json?.overlay_schema,
                    footprint_vertices_geo: ai.footprint_vertices_geo,
                    footprint_source: ai.footprint_source,
                    footprint_confidence: ai.footprint_confidence,
                    detection_method: ai.detection_method,
                    solar_building_footprint_sqft: ai.solar_building_footprint_sqft,
                    measurement_confidence: ai.measurement_confidence,
                  }}
                  tags={diagramTags}
                  address={address}
                  pipelineEntryId={pipelineEntryId}
                />
              </div>
            );
          })()}

          {/* Other Measurements - hidden: only show the active measurement being used for estimates */}
          {false && otherMeasurements.length > 0 && (
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
                      onEdit={() => handleEditMeasurement(measurement)}
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
            onViewAiReport={handleViewAiHistoryReport}
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
                <BlueprintUploadButton
                  pipelineEntryId={pipelineEntryId}
                  address={address}
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

      {/* Edit Measurement Dialog */}
      {editingApproval && (
        <ManualMeasurementDialog
          open={editDialogOpen}
          onOpenChange={(open) => {
            setEditDialogOpen(open);
            if (!open) setEditingApproval(null);
          }}
          pipelineEntryId={pipelineEntryId}
          onSuccess={handleEditSuccess}
          editMode={true}
          approvalId={editingApproval.id}
          initialValues={getInitialValuesFromTags(editingApproval.saved_tags)}
        />
      )}

      {reportState.measurement && (
        <MeasurementReportDialog
          open={reportState.open}
          onOpenChange={(open) => setReportState((current) => ({ ...current, open }))}
          measurement={reportState.measurement}
          tags={reportState.tags}
          address={address}
          pipelineEntryId={pipelineEntryId}
        />
      )}
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
  onEdit?: () => void;
  onViewReport?: () => void;
  isSettingActive: boolean;
}

function MeasurementCard({ 
  measurement, 
  isActive, 
  isPhone,
  onSetActive, 
  onDelete,
  onEdit,
  onViewReport,
  isSettingActive 
}: MeasurementCardProps) {
  const tags = measurement.saved_tags || {};
  const isManual = (tags.source || '').toLowerCase().includes('manual');
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
        {isManual && onEdit && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onEdit}
            style={{ minHeight: isPhone ? 44 : 32 }}
            className="text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )}
        {onViewReport && (
          <Button
            size="sm"
            variant="outline"
            onClick={onViewReport}
            style={{ minHeight: isPhone ? 44 : 32 }}
            className="flex-1"
          >
            <Eye className="h-4 w-4 mr-1.5" />
            View Report
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
    total_area_flat_sqft: number | null;
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
  onViewAiReport: (measurement: any) => void;
  isPhone: boolean;
}

function MeasurementHistorySection({
  vendorReports,
  aiMeasurements,
  pipelineEntryId,
  onSaveToApprovals,
  onViewAiReport,
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
  const aiMeasurementsQueryKey = ['ai-measurements', pipelineEntryId] as const;

  const totalHistoryCount = (vendorReports?.length || 0) + (aiMeasurements?.length || 0);

  const removeAiMeasurementsFromCache = (measurementIds: string[]) => {
    if (measurementIds.length === 0) return;

    queryClient.setQueryData(aiMeasurementsQueryKey, (current: MeasurementHistorySectionProps['aiMeasurements'] | undefined) =>
      (current || []).filter((measurement) => !measurementIds.includes(measurement.id))
    );
  };

  const deleteAiMeasurementsViaEdge = async (measurementIds: string[]) => {
    if (measurementIds.length === 0) {
      return {
        deletedMeasurementIds: [] as string[],
        linkedApprovalIds: [] as string[],
      };
    }

    const { data, error } = await supabase.functions.invoke('delete-ai-measurements', {
      body: {
        pipelineEntryId,
        measurementIds,
      },
    });

    if (error) throw error;
    if (!data?.success) {
      throw new Error(data?.error || 'Measurement could not be removed from history');
    }

    return {
      deletedMeasurementIds: Array.isArray(data.deletedMeasurementIds) ? data.deletedMeasurementIds as string[] : [],
      linkedApprovalIds: Array.isArray(data.linkedApprovalIds) ? data.linkedApprovalIds as string[] : [],
    };
  };

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

      const aiRowsToDelete = aiMeasurements.filter((measurement) => aiIds.includes(measurement.id));

      let linkedApprovalIds: string[] = [];
      if (aiIds.length > 0) {
        const deleteResult = await deleteAiMeasurementsViaEdge(aiIds);
        linkedApprovalIds = deleteResult.linkedApprovalIds;

        if (deleteResult.deletedMeasurementIds.length !== aiIds.length) {
          throw new Error('Some AI measurements could not be deleted');
        }

        removeAiMeasurementsFromCache(deleteResult.deletedMeasurementIds);
      }

      if (vendorIds.length > 0) {
        const { data: deletedVendorRows, error: vendorDeleteError } = await supabase
          .from('roof_vendor_reports')
          .delete()
          .in('id', vendorIds)
          .select('id');

        if (vendorDeleteError) throw vendorDeleteError;
        if ((deletedVendorRows || []).length !== vendorIds.length) {
          throw new Error('Some imported reports could not be deleted');
        }
      }

      toast({
        title: 'Deleted Successfully',
        description: linkedApprovalIds.length > 0
          ? `Removed ${selectedArray.length} measurement(s) from history and preserved linked saved entries`
          : `Removed ${selectedArray.length} measurement(s) from history`,
      });

      // Reset state and invalidate queries
      setSelectedIds(new Set());
      setSelectMode(false);
      setBulkDeleteDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ['measurement-approvals', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['measurement-context', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['active-measurement', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['vendor-reports-history', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: aiMeasurementsQueryKey });
    } catch (error) {
      console.error('Bulk delete error:', error);
      toast({
        title: 'Delete Failed',
        description: error instanceof Error ? error.message : 'Some measurements could not be deleted',
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
    if (!hasCustomerSafeGeometry(measurement)) {
      toast({
        title: 'Measurement not saved',
        description: 'This AI measurement did not pass QA and cannot be saved to estimates.',
        variant: 'destructive',
      });
      return;
    }
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
        'roof.plan_area': (measurement as any).total_area_flat_sqft || measurement.total_area_adjusted_sqft || 0,
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
        'measurement_id': measurement.id,
        'imported_at': measurement.created_at,
      };

      await supabase.from('measurement_approvals').insert({
        tenant_id: entry.tenant_id,
        pipeline_entry_id: pipelineEntryId,
        measurement_id: measurement.id,
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
      const { data: deletedRows, error } = await supabase
        .from('roof_vendor_reports')
        .delete()
        .eq('id', reportId)
        .select('id');

      if (error) throw error;
      if (!(deletedRows || []).length) {
        throw new Error('Report could not be removed from history');
      }

      toast({ title: 'Report Deleted', description: 'Removed from history' });
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(reportId);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['vendor-reports-history', pipelineEntryId] });
    } catch (error) {
      console.error('Vendor report delete error:', error);
      toast({
        title: 'Delete Failed',
        description: error instanceof Error ? error.message : 'Report could not be deleted',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
      setDeleteConfirmId(null);
    }
  };

  const handleDeleteAiMeasurement = async (measurementId: string) => {
    setIsDeleting(true);
    try {
      const deleteResult = await deleteAiMeasurementsViaEdge([measurementId]);
      if (!deleteResult.deletedMeasurementIds.length) {
        throw new Error('Measurement could not be removed from history');
      }

      removeAiMeasurementsFromCache(deleteResult.deletedMeasurementIds);
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(measurementId);
        return next;
      });

      toast({
        title: 'Measurement Deleted',
        description: deleteResult.linkedApprovalIds.length > 0
          ? 'Removed from history and preserved linked saved entries'
          : 'Removed from history',
      });
      queryClient.invalidateQueries({ queryKey: ['measurement-approvals', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['measurement-context', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['active-measurement', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: aiMeasurementsQueryKey });
    } catch (error) {
      console.error('AI measurement delete error:', error);
      toast({
        title: 'Delete Failed',
        description: error instanceof Error ? error.message : 'Measurement could not be deleted',
        variant: 'destructive',
      });
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
                    onClick={() => onViewAiReport(measurement)}
                    title="View aerial trace report"
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    View Report
                  </Button>
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

