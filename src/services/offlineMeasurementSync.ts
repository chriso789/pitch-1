import { offlineManager } from './offlineManager';
import { supabase } from '@/integrations/supabase/client';

export interface MeasurementSavePayload {
  measurementId: string;
  propertyId: string;
  facets: any[];
  linearFeatures: any[];
  summary: {
    totalAreaSqft: number;
    totalSquares: number;
    wastePercentage: number;
    pitch: string;
    perimeter: number;
    stories: number;
  };
  metadata: any;
}

export async function saveMeasurementWithOfflineSupport(
  payload: MeasurementSavePayload
): Promise<{ success: boolean; error?: string }> {
  const isOnline = offlineManager.isOnline();

  if (!isOnline) {
    // Queue for offline sync
    await offlineManager.queueActivity({
      type: 'measurement_save',
      payload,
      userLocation: null,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  }

  // Online - save directly
  try {
    const { error: measurementError } = await supabase
      .from('measurements')
      .update({
        summary: payload.summary,
        visualization_metadata: {
          ...payload.metadata,
          last_updated: new Date().toISOString(),
        },
      })
      .eq('id', payload.measurementId);

    if (measurementError) throw measurementError;

    const { error: pipelineError } = await supabase
      .from('pipeline_entries')
      .update({
        metadata: {
          comprehensive_measurements: {
            faces: payload.facets,
            linear_features: payload.linearFeatures,
            summary: payload.summary,
          },
          roof_area_sq_ft: payload.summary.totalAreaSqft,
          roof_pitch: payload.summary.pitch,
        },
      })
      .eq('id', payload.propertyId);

    if (pipelineError) throw pipelineError;

    return { success: true };
  } catch (error: any) {
    console.error('Failed to save measurement:', error);
    
    // Queue for retry
    await offlineManager.queueActivity({
      type: 'measurement_save',
      payload,
      userLocation: null,
      timestamp: new Date().toISOString(),
    });

    return { success: false, error: error.message };
  }
}

export async function syncQueuedMeasurements(): Promise<number> {
  const queued = await offlineManager.getQueuedActivities();
  const measurementActivities = queued.filter(a => a.type === 'measurement_save');

  let syncedCount = 0;

  for (const activity of measurementActivities) {
    const payload = activity.payload as MeasurementSavePayload;
    const result = await saveMeasurementWithOfflineSupport(payload);

    if (result.success) {
      await offlineManager.removeQueuedActivity(activity.id);
      syncedCount++;
    }
  }

  return syncedCount;
}
