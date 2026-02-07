import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

export interface PipelineStage {
  id: string;
  name: string;
  key: string;
  color: string;
  description: string | null;
  probability_percent: number;
  stage_order: number;
  is_active: boolean;
}

// Default fallback stages (used when no custom stages exist)
export const DEFAULT_STAGES: PipelineStage[] = [
  { id: 'default-1', name: 'New Lead', key: 'new_lead', color: 'bg-blue-500', description: null, probability_percent: 10, stage_order: 1, is_active: true },
  { id: 'default-2', name: 'Contacted', key: 'contacted', color: 'bg-yellow-500', description: null, probability_percent: 25, stage_order: 2, is_active: true },
  { id: 'default-3', name: 'Qualified', key: 'qualified', color: 'bg-orange-500', description: null, probability_percent: 50, stage_order: 3, is_active: true },
  { id: 'default-4', name: 'Proposal Sent', key: 'proposal_sent', color: 'bg-purple-500', description: null, probability_percent: 70, stage_order: 4, is_active: true },
  { id: 'default-5', name: 'Negotiating', key: 'negotiating', color: 'bg-cyan-500', description: null, probability_percent: 80, stage_order: 5, is_active: true },
  { id: 'default-6', name: 'Closed Won', key: 'closed_won', color: 'bg-green-500', description: null, probability_percent: 100, stage_order: 6, is_active: true },
  { id: 'default-7', name: 'Closed Lost', key: 'closed_lost', color: 'bg-gray-500', description: null, probability_percent: 0, stage_order: 7, is_active: true },
];

// Convert hex color to Tailwind class
function hexToTailwindColor(hex: string): string {
  const colorMap: Record<string, string> = {
    '#3b82f6': 'bg-blue-500',
    '#22c55e': 'bg-green-500',
    '#eab308': 'bg-yellow-500',
    '#f59e0b': 'bg-amber-500',
    '#ef4444': 'bg-red-500',
    '#8b5cf6': 'bg-violet-500',
    '#06b6d4': 'bg-cyan-500',
    '#ec4899': 'bg-pink-500',
    '#6b7280': 'bg-gray-500',
    '#10b981': 'bg-emerald-500',
    '#f97316': 'bg-orange-500',
    '#a855f7': 'bg-purple-500',
  };
  
  return colorMap[hex?.toLowerCase()] || `bg-[${hex}]`;
}

// Generate a URL-safe key from stage name
function generateStageKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .trim();
}

export function usePipelineStages() {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['pipeline-stages', tenantId],
    queryFn: async (): Promise<PipelineStage[]> => {
      if (!tenantId) return DEFAULT_STAGES;

      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('stage_order', { ascending: true });

      if (error) {
        console.error('Error fetching pipeline stages:', error);
        return DEFAULT_STAGES;
      }

      if (!data || data.length === 0) {
        return DEFAULT_STAGES;
      }

      return data.map(stage => ({
        id: stage.id,
        name: stage.name,
        // Use database key if set, otherwise fallback to auto-generated
        key: stage.key || generateStageKey(stage.name),
        color: hexToTailwindColor(stage.color),
        description: stage.description,
        probability_percent: stage.probability_percent,
        stage_order: stage.stage_order,
        is_active: stage.is_active,
      }));
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes in cache
    enabled: !!tenantId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['pipeline-stages'] });
  };

  return {
    stages: query.data || DEFAULT_STAGES,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    invalidate,
    refetch: query.refetch,
  };
}
