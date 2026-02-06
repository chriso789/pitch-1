import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ApprovalThreshold {
  minValue: number;
  maxValue: number | null;
  requiredRoles: string[];
  approvalType: 'any' | 'all';
}

interface ApprovalCheckResult {
  requiresApproval: boolean;
  canProceed: boolean;
  threshold?: ApprovalThreshold;
  existingApproval?: {
    id: string;
    status: string;
    approvedBy?: string;
    approvedAt?: string;
  };
  message?: string;
}

const MANAGER_ROLES = ['master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager'];

const DEFAULT_THRESHOLDS: ApprovalThreshold[] = [
  { minValue: 0, maxValue: 10000, requiredRoles: [], approvalType: 'any' },
  { minValue: 10000, maxValue: 25000, requiredRoles: ['office_admin', 'regional_manager', 'sales_manager'], approvalType: 'any' },
  { minValue: 25000, maxValue: null, requiredRoles: ['corporate', 'master', 'owner'], approvalType: 'any' },
];

/**
 * Hook for checking and managing manager approval gates
 * Used primarily for high-value lead-to-project conversions
 */
export const useApprovalGate = () => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  /**
   * Check if a pipeline entry requires manager approval for conversion
   */
  const checkApprovalRequired = useCallback(async (
    pipelineEntryId: string,
    estimatedValue: number,
    userRole: string
  ): Promise<ApprovalCheckResult> => {
    // Managers can always proceed
    if (MANAGER_ROLES.includes(userRole)) {
      return {
        requiresApproval: false,
        canProceed: true,
        message: 'Manager role - no approval needed'
      };
    }

    // Find applicable threshold
    const threshold = DEFAULT_THRESHOLDS.find(t => 
      estimatedValue >= t.minValue && 
      (t.maxValue === null || estimatedValue < t.maxValue)
    );

    if (!threshold || threshold.requiredRoles.length === 0) {
      return {
        requiresApproval: false,
        canProceed: true,
        message: 'Value below approval threshold'
      };
    }

    // Check for existing approved request
    try {
      const { data: existingApproval, error } = await supabase
        .from('manager_approval_queue')
        .select('id, status, reviewed_by, reviewed_at')
        .eq('pipeline_entry_id', pipelineEntryId)
        .eq('status', 'approved')
        .maybeSingle();

      if (error) {
        console.error('Error checking approval status:', error);
      }

      if (existingApproval) {
        return {
          requiresApproval: true,
          canProceed: true,
          threshold,
          existingApproval: {
            id: existingApproval.id,
            status: existingApproval.status,
            approvedBy: existingApproval.reviewed_by || undefined,
            approvedAt: existingApproval.reviewed_at || undefined,
          },
          message: 'Approval already granted'
        };
      }

      // Check for pending request
      const { data: pendingApproval } = await supabase
        .from('manager_approval_queue')
        .select('id, status')
        .eq('pipeline_entry_id', pipelineEntryId)
        .eq('status', 'pending')
        .maybeSingle();

      if (pendingApproval) {
        return {
          requiresApproval: true,
          canProceed: false,
          threshold,
          existingApproval: {
            id: pendingApproval.id,
            status: 'pending'
          },
          message: 'Approval request pending'
        };
      }

      // No approval exists - requires new request
      return {
        requiresApproval: true,
        canProceed: false,
        threshold,
        message: `Jobs over $${threshold.minValue.toLocaleString()} require manager approval`
      };

    } catch (error) {
      console.error('Error in approval check:', error);
      return {
        requiresApproval: true,
        canProceed: false,
        message: 'Error checking approval status'
      };
    }
  }, []);

  /**
   * Submit a new approval request
   */
  const submitApprovalRequest = useCallback(async (
    pipelineEntryId: string,
    contactId: string,
    estimatedValue: number,
    justification: string
  ): Promise<{ success: boolean; approvalId?: string; error?: string }> => {
    setLoading(true);
    try {
      // Determine priority based on value
      let priority: 'standard' | 'high' | 'critical' = 'standard';
      if (estimatedValue > 50000) priority = 'critical';
      else if (estimatedValue > 25000) priority = 'high';

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Get tenant ID
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) throw new Error('No tenant found');

      const { data, error } = await supabase
        .from('manager_approval_queue')
        .insert({
          pipeline_entry_id: pipelineEntryId,
          contact_id: contactId,
          estimated_value: estimatedValue,
          business_justification: justification,
          priority,
          requested_by: user.id,
          tenant_id: profile.tenant_id,
          status: 'pending'
        })
        .select('id')
        .single();

      if (error) throw error;

      toast({
        title: 'Approval Requested',
        description: 'Your request has been submitted to the approval queue'
      });

      return { success: true, approvalId: data.id };

    } catch (error: any) {
      console.error('Error submitting approval request:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to submit approval request',
        variant: 'destructive'
      });
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  }, [toast]);

  /**
   * Check if user is a manager
   */
  const isManagerRole = useCallback((role: string): boolean => {
    return MANAGER_ROLES.includes(role);
  }, []);

  /**
   * Get approval threshold for a value
   */
  const getThresholdForValue = useCallback((value: number): ApprovalThreshold | null => {
    return DEFAULT_THRESHOLDS.find(t => 
      value >= t.minValue && 
      (t.maxValue === null || value < t.maxValue)
    ) || null;
  }, []);

  return {
    loading,
    checkApprovalRequired,
    submitApprovalRequest,
    isManagerRole,
    getThresholdForValue,
    MANAGER_ROLES,
  };
};

export default useApprovalGate;
