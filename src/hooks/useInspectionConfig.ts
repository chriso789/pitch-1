import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { INSPECTION_STEPS } from '@/components/inspection/inspectionSteps';
import { toast } from 'sonner';

export interface InspectionStepConfig {
  id: string;
  tenant_id: string;
  step_key: string;
  title: string;
  description: string | null;
  guidance: string[];
  is_required: boolean;
  min_photos: number;
  order_index: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const DEFAULT_SEED: Omit<InspectionStepConfig, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>[] =
  INSPECTION_STEPS.map((s, i) => ({
    step_key: s.id,
    title: s.title,
    description: s.description,
    guidance: s.guidance,
    is_required: false,
    min_photos: 0,
    order_index: i,
    is_active: true,
  }));

async function seedDefaults(tenantId: string): Promise<InspectionStepConfig[]> {
  const rows = DEFAULT_SEED.map((s) => ({ ...s, tenant_id: tenantId }));
  const { data, error } = await supabase
    .from('inspection_step_configs' as any)
    .insert(rows as any)
    .select() as any;
  if (error) throw error;
  return data as InspectionStepConfig[];
}

export function useInspectionConfig() {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const queryKey = ['inspection-config', tenantId];

  const { data: steps = [], isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from('inspection_step_configs' as any)
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('order_index', { ascending: true }) as any;
      if (error) throw error;
      let configs = data as InspectionStepConfig[];
      if (configs.length === 0) {
        configs = await seedDefaults(tenantId);
      }
      return configs.filter((c) => c.is_active).sort((a, b) => a.order_index - b.order_index);
    },
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
  });

  // Fallback to hardcoded steps for the walkthrough if loading or no DB rows
  const activeSteps = steps.length > 0
    ? steps.map((s) => ({
        id: s.step_key,
        title: s.title,
        description: s.description || '',
        guidance: s.guidance || [],
        is_required: s.is_required,
        min_photos: s.min_photos,
      }))
    : INSPECTION_STEPS.map((s) => ({
        ...s,
        is_required: false,
        min_photos: 0,
      }));

  return { steps, activeSteps, isLoading, error, queryKey, tenantId };
}

export function useInspectionConfigMutations() {
  const queryClient = useQueryClient();
  const tenantId = useEffectiveTenantId();
  const queryKey = ['inspection-config', tenantId];

  const updateStep = useMutation({
    mutationFn: async (step: Partial<InspectionStepConfig> & { id: string }) => {
      const { id, ...updates } = step;
      const { error } = await supabase
        .from('inspection_step_configs' as any)
        .update(updates as any)
        .eq('id', id) as any;
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const addStep = useMutation({
    mutationFn: async (step: { title: string; description: string; guidance: string[]; is_required: boolean; min_photos: number; order_index: number }) => {
      if (!tenantId) throw new Error('No tenant');
      const key = `custom_${Date.now()}`;
      const { error } = await supabase
        .from('inspection_step_configs' as any)
        .insert({ ...step, tenant_id: tenantId, step_key: key } as any) as any;
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const deleteStep = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('inspection_step_configs' as any)
        .update({ is_active: false } as any)
        .eq('id', id) as any;
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const reorderSteps = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const updates = orderedIds.map((id, i) =>
        supabase
          .from('inspection_step_configs' as any)
          .update({ order_index: i } as any)
          .eq('id', id) as any
      );
      await Promise.all(updates);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const resetToDefaults = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error('No tenant');
      // Deactivate all existing
      await supabase
        .from('inspection_step_configs' as any)
        .update({ is_active: false } as any)
        .eq('tenant_id', tenantId) as any;
      // Re-seed
      await seedDefaults(tenantId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Reset to default steps');
    },
  });

  return { updateStep, addStep, deleteStep, reorderSteps, resetToDefaults };
}
