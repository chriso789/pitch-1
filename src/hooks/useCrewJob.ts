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
  checklistId: string;
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
  const { user, activeCompanyId, isCrewMember } = useCrewAuth();
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
    if (!user || !activeCompanyId || !jobId || !isCrewMember) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Fetch job via RPC with company filter
      const { data: assignmentData, error: assignmentError } = await supabase.rpc(
        'get_crew_job_detail' as any,
        { p_job_id: jobId, p_company_id: activeCompanyId }
      );

      if (assignmentError || !assignmentData) {
        throw new Error('Job not found or not assigned to you');
      }

      const a = (Array.isArray(assignmentData) ? assignmentData[0] : assignmentData) as any;
      if (!a) throw new Error("Job not found");
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
        photoProgress: {
          current: a.photo_uploaded_total || 0,
          required: a.photo_required_total || 0,
        },
        checklistProgress: {
          current: a.checklist_checked_items || 0,
          required: a.checklist_required_items || 0,
        },
        docsValid: a.docs_valid ?? true,
        photosComplete: a.photos_complete ?? false,
        checklistComplete: a.checklist_complete ?? false,
        canComplete: a.can_complete ?? false,
        blockedReason: a.blocked_reason || null,
      };

      setJob(assignment);
      
      const { data: requirements, error: requirementsError } = await supabase.rpc('get_crew_job_requirements' as any,
        { p_job_id: jobId, p_company_id: activeCompanyId });
      if (requirementsError) throw requirementsError;
      const reqs = requirements as any;
      setPhotoBuckets(reqs.photoBuckets);
      setChecklistItems(reqs.checklistItems);
      setCompletionStatus({ docsValid: a.docs_valid === true, photosComplete: a.photos_complete === true,
        checklistComplete: a.checklist_complete === true, canComplete: a.can_complete === true && !a.is_locked,
        blockingReasons: [a.blocked_reason, a.is_locked ? a.lock_reason || 'Job is locked' : null].filter(Boolean) });
    } catch (err) {
      console.error('[useCrewJob] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load job');
    } finally {
      setLoading(false);
    }
  }, [user, activeCompanyId, jobId, isCrewMember]);

  const updateStatus = async (newStatus: CrewJobStatus) => {
    if (!job || !activeCompanyId) return;

    try {
      const { data, error: updateError } = await supabase.rpc(
        'update_crew_job_status' as any,
        { p_assignment_id: job.id, p_new_status: newStatus, p_company_id: activeCompanyId }
      );

      if (updateError) throw updateError;
      if (!(data as any)?.success) throw new Error((data as any)?.error || "Status was not saved");

      toast.success(`Status updated to ${newStatus.replace('_', ' ')}`);
      await fetchJob();
    } catch (err: any) {
      console.error('[useCrewJob] Error updating status:', err);
      toast.error(err.message || 'Failed to update status');
    }
  };

  const toggleChecklistItem = async (itemId: string, checked: boolean, proofPhotoId?: string) => {
    if (!jobId || !activeCompanyId) return;
    const item = checklistItems.find(i => i.id === itemId);
    if (!item) return;
    try {
      const { error } = await supabase.rpc('save_crew_checklist_response' as any, {
        p_job_id: jobId, p_company_id: activeCompanyId, p_checklist_id: item.checklistId,
        p_item_id: itemId, p_checked: checked, p_proof_photo_id: proofPhotoId || item.proofPhotoId || null,
      });
      if (error) throw error;
      await fetchJob();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Checklist could not be saved'); }

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
