// =====================================================
// Phase 71: Diagram Sync Context
// Real-time synchronization between measurements and diagrams
// =====================================================

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';

// Types
interface MeasurementData {
  id: string;
  total_area_adjusted_sqft: number | null;
  predominant_pitch: string | null;
  facet_count: number | null;
  total_ridge_length: number | null;
  total_hip_length: number | null;
  total_valley_length: number | null;
  total_eave_length: number | null;
  total_rake_length: number | null;
  updated_at: string;
  geometry_json: Record<string, unknown> | null;
  linear_features_wkt: string | null;
}

interface SegmentData {
  id: string;
  segment_id: string;
  edge_type: string;
  length_ft: number;
  start_point: { x: number; y: number };
  end_point: { x: number; y: number };
  label_position?: { x: number; y: number };
}

interface DiagramSyncState {
  measurementData: MeasurementData | null;
  segments: SegmentData[];
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncAt: Date | null;
  syncError: string | null;
  version: number;
}

interface DiagramSyncContextValue extends DiagramSyncState {
  refreshMeasurement: () => Promise<void>;
  updateSegment: (segmentId: string, updates: Partial<SegmentData>) => Promise<void>;
  subscribeToMeasurement: (measurementId: string) => () => void;
  setSelectedSegment: (segmentId: string | null) => void;
  selectedSegmentId: string | null;
}

const DiagramSyncContext = createContext<DiagramSyncContextValue | null>(null);

