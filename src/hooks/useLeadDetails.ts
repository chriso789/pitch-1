import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface LeadDetailsData {
  id: string;
  tenant_id: string;
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
    qualification_status?: string;
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
  secondary_assigned_rep?: {
    id: string;
    first_name: string;
    last_name: string;
  };
  secondary_assigned_to?: string;
  primary_rep_split_percent?: number;
  location_id?: string;
  created_at: string;
  updated_at: string;
}

// Legacy interface for backward compatibility
export interface ApprovalRequirements {
  hasContract: boolean;
  hasEstimate: boolean;
  hasMaterials: boolean;
  hasLabor: boolean;
  allComplete: boolean;
}

// Dynamic requirement from database
export interface DynamicRequirement {
  id: string;
  key: string;
  label: string;
  icon: string;
  isRequired: boolean;
  isComplete: boolean;
  sortOrder: number;
  validationType: string;
}

// Fetch lead details
async function fetchLeadDetails(id: string): Promise<LeadDetailsData | null> {
  const { data, error } = await supabase
    .from('pipeline_entries')
    .select(`
      *,
      contact:contacts(*),
      assigned_rep:profiles!pipeline_entries_assigned_to_fkey(id, first_name, last_name),
      secondary_assigned_rep:profiles!pipeline_entries_secondary_assigned_to_fkey(id, first_name, last_name)
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

// Fetch dynamic approval requirements from tenant settings
async function fetchDynamicRequirements(tenantId: string | undefined, pipelineEntryId: string): Promise<{
  requirements: DynamicRequirement[];
  legacy: ApprovalRequirements;
}> {
  // Guard against undefined tenantId to prevent query errors
  if (!tenantId) {
    return {
      requirements: [],
      legacy: { hasContract: false, hasEstimate: false, hasMaterials: false, hasLabor: false, allComplete: false }
    };
  }
  // Fetch tenant's approval requirements configuration
  const { data: reqConfig, error: configError } = await supabase
    .from('tenant_approval_requirements')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (configError) throw configError;

  // If no requirements configured, return defaults
  const requirements = reqConfig || [];
  
  if (requirements.length === 0) {
    // Return legacy default
    return {
      requirements: [],
      legacy: { hasContract: false, hasEstimate: false, hasMaterials: false, hasLabor: false, allComplete: false }
    };
  }

  // Fetch validation data in parallel
  const [contractsResult, pipelineResult, photosResult] = await Promise.all([
    supabase
      .from('documents')
      .select('id, document_type')
      .eq('pipeline_entry_id', pipelineEntryId),
    supabase
      .from('pipeline_entries')
      .select('metadata')
      .eq('id', pipelineEntryId)
      .maybeSingle(),
    // Use customer_photos table (canonical source for photos)
    supabase
      .from('customer_photos')
      .select('id')
      .eq('lead_id', pipelineEntryId)
  ]);

  const documents = contractsResult.data || [];
  const metadata = pipelineResult.data?.metadata as Record<string, any> | null;
  const selectedEstimateId = metadata?.selected_estimate_id;
  const photoCount = photosResult.data?.length || 0;

  // Check if estimate has line items if needed
  let hasLineItems = false;
  if (selectedEstimateId) {
    const { data: lineItems } = await supabase
      .from('estimate_line_items')
      .select('id')
      .eq('estimate_id', selectedEstimateId)
      .limit(1);
    hasLineItems = (lineItems?.length || 0) > 0;
  }

  // Validate each requirement based on its type
  const dynamicReqs: DynamicRequirement[] = requirements.map((req) => {
    let isComplete = false;

    switch (req.validation_type) {
      case 'document':
        // Check if a document of the matching type exists
        // Map requirement key to document type
        const docTypeMap: Record<string, string> = {
          'contract': 'contract',
          'notice_of_commencement': 'notice_of_commencement',
        };
        const expectedDocType = docTypeMap[req.requirement_key] || req.requirement_key;
        isComplete = documents.some(d => d.document_type === expectedDocType);
        break;
      case 'estimate':
        isComplete = !!selectedEstimateId;
        break;
      case 'line_items':
        isComplete = hasLineItems;
        break;
      case 'photos':
        isComplete = photoCount > 0;
        break;
      case 'custom':
        // Custom validation would be defined in validation_config
        isComplete = false;
        break;
    }

    return {
      id: req.id,
      key: req.requirement_key,
      label: req.label,
      icon: req.icon_name,
      isRequired: req.is_required,
      isComplete,
      sortOrder: req.sort_order,
      validationType: req.validation_type,
    };
  });

  // Build legacy object for backward compatibility
  const hasContract = dynamicReqs.find(r => r.key === 'contract')?.isComplete || false;
  const hasEstimate = dynamicReqs.find(r => r.key === 'estimate')?.isComplete || false;
  const hasMaterials = dynamicReqs.find(r => r.key === 'notice_of_commencement')?.isComplete || false;
  const hasLabor = dynamicReqs.find(r => r.key === 'required_photos')?.isComplete || false;
  
  // All required items must be complete
  const requiredReqs = dynamicReqs.filter(r => r.isRequired);
  const allComplete = requiredReqs.length > 0 && requiredReqs.every(r => r.isComplete);

  return {
    requirements: dynamicReqs,
    legacy: { hasContract, hasEstimate, hasMaterials, hasLabor, allComplete }
  };
}

// Fetch photos from customer_photos table (canonical source)
async function fetchPhotos(id: string) {
  const { data, error } = await supabase
    .from('customer_photos')
    .select('*')
    .eq('lead_id', id)
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

// Fetch sales reps for a specific tenant, filtered by location
async function fetchSalesReps(tenantId: string | null, locationId?: string | null) {
  if (!tenantId) return [];

  const elevatedRoles = ['owner', 'corporate', 'office_admin'] as const;
  const allRoles = ['owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager', 'project_manager'] as const;

  // If no locationId, fall back to showing all tenant reps (current behavior)
  if (!locationId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, role')
      .eq('tenant_id', tenantId)
      .in('role', allRoles)
      .eq('is_active', true)
      .neq('role', 'master')
      .order('first_name');
    if (error) throw error;
    return data || [];
  }

  // Get user IDs assigned to this location
  const { data: assignments, error: assignError } = await supabase
    .from('user_location_assignments')
    .select('user_id')
    .eq('location_id', locationId);

  if (assignError) throw assignError;
  const locationUserIds = (assignments || []).map(a => a.user_id);

  // Fetch all reps in tenant with qualifying roles
  const { data: allReps, error } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, role')
    .eq('tenant_id', tenantId)
    .in('role', allRoles)
    .eq('is_active', true)
    .neq('role', 'master')
    .order('first_name');

  if (error) throw error;

  // Filter: include if elevated role OR assigned to this location
  return (allReps || []).filter(rep =>
    (elevatedRoles as readonly string[]).includes(rep.role) || locationUserIds.includes(rep.id)
  );
}

// Fetch project data when status is 'project'
async function fetchProjectData(pipelineEntryId: string) {
  // First find the project linked to this pipeline entry
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select(`
      *,
      estimates(*),
      project_costs(*),
      project_budget_snapshots(*)
    `)
    .eq('pipeline_entry_id', pipelineEntryId)
    .maybeSingle();

  if (projErr || !project) return null;

  // Fetch budget items and commission in parallel
  const [budgetItemsResult, commissionResult] = await Promise.all([
    supabase
      .from('project_budget_items')
      .select('*')
      .eq('project_id', project.id)
      .order('category, item_name'),
    (async () => {
      // Get the sales rep from pipeline entry for commission calc
      const { data: entry } = await supabase
        .from('pipeline_entries')
        .select('assigned_to')
        .eq('id', pipelineEntryId)
        .maybeSingle();
      
      if (!entry?.assigned_to) return null;
      
      const { data } = await supabase.rpc('calculate_enhanced_rep_commission', {
        project_id_param: project.id,
        sales_rep_id_param: entry.assigned_to
      });
      return data;
    })()
  ]);

  return {
    project,
    budgetItems: budgetItemsResult.data || [],
    commission: commissionResult,
    estimate: project.estimates?.[0] || null,
    costs: project.project_costs || [],
    budgetSnapshot: project.project_budget_snapshots?.[0] || null,
  };
}

export interface ProjectData {
  project: any;
  budgetItems: any[];
  commission: any;
  estimate: any;
  costs: any[];
  budgetSnapshot: any;
}

// Main hook - fetches ALL data in PARALLEL with caching
export function useLeadDetails(id: string | undefined) {
  const queryClient = useQueryClient();

  // Lead details - primary data
  const leadQuery = useQuery({
    queryKey: ['lead', id],
    queryFn: () => fetchLeadDetails(id!),
    enabled: !!id,
    staleTime: 30000,
  });

  const tenantId = leadQuery.data?.tenant_id;
  const leadStatus = leadQuery.data?.status;

  // Dynamic requirements - fetched after we have tenant_id
  const dynamicRequirementsQuery = useQuery({
    queryKey: ['lead-dynamic-requirements', id, tenantId],
    queryFn: () => fetchDynamicRequirements(tenantId!, id!),
    enabled: !!id && !!tenantId,
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

  // Sales reps - fetch based on lead's tenant AND location
  const locationId = leadQuery.data?.location_id;
  const salesRepsQuery = useQuery({
    queryKey: ['sales-reps', tenantId, locationId],
    queryFn: () => fetchSalesReps(tenantId || null, locationId),
    enabled: !!tenantId,
    staleTime: 300000,
  });

  // Project data - only fetch when status is 'project'
  const projectDataQuery = useQuery({
    queryKey: ['lead-project-data', id],
    queryFn: () => fetchProjectData(id!),
    enabled: !!id && leadStatus === 'project',
    staleTime: 30000,
  });

  // Refetch functions
  const refetchRequirements = () => dynamicRequirementsQuery.refetch();
  const refetchPhotos = () => photosQuery.refetch();
  const refetchLead = () => leadQuery.refetch();
  const refetchProjectData = () => projectDataQuery.refetch();

  // Check if any critical data is still loading
  const isLoading = leadQuery.isLoading;
  const isLoadingAll = leadQuery.isLoading || dynamicRequirementsQuery.isLoading || photosQuery.isLoading;

  return {
    // Data
    lead: leadQuery.data,
    // Legacy requirements for backward compatibility
    requirements: dynamicRequirementsQuery.data?.legacy || {
      hasContract: false,
      hasEstimate: false,
      hasMaterials: false,
      hasLabor: false,
      allComplete: false
    },
    // New dynamic requirements
    dynamicRequirements: dynamicRequirementsQuery.data?.requirements || [],
    photos: photosQuery.data || [],
    productionStage: productionStageQuery.data,
    salesReps: salesRepsQuery.data || [],
    // Project data (null if not in project status)
    projectData: projectDataQuery.data as ProjectData | null | undefined,

    // Loading states
    isLoading,
    isLoadingAll,
    isLoadingLead: leadQuery.isLoading,
    isLoadingRequirements: dynamicRequirementsQuery.isLoading,
    isLoadingPhotos: photosQuery.isLoading,
    isLoadingProjectData: projectDataQuery.isLoading,
    
    // Refetch functions
    refetchRequirements,
    refetchPhotos,
    refetchLead,
    refetchProjectData,
    refetchAll: () => {
      refetchLead();
      refetchRequirements();
      refetchPhotos();
      productionStageQuery.refetch();
      if (leadStatus === 'project') projectDataQuery.refetch();
    }
  };
}

// Prefetch function for hover prefetching
export function usePrefetchLeadDetails() {
  const queryClient = useQueryClient();

  return (id: string) => {
    // Prefetch lead data
    queryClient.prefetchQuery({
      queryKey: ['lead', id],
      queryFn: () => fetchLeadDetails(id),
      staleTime: 30000,
    });
    queryClient.prefetchQuery({
      queryKey: ['lead-photos', id],
      queryFn: () => fetchPhotos(id),
      staleTime: 30000,
    });
  };
}
