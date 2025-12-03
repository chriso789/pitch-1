import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface LeadDetailsData {
  id: string;
  status: string;
  roof_type?: string;
  priority: string;
  estimated_value?: number;
  notes?: string;
  metadata?: any;
  verified_address?: {
    formatted_address: string;
    geometry?: {
      location?: {
        lat: number;
        lng: number;
      };
    };
  };
  contact?: {
    id: string;
    first_name: string;
    last_name: string;
    email?: string;
    phone?: string;
    address_street?: string;
    address_city?: string;
    address_state?: string;
    address_zip?: string;
    latitude?: number;
    longitude?: number;
    verified_address?: {
      lat: number;
      lng: number;
      formatted_address?: string;
      [key: string]: any;
    };
  };
  assigned_rep?: {
    id: string;
    first_name: string;
    last_name: string;
  };
  created_at: string;
  updated_at: string;
}

export interface ApprovalRequirements {
  hasContract: boolean;
  hasEstimate: boolean;
  hasMaterials: boolean;
  hasLabor: boolean;
  allComplete: boolean;
}

// Fetch lead details
async function fetchLeadDetails(id: string): Promise<LeadDetailsData | null> {
  const { data, error } = await supabase
    .from('pipeline_entries')
    .select(`
      *,
      contact:contacts(*),
      assigned_rep:profiles!pipeline_entries_assigned_to_fkey(id, first_name, last_name)
    `)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const metadata = data.metadata as any;
  return {
    ...data,
    verified_address: metadata?.verified_address || null
  } as unknown as LeadDetailsData;
}

// Fetch all approval requirements in PARALLEL
async function fetchApprovalRequirements(id: string): Promise<ApprovalRequirements> {
  // Run all queries in parallel
  const [contractsResult, estimateResult, pipelineResult] = await Promise.all([
    supabase
      .from('documents')
      .select('id')
      .eq('pipeline_entry_id', id)
      .eq('document_type', 'contract')
      .limit(1),
    supabase
      .from('enhanced_estimates')
      .select('id, selling_price, material_cost, labor_cost')
      .eq('pipeline_entry_id', id)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('pipeline_entries')
      .select('metadata')
      .eq('id', id)
      .maybeSingle()
  ]);

  const metadata = pipelineResult.data?.metadata as Record<string, any> | null;
  const selectedEstimateId = metadata?.selected_estimate_id || estimateResult.data?.[0]?.id;

  // Fetch materials and labor in parallel if we have an estimate
  let materials: any[] = [];
  let labor: any[] = [];
  
  if (selectedEstimateId) {
    const [materialResult, laborResult] = await Promise.all([
      supabase
        .from('estimate_line_items')
        .select('id')
        .eq('estimate_id', selectedEstimateId)
        .eq('item_category', 'material')
        .limit(1),
      supabase
        .from('estimate_line_items')
        .select('id')
        .eq('estimate_id', selectedEstimateId)
        .eq('item_category', 'labor')
        .limit(1)
    ]);
    materials = materialResult.data || [];
    labor = laborResult.data || [];
  }

  const hasContract = (contractsResult.data?.length || 0) > 0;
  const hasEstimate = !!selectedEstimateId;
  const hasMaterials = (materials?.length || 0) > 0;
  const hasLabor = (labor?.length || 0) > 0;
  const allComplete = hasContract && hasEstimate && hasMaterials && hasLabor;

  return { hasContract, hasEstimate, hasMaterials, hasLabor, allComplete };
}

// Fetch photos
async function fetchPhotos(id: string) {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('pipeline_entry_id', id)
    .eq('document_type', 'inspection_photo')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// Fetch production stage
async function fetchProductionStage(id: string): Promise<string | null> {
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('pipeline_entry_id', id)
    .maybeSingle();

  if (!project) return null;

  const { data: workflow } = await supabase
    .from('production_workflows')
    .select('current_stage')
    .eq('project_id', project.id)
    .maybeSingle();

  return workflow?.current_stage || null;
}

// Fetch sales reps
async function fetchSalesReps() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, first_name, last_name')
    .in('role', ['sales_manager', 'regional_manager', 'corporate'])
    .eq('is_active', true)
    .order('first_name');

  if (error) throw error;
  return data || [];
}

// Main hook - fetches ALL data in PARALLEL with caching
export function useLeadDetails(id: string | undefined) {
  const queryClient = useQueryClient();

  // Lead details - primary data
  const leadQuery = useQuery({
    queryKey: ['lead', id],
    queryFn: () => fetchLeadDetails(id!),
    enabled: !!id,
    staleTime: 30000, // 30 seconds
  });

  // Approval requirements - parallel
  const requirementsQuery = useQuery({
    queryKey: ['lead-requirements', id],
    queryFn: () => fetchApprovalRequirements(id!),
    enabled: !!id,
    staleTime: 30000,
  });

  // Photos - parallel
  const photosQuery = useQuery({
    queryKey: ['lead-photos', id],
    queryFn: () => fetchPhotos(id!),
    enabled: !!id,
    staleTime: 30000,
  });

  // Production stage - parallel
  const productionStageQuery = useQuery({
    queryKey: ['lead-production-stage', id],
    queryFn: () => fetchProductionStage(id!),
    enabled: !!id,
    staleTime: 30000,
  });

  // Sales reps - only fetch once globally
  const salesRepsQuery = useQuery({
    queryKey: ['sales-reps'],
    queryFn: fetchSalesReps,
    staleTime: 300000, // 5 minutes - rarely changes
  });

  // Refetch functions
  const refetchRequirements = () => requirementsQuery.refetch();
  const refetchPhotos = () => photosQuery.refetch();
  const refetchLead = () => leadQuery.refetch();

  // Check if any critical data is still loading
  const isLoading = leadQuery.isLoading;
  const isLoadingAll = leadQuery.isLoading || requirementsQuery.isLoading || photosQuery.isLoading;

  return {
    // Data
    lead: leadQuery.data,
    requirements: requirementsQuery.data || {
      hasContract: false,
      hasEstimate: false,
      hasMaterials: false,
      hasLabor: false,
      allComplete: false
    },
    photos: photosQuery.data || [],
    productionStage: productionStageQuery.data,
    salesReps: salesRepsQuery.data || [],

    // Loading states
    isLoading,
    isLoadingAll,
    isLoadingLead: leadQuery.isLoading,
    isLoadingRequirements: requirementsQuery.isLoading,
    isLoadingPhotos: photosQuery.isLoading,
    
    // Refetch functions
    refetchRequirements,
    refetchPhotos,
    refetchLead,
    refetchAll: () => {
      refetchLead();
      refetchRequirements();
      refetchPhotos();
      productionStageQuery.refetch();
    }
  };
}

// Prefetch function for hover prefetching
export function usePrefetchLeadDetails() {
  const queryClient = useQueryClient();

  return (id: string) => {
    // Prefetch all lead data in parallel
    queryClient.prefetchQuery({
      queryKey: ['lead', id],
      queryFn: () => fetchLeadDetails(id),
      staleTime: 30000,
    });
    queryClient.prefetchQuery({
      queryKey: ['lead-requirements', id],
      queryFn: () => fetchApprovalRequirements(id),
      staleTime: 30000,
    });
    queryClient.prefetchQuery({
      queryKey: ['lead-photos', id],
      queryFn: () => fetchPhotos(id),
      staleTime: 30000,
    });
  };
}
