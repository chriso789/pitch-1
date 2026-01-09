import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCrewAuth } from './useCrewAuth';

export type CrewJobStatus = 'assigned' | 'en_route' | 'on_site' | 'work_started' | 'waiting' | 'completed';

export interface CrewJobAssignment {
  id: string;
  companyId: string;
  jobId: string;
  subcontractorUserId: string;
  scheduledDate: string | null;
  arrivalWindowStart: string | null;
  arrivalWindowEnd: string | null;
  scopeSummary: string | null;
  specialInstructions: string | null;
  status: CrewJobStatus;
  statusUpdatedAt: string;
  isLocked: boolean;
  lockReason: string | null;
  createdAt: string;
  photoProgress?: { current: number; required: number };
  checklistProgress?: { current: number; required: number };
  address?: string;
}

interface DashboardCounts {
  today: number;
  upcoming: number;
  blocked: number;
  completedThisWeek: number;
}

export function useCrewDashboard() {
  const { user, companyId, isCrewMember } = useCrewAuth();
  const [jobs, setJobs] = useState<CrewJobAssignment[]>([]);
  const [counts, setCounts] = useState<DashboardCounts>({
    today: 0,
    upcoming: 0,
    blocked: 0,
    completedThisWeek: 0,
  });
  const [docsStatus, setDocsStatus] = useState<'valid' | 'expiring' | 'expired'>('valid');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    if (!user || !companyId || !isCrewMember) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Use RPC to fetch assignments from crew schema
      const { data: assignmentsData, error: assignmentsError } = await supabase.rpc(
        'get_crew_job_assignments' as any,
        { p_user_id: user.id }
      );

      if (assignmentsError) {
        console.error('[useCrewDashboard] Error:', assignmentsError);
        throw new Error('Failed to load job assignments');
      }

      const assignments: CrewJobAssignment[] = ((assignmentsData as any[]) || []).map((a) => ({
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
      }));

      // Calculate counts
      const todayJobs = assignments.filter(
        a => a.scheduledDate === today && a.status !== 'completed'
      );
      const upcomingJobs = assignments.filter(
        a => a.scheduledDate && a.scheduledDate > today && a.status !== 'completed'
      );
      const blockedJobs = assignments.filter(a => a.isLocked);
      const completedThisWeek = assignments.filter(
        a => a.status === 'completed' && a.statusUpdatedAt >= weekAgo
      );

      setCounts({
        today: todayJobs.length,
        upcoming: upcomingJobs.length,
        blocked: blockedJobs.length,
        completedThisWeek: completedThisWeek.length,
      });

      const visibleJobs = assignments.filter(
        a => a.status !== 'completed' || a.scheduledDate === today
      );

      setJobs(visibleJobs);
      setDocsStatus('valid'); // Simplified for now
    } catch (err) {
      console.error('[useCrewDashboard] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [user, companyId, isCrewMember]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  return {
    jobs,
    counts,
    docsStatus,
    loading,
    error,
    refetch: fetchDashboard,
  };
}
