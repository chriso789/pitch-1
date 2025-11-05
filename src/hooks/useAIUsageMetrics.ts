import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

async function getTenantId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  return profile?.tenant_id || null;
}

export interface AIUsageStats {
  total_requests: number;
  total_tokens: number;
  total_cost_usd: number;
  avg_response_time_ms: number;
  success_rate: number;
  by_provider: Array<{
    provider: string;
    requests: number;
    tokens: number;
    cost_usd: number;
  }>;
  by_feature: Array<{
    feature: string;
    requests: number;
    avg_response_time: number;
  }>;
}

export interface AIUsageMetric {
  id: string;
  created_at: string;
  provider: string;
  model: string;
  feature: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  response_time_ms: number;
  status: string;
  estimated_cost_usd: number;
}

export const useAIUsageMetrics = (hoursBack: number = 24) => {
  return useQuery({
    queryKey: ['ai-usage-metrics', hoursBack],
    queryFn: async () => {
      const tenantId = await getTenantId();
      if (!tenantId) throw new Error('No tenant ID');

      const { data, error } = await supabase.rpc('get_ai_usage_stats', {
        p_tenant_id: tenantId,
        p_hours_back: hoursBack
      });

      if (error) throw error;
      return data as unknown as AIUsageStats;
    },
    refetchInterval: 30000, // Refresh every 30 seconds for near real-time
  });
};

export const useAIUsageHistory = (limit: number = 100) => {
  return useQuery({
    queryKey: ['ai-usage-history', limit],
    queryFn: async () => {
      const tenantId = await getTenantId();
      if (!tenantId) throw new Error('No tenant ID');

      const { data, error } = await supabase
        .from('ai_usage_metrics')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data as AIUsageMetric[];
    },
    refetchInterval: 30000,
  });
};

export const useAIUsageTimeSeries = (hoursBack: number = 24) => {
  return useQuery({
    queryKey: ['ai-usage-timeseries', hoursBack],
    queryFn: async () => {
      const tenantId = await getTenantId();
      if (!tenantId) throw new Error('No tenant ID');

      const { data, error } = await supabase
        .from('ai_usage_summary')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('hour', new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString())
        .order('hour', { ascending: true });

      if (error) throw error;
      return data;
    },
    refetchInterval: 60000, // Refresh every minute
  });
};
