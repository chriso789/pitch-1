/**
 * Hooks for Permit Case management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { 
  PermitCaseStatus,
  PermitExpediterJob,
} from '@/lib/permits/types';

/**
 * Fetch all permit cases for the current tenant
 */
export function usePermitCases(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['permit-cases', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      
      const { data, error } = await supabase
        .from('permit_cases')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId,
  });
}

/**
 * Fetch a single permit case by ID
 */
export function usePermitCase(permitCaseId: string | undefined) {
  return useQuery({
    queryKey: ['permit-case', permitCaseId],
    queryFn: async () => {
      if (!permitCaseId) return null;
      
      const { data, error } = await supabase
        .from('permit_cases')
        .select('*')
        .eq('id', permitCaseId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!permitCaseId,
  });
}

/**
 * Fetch permit case events (audit trail)
 */
export function usePermitCaseEvents(permitCaseId: string | undefined) {
  return useQuery({
    queryKey: ['permit-case-events', permitCaseId],
    queryFn: async () => {
      if (!permitCaseId) return [];
      
      const { data, error } = await supabase
        .from('permit_case_events')
        .select('*')
        .eq('permit_case_id', permitCaseId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!permitCaseId,
  });
}

/**
 * Fetch permitting authorities
 */
export function usePermittingAuthorities(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['permitting-authorities', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      
      const { data, error } = await supabase
        .from('permitting_authorities')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('county_name', { ascending: true });

      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId,
  });
}

/**
 * Create a new permit case
 */
export function useCreatePermitCase() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: {
      tenantId: string;
      jobId: string;
      estimateId?: string;
      authorityId?: string;
      userId?: string;
    }) => {
      const { data, error } = await supabase
        .from('permit_cases')
        .insert({
          tenant_id: params.tenantId,
          job_id: params.jobId,
          estimate_id: params.estimateId || null,
          authority_id: params.authorityId || null,
          status: 'NOT_STARTED',
          created_by: params.userId || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Log the creation event
      await supabase.from('permit_case_events').insert({
        tenant_id: params.tenantId,
        permit_case_id: data.id,
        event_type: 'CREATED',
        message: 'Permit case created',
        created_by: params.userId || null,
      });

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permit-cases'] });
      queryClient.invalidateQueries({ queryKey: ['jobs-ready-for-permitting'] });
      toast({
        title: 'Permit Case Created',
        description: 'The permit case has been created successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

/**
 * Update permit case status
 */
export function useUpdatePermitCaseStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: {
      permitCaseId: string;
      status: PermitCaseStatus;
      tenantId: string;
      userId?: string;
    }) => {
      const { data, error } = await supabase
        .from('permit_cases')
        .update({ status: params.status })
        .eq('id', params.permitCaseId)
        .select()
        .single();

      if (error) throw error;

      // Log the status change event
      await supabase.from('permit_case_events').insert({
        tenant_id: params.tenantId,
        permit_case_id: params.permitCaseId,
        event_type: params.status === 'APPROVED' ? 'APPROVED' : 
                    params.status === 'REJECTED' ? 'REJECTED' :
                    params.status === 'SUBMITTED' ? 'SUBMITTED' : 'CREATED',
        message: `Status changed to ${params.status}`,
        details: { new_status: params.status },
        created_by: params.userId || null,
      });

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['permit-cases'] });
      queryClient.invalidateQueries({ queryKey: ['permit-case', data.id] });
      queryClient.invalidateQueries({ queryKey: ['permit-case-events', data.id] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

/**
 * Fetch jobs ready for permitting (for the expediter queue)
 */
export function useJobsReadyForPermitting(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['jobs-ready-for-permitting', tenantId],
    queryFn: async (): Promise<PermitExpediterJob[]> => {
      if (!tenantId) return [];
      
      // Get jobs from the tenant with contact data for address
      const { data: jobs, error } = await supabase
        .from('jobs')
        .select(`
          id,
          job_number,
          address_street,
          created_at,
          contact_id,
          contacts (
            id,
            first_name,
            last_name,
            address_street,
            address_city,
            address_state,
            address_zip,
            latitude,
            longitude
          )
        `)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      // Get permit cases for these jobs
      const jobIds = (jobs || []).map(j => j.id);
      const { data: permitCases } = await supabase
        .from('permit_cases')
        .select('*')
        .in('job_id', jobIds);

      // Get parcel data
      const { data: parcelData } = await supabase
        .from('property_parcel_cache')
        .select('job_id, parcel_id')
        .in('job_id', jobIds);

      // Get measurements
      const { data: measurements } = await supabase
        .from('permit_job_measurements')
        .select('job_id')
        .in('job_id', jobIds);

      // Transform to PermitExpediterJob format
      const expediterJobs: PermitExpediterJob[] = (jobs || []).map(job => {
        const permitCase = (permitCases || []).find(pc => pc.job_id === job.id);
        const parcel = (parcelData || []).find(p => p.job_id === job.id);
        const hasMeasurements = (measurements || []).some(m => m.job_id === job.id);
        
        // Get address from contact or job
        const contact = job.contacts;
        const addressParts = [
          contact?.address_street || job.address_street,
          contact?.address_city,
          contact?.address_state,
          contact?.address_zip
        ].filter(Boolean);
        const fullAddress = addressParts.join(', ') || 'No address';
        
        // Get contact name
        const contactName = contact 
          ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Unknown'
          : 'Unknown';

        return {
          id: permitCase?.id || job.id,
          job_id: job.id,
          job_number: job.job_number || undefined,
          address: fullAddress,
          parcel_id: parcel?.parcel_id || null,
          jurisdiction_type: permitCase?.jurisdiction_type || null,
          county_name: permitCase?.county_name || null,
          city_name: permitCase?.city_name || null,
          portal_type: null,
          status: (permitCase?.status as PermitCaseStatus) || 'NOT_STARTED',
          missing_items: [],
          has_measurements: hasMeasurements,
          has_product_approvals: false,
          has_parcel_data: !!parcel?.parcel_id,
          contact_name: contactName,
          created_at: job.created_at || new Date().toISOString(),
        };
      });

      return expediterJobs;
    },
    enabled: !!tenantId,
  });
}