// Provider component
export function DiagramSyncProvider({ 
  children, 
  measurementId 
}: { 
  children: ReactNode; 
  measurementId: string | null;
}) {
  const queryClient = useQueryClient();
  
  const [state, setState] = useState<DiagramSyncState>({
    measurementData: null,
    segments: [],
    isLoading: true,
    isSyncing: false,
    lastSyncAt: null,
    syncError: null,
    version: 0,
  });
  
  const [selectedSegmentId, setSelectedSegment] = useState<string | null>(null);

  // Fetch measurement data
  const fetchMeasurement = useCallback(async () => {
    if (!measurementId) {
      setState(prev => ({ ...prev, isLoading: false, measurementData: null }));
      return;
    }

    setState(prev => ({ ...prev, isSyncing: true }));

    try {
      // Fetch main measurement with correct column names
      const { data: measurement, error: measurementError } = await supabase
        .from('roof_measurements')
        .select('id, total_area_adjusted_sqft, predominant_pitch, facet_count, total_ridge_length, total_hip_length, total_valley_length, total_eave_length, total_rake_length, updated_at, linear_features_wkt, ai_analysis')
        .eq('id', measurementId)
        .single();

      if (measurementError) throw measurementError;

      // Fetch segments/edges
      const { data: edges, error: edgesError } = await supabase
        .from('roof_measurement_edges')
        .select('id, edge_type, length_ft, wkt_geometry')
        .eq('measurement_id', measurementId);

      if (edgesError) throw edgesError;

      // Parse segments from edges
      const segments: SegmentData[] = (edges || []).map((edge, index) => ({
        id: edge.id,
        segment_id: `segment-${index}`,
        edge_type: edge.edge_type,
        length_ft: edge.length_ft || 0,
        start_point: { x: 0, y: 0 },
        end_point: { x: 0, y: 0 },
        label_position: undefined,
      }));

      // Map to our interface
      const measurementData: MeasurementData = {
        id: measurement.id,
        total_area_adjusted_sqft: measurement.total_area_adjusted_sqft,
        predominant_pitch: measurement.predominant_pitch,
        facet_count: measurement.facet_count,
        total_ridge_length: measurement.total_ridge_length,
        total_hip_length: measurement.total_hip_length,
        total_valley_length: measurement.total_valley_length,
        total_eave_length: measurement.total_eave_length,
        total_rake_length: measurement.total_rake_length,
        updated_at: measurement.updated_at,
        geometry_json: measurement.ai_analysis as Record<string, unknown> | null,
        linear_features_wkt: measurement.linear_features_wkt as string | null,
      };

      setState(prev => ({
        ...prev,
        measurementData,
        segments,
        isLoading: false,
        isSyncing: false,
        lastSyncAt: new Date(),
        syncError: null,
        version: prev.version + 1,
      }));

      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['roof-measurement', measurementId] });

    } catch (error) {
      console.error('[DiagramSync] Error fetching measurement:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        isSyncing: false,
        syncError: error instanceof Error ? error.message : 'Failed to fetch measurement',
      }));
    }
  }, [measurementId, queryClient]);

  // Subscribe to real-time updates
  const subscribeToMeasurement = useCallback((id: string) => {
    console.log('[DiagramSync] Subscribing to measurement:', id);

    const channel = supabase
      .channel(`measurement-${id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'roof_measurements',
          filter: `id=eq.${id}`,
        },
        (payload) => {
          console.log('[DiagramSync] Measurement updated:', payload);
          fetchMeasurement();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'roof_measurement_edges',
          filter: `measurement_id=eq.${id}`,
        },
        (payload) => {
          console.log('[DiagramSync] Edge updated:', payload);
          fetchMeasurement();
        }
      )
      .subscribe();

    return () => {
      console.log('[DiagramSync] Unsubscribing from measurement:', id);
      supabase.removeChannel(channel);
    };
  }, [fetchMeasurement]);

  // Update segment
  const updateSegment = useCallback(async (segmentId: string, updates: Partial<SegmentData>) => {
    if (!measurementId) return;

    setState(prev => ({ ...prev, isSyncing: true }));

    try {
      const segmentIndex = parseInt(segmentId.replace('segment-', ''), 10);
      const edge = state.segments[segmentIndex];
      
      if (edge) {
        const { error } = await supabase
          .from('roof_measurement_edges')
          .update({
            length_ft: updates.length_ft,
            updated_at: new Date().toISOString(),
          })
          .eq('id', edge.id);

        if (error) throw error;
      }

      // Optimistic update
      setState(prev => ({
        ...prev,
        segments: prev.segments.map(seg =>
          seg.segment_id === segmentId ? { ...seg, ...updates } : seg
        ),
        isSyncing: false,
      }));

    } catch (error) {
      console.error('[DiagramSync] Error updating segment:', error);
      setState(prev => ({
        ...prev,
        isSyncing: false,
        syncError: error instanceof Error ? error.message : 'Failed to update segment',
      }));
    }
  }, [measurementId, state.segments]);

  // Initial fetch
  useEffect(() => {
    fetchMeasurement();
  }, [fetchMeasurement]);

  // Subscribe to updates when measurement ID changes
  useEffect(() => {
    if (!measurementId) return;
    return subscribeToMeasurement(measurementId);
  }, [measurementId, subscribeToMeasurement]);

  const value: DiagramSyncContextValue = {
    ...state,
    refreshMeasurement: fetchMeasurement,
    updateSegment,
    subscribeToMeasurement,
    setSelectedSegment,
    selectedSegmentId,
  };

  return (
    <DiagramSyncContext.Provider value={value}>
      {children}
    </DiagramSyncContext.Provider>
  );
}

// Hook to use diagram sync
export function useDiagramSync() {
  const context = useContext(DiagramSyncContext);
  if (!context) {
    throw new Error('useDiagramSync must be used within DiagramSyncProvider');
  }
  return context;
}

// Hook for measurement sync status
export function useMeasurementSync(measurementId: string | null) {
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    if (!measurementId) return;

    const channel = supabase
      .channel(`sync-${measurementId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'roof_measurements',
          filter: `id=eq.${measurementId}`,
        },
        () => {
          setLastUpdate(new Date());
        }
      )
      .subscribe((status) => {
        setIsSubscribed(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
      setIsSubscribed(false);
    };
  }, [measurementId]);

  return { lastUpdate, isSubscribed };
}

export default DiagramSyncContext;
