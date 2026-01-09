import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCrewAuth } from './useCrewAuth';
import { CrewJobAssignment, CrewJobStatus } from './useCrewDashboard';
import { toast } from 'sonner';

interface PhotoBucket {
  id: string;
  key: string;
  label: string;
  description: string | null;
  requiredCount: number;
  currentCount: number;
  isRequired: boolean;
}

interface ChecklistItem {
  id: string;
  sortOrder: number;
  label: string;
  helpText: string | null;
  requiresPhoto: boolean;
  isRequired: boolean;
  isChecked: boolean;
  proofPhotoId: string | null;
  note: string | null;
  responseId: string | null;
}

interface CompletionStatus {
  docsValid: boolean;
  photosComplete: boolean;
  checklistComplete: boolean;
  canComplete: boolean;
  blockingReasons: string[];
}

export function useCrewJob(jobId: string | null) {
  const { user, companyId, isCrewMember } = useCrewAuth();
  const [job, setJob] = useState<CrewJobAssignment | null>(null);
  const [photoBuckets, setPhotoBuckets] = useState<PhotoBucket[]>([]);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [completionStatus, setCompletionStatus] = useState<CompletionStatus>({
    docsValid: true,
    photosComplete: false,
    checklistComplete: false,
    canComplete: false,
    blockingReasons: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJob = useCallback(async () => {
    if (!user || !companyId || !jobId || !isCrewMember) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Fetch job via RPC
      const { data: assignmentData, error: assignmentError } = await supabase.rpc(
        'get_crew_job_detail' as any,
        { p_job_id: jobId, p_user_id: user.id }
      );

      if (assignmentError || !assignmentData) {
        throw new Error('Job not found or not assigned to you');
      }

      const a = assignmentData as any;
      const assignment: CrewJobAssignment = {
        id: a.id,
        companyId: a.company_id,
        jobId: a.job_id,
        subcontractorUserId: a.subcontractor_user_id,
        scheduledDate: a.scheduled_date,
        arrivalWindowStart: a.arrival_window_start,
        arrivalWindowEnd: a.arrival_window_end,
        scopeSummary: a.scope_summary,
        specialInstructions: a.special_instructions,
        status: a.status as CrewJobStatus,
        statusUpdatedAt: a.status_updated_at,
        isLocked: a.is_locked,
        lockReason: a.lock_reason,
        createdAt: a.created_at,
      };

      setJob(assignment);
      
      // For now, set simplified completion status
      setCompletionStatus({
        docsValid: true,
        photosComplete: true,
        checklistComplete: true,
        canComplete: !assignment.isLocked,
        blockingReasons: assignment.isLocked ? [assignment.lockReason || 'Job is locked'] : [],
      });
    } catch (err) {
      console.error('[useCrewJob] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load job');
    } finally {
      setLoading(false);
    }
  }, [user, companyId, jobId, isCrewMember]);

  const updateStatus = async (newStatus: CrewJobStatus) => {
    if (!job || !companyId) return;

    try {
      const { error: updateError } = await supabase.rpc(
        'update_crew_job_status' as any,
        { p_assignment_id: job.id, p_new_status: newStatus }
      );

      if (updateError) throw updateError;

      toast.success(`Status updated to ${newStatus.replace('_', ' ')}`);
      await fetchJob();
    } catch (err: any) {
      console.error('[useCrewJob] Error updating status:', err);
      toast.error(err.message || 'Failed to update status');
    }
  };

  const toggleChecklistItem = async (itemId: string, checked: boolean, proofPhotoId?: string) => {
    toast.info('Checklist functionality coming soon');
  };

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  return {
    job,
    photoBuckets,
    checklistItems,
    completionStatus,
    loading,
    error,
    updateStatus,
    toggleChecklistItem,
    refetch: fetchJob,
  };
}
