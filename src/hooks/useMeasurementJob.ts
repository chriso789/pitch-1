import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface MeasurementJob {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress_message: string | null;
  measurement_id: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

/**
 * Hook to start an async AI measurement job and poll for its status.
 */
export function useMeasurementJob(pipelineEntryId: string) {
  const queryClient = useQueryClient();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const markStaleJobFailed = useCallback(async (job: MeasurementJob) => {
    const startedAt = job.started_at || job.created_at;
    const ageMs = Date.now() - new Date(startedAt).getTime();
    if (ageMs < 8 * 60 * 1000) return false;

    const failedJob: MeasurementJob = {
      ...job,
      status: 'failed',
      progress_message: 'Timed out — please re-run AI measurement',
      error: job.error || 'AI measurement exceeded the 8 minute safety limit.',
      completed_at: new Date().toISOString(),
    };
    queryClient.setQueryData(['measurement-job', pipelineEntryId], failedJob);
    setActiveJobId(null);
    return true;
  }, [pipelineEntryId, queryClient]);

  // Query latest job for this pipeline entry
  const { data: latestJob, refetch: refetchJob } = useQuery({
    queryKey: ['measurement-job', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('measurement_jobs')
        .select('id, status, progress_message, measurement_id, error, created_at, started_at, completed_at')
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as MeasurementJob | null;
    },
    enabled: !!pipelineEntryId,
    refetchInterval: false, // We'll manually control polling
  });

  // Poll while job is active
  useEffect(() => {
    if (!activeJobId && latestJob && (latestJob.status === 'queued' || latestJob.status === 'processing')) {
      setActiveJobId(latestJob.id);
    }

    if (!activeJobId) return;

    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('measurement_jobs')
        .select('id, status, progress_message, measurement_id, error, created_at, started_at, completed_at')
        .eq('id', activeJobId)
        .single();

      if (data) {
        if ((data.status === 'queued' || data.status === 'processing') && await markStaleJobFailed(data as MeasurementJob)) {
          return;
        }
        // Update the query cache
        queryClient.setQueryData(['measurement-job', pipelineEntryId], data);

        if (data.status === 'completed' || data.status === 'failed') {
          setActiveJobId(null);
          // Invalidate measurement queries so UI refreshes
          queryClient.invalidateQueries({ queryKey: ['ai-measurements', pipelineEntryId] });
          queryClient.invalidateQueries({ queryKey: ['measurement-approvals', pipelineEntryId] });
          queryClient.invalidateQueries({ queryKey: ['measurement-context', pipelineEntryId] });
          queryClient.invalidateQueries({ queryKey: ['roof-measurement'] });
          queryClient.invalidateQueries({ queryKey: ['roof_measurements'] });
          queryClient.invalidateQueries({ queryKey: ['measurement'] });
          queryClient.invalidateQueries({ queryKey: ['active-measurement', pipelineEntryId] });
        }
      }
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(interval);
  }, [activeJobId, pipelineEntryId, queryClient, latestJob, markStaleJobFailed]);

  const startJob = useCallback(async (params: {
    lat: number;
    lng: number;
    address?: string;
    pitchOverride?: string;
    tenantId: string;
    userId?: string;
  }) => {
    // Canonical AI Measurement entrypoint: async job flow that writes to
    // measurement_jobs (polled below) and publishes to roof_measurements +
    // measurement_approvals so the lead/project page picks it up automatically.
    const { data, error } = await supabase.functions.invoke('start-ai-measurement', {
      body: {
        // Canonical (geometry_first_v2) payload
        lead_id: pipelineEntryId,
        source_button: 'AI Measurement',
        source_record_type: 'lead',
        source_record_id: pipelineEntryId,
        // Backwards-compat
        pipelineEntryId,
        lat: params.lat,
        lng: params.lng,
        address: params.address,
        zoom: 21,
        pitchOverride: params.pitchOverride,
        tenantId: params.tenantId,
        userId: params.userId,
      }
    });

    if (error) throw error;
    const jobId = data?.jobId || data?.job_id;
    if (!jobId) throw new Error(data?.error || 'Failed to start measurement job');

    setActiveJobId(jobId);
    // Immediately refetch to show the new job
    queryClient.invalidateQueries({ queryKey: ['roof_measurements'] });
    queryClient.invalidateQueries({ queryKey: ['ai-measurements', pipelineEntryId] });
    queryClient.invalidateQueries({ queryKey: ['measurement-context', pipelineEntryId] });
    await refetchJob();
    return jobId as string;
  }, [pipelineEntryId, queryClient, refetchJob]);

  const isActive = latestJob?.status === 'queued' || latestJob?.status === 'processing';

  return {
    job: latestJob,
    isActive,
    startJob,
    refetchJob,
  };
}
