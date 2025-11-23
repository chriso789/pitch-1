import { offlineManager } from './offlineManager';
import { supabase } from '@/integrations/supabase/client';

export interface MeasurementSavePayload {
  measurementId: string;
  propertyId: string;
  facets: any[];
  linearFeatures: any[];
  summary: {
    total_area_sqft: number;
    total_squares: number;
    waste_pct: number;
    pitch: string;
    pitch_factor?: number;
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

  // Online - save with versioning
  try {
    console.log('[Measurement Save] Attempting online save with versioning...');
    
    // Step 1: Get current active measurement to determine version
    const { data: currentMeasurement } = await supabase
      .from('measurements')
      .select('id, version')
      .eq('property_id', payload.propertyId)
      .eq('is_active', true)
      .maybeSingle();

    console.log('[Measurement Save] Current active version:', currentMeasurement);

    // Step 2: Mark current version as inactive if it exists
    if (currentMeasurement) {
      const { error: deactivateError } = await supabase
        .from('measurements')
        .update({ is_active: false })
        .eq('id', currentMeasurement.id);

      if (deactivateError) {
        console.error('[Measurement Save] Error deactivating old version:', deactivateError);
        throw deactivateError;
      }
      console.log(`[Measurement Save] Deactivated version ${currentMeasurement.version}`);
    }

    // Step 3: Create new version
    const newVersion = currentMeasurement ? (currentMeasurement.version || 1) + 1 : 1;
    const { data: newMeasurement, error: insertError } = await supabase
      .from('measurements')
      .insert({
        property_id: payload.propertyId,
        source: 'manual_adjustment',
        faces: payload.facets,
        linear_features: payload.linearFeatures,
        summary: payload.summary,
        version: newVersion,
        supersedes: currentMeasurement?.id,
        is_active: true,
        visualization_metadata: {
          ...payload.metadata,
          last_updated: new Date().toISOString(),
        },
      })
      .select()
      .maybeSingle();

    if (insertError) {
      console.error('[Measurement Save] Error inserting new version:', insertError);
      throw insertError;
    }

    console.log(`[Measurement Save] ✅ Created version ${newVersion} (supersedes ${currentMeasurement?.id || 'none'})`);

    // Step 4: Update pipeline_entries metadata
    const { data: pipelineData } = await supabase
      .from('pipeline_entries')
      .select('metadata')
      .eq('id', payload.propertyId)
      .single();
    
    const existingMetadata = (pipelineData?.metadata as any) || {};

    const { error: pipelineError } = await supabase
      .from('pipeline_entries')
      .update({
        metadata: {
          ...existingMetadata,
          comprehensive_measurements: {
            faces: payload.facets,
            linear_features: payload.linearFeatures,
            summary: payload.summary,
          },
          roof_area_sq_ft: payload.summary.total_area_sqft,
          roof_pitch: payload.summary.pitch,
        },
      })
      .eq('id', payload.propertyId);

    if (pipelineError) {
      console.error('[Measurement Save] Error updating pipeline metadata:', pipelineError);
      throw pipelineError;
    }

    console.log('[Measurement Save] ✅ Online save successful with versioning');
    return { success: true };
  } catch (error: any) {
    console.error('[Measurement Save] Failed to save measurement:', error);
    
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
