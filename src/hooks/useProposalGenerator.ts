import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { supabase } from '@/integrations/supabase/client';

export interface TierPricing {
  tierName: 'good' | 'better' | 'best';
  materialCost: number;
  laborCost: number;
  overhead: number;
  profit: number;
  subtotal: number;
  tax: number;
  total: number;
  pricePerSquare: number;
  warranty: { years: number; type: string };
  financing: FinancingOption[];
}

export interface FinancingOption {
  name: string;
  termMonths: number;
  apr: number;
  monthlyPayment: number;
  downPayment: number;
  totalCost: number;
}

export interface PricingInput {
  roofArea: number;
  pitch: string;
  complexity: 'simple' | 'moderate' | 'complex';
  stories: number;
  materialType?: string;
  wastePercentage?: number;
  overheadPercentage?: number;
  profitMargins?: { good: number; better: number; best: number };
  linearMeasurements?: Partial<Record<'ridge' | 'hip' | 'valley' | 'eave' | 'rake', number>>;
}

export interface ProposalData {
  estimateId: string;
  projectId: string;
  contactId: string;
  selectedTier?: 'good' | 'better' | 'best';
  tiers: {
    good: TierPricing;
    better: TierPricing;
    best: TierPricing;
  };
  shareToken: string;
  shareUrl: string;
}

export function useCalculatePricing() {
  return useMutation({
    mutationFn: async (input: PricingInput) => {
      const { data, error } = await supabase.functions.invoke('generate-proposal', {
        body: { action: 'get-pricing', pricingInput: pricingPayload(input) },
      });

      if (error) throw error;
      if (!data?.ok || !data?.data?.tiers) throw new Error(data?.error || 'Pricing failed');
      return Object.fromEntries(Object.entries(data.data.tiers).map(([key, tier]: [string, any]) => [tier.tier, {
        tierName: tier.tier, materialCost: tier.materialSubtotal, laborCost: tier.laborSubtotal, overhead: tier.overhead,
        profit: tier.profitAmount, subtotal: tier.subtotal, tax: 0, total: tier.totalPrice, pricePerSquare: tier.pricePerSquare,
        warranty: tier.warranty, financing: (tier.financing || []).map((f: any) => ({ name: f.provider, termMonths: f.termMonths,
          apr: f.aprPercent, monthlyPayment: f.monthlyPayment, downPayment: f.downPayment, totalCost: f.totalFinanced })),
      }])) as { good: TierPricing; better: TierPricing; best: TierPricing };
    },
  });
}

export function useGenerateProposal() {
  const tenantId = useEffectiveTenantId();
  return useMutation({
    mutationFn: async ({
      projectId,
      pricingInput,
      scopeOfWork,
      coverPhotoUrl,
    }: {
      projectId: string;
      pricingInput: PricingInput;
      scopeOfWork?: string;
      coverPhotoUrl?: string;
    }) => {
      const { data: project, error: projectError } = await supabase.from('projects').select('pipeline_entry_id').eq('id', projectId).eq('tenant_id', tenantId).single();
      if (projectError || !project?.pipeline_entry_id) throw new Error('Project must be linked to a lead');
      const { data, error } = await supabase.functions.invoke('generate-proposal', {
        body: {
          action: 'generate',
          tenantId,
          pipelineEntryId: project.pipeline_entry_id,
          pricingInput: pricingPayload(pricingInput),
          scopeOfWork,
          coverPhotoUrl,
        },
        headers: { 'x-pitch-tenant': tenantId },
      });

      if (error) throw error;
      if (!data?.ok || !data?.data?.estimateId) throw new Error(data?.error || "Proposal generation failed");
      return data.data as ProposalData;
    },
  });
}

export function useProposalPreview(estimateId: string | undefined) {
  const tenantId = useEffectiveTenantId();
  return useQuery({
    queryKey: ['proposal-preview', tenantId, estimateId],
    queryFn: async () => {
      if (!estimateId) throw new Error('No estimate ID');

      const { data, error } = await supabase.functions.invoke('generate-proposal', {
        body: { action: 'preview', estimateId },
        headers: { 'x-pitch-tenant': tenantId },
      });

      if (error) throw error;
      if (!data?.ok || !data?.data?.html) throw new Error("Preview was not generated");
      return data.data as { html: string };
    },
    enabled: !!estimateId,
  });
}

export function useSendProposal() {
  const tenantId = useEffectiveTenantId();
  return useMutation({
    mutationFn: async ({
      estimateId,
      recipientEmail,
      recipientName,
      customMessage,
    }: {
      estimateId: string;
      recipientEmail: string;
      recipientName?: string;
      customMessage?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('generate-proposal', {
        body: {
          action: 'send',
          tenantId,
          estimateId,
          recipientEmail,
          recipientName,
          customMessage,
        },
        headers: { 'x-pitch-tenant': tenantId },
      });

      if (error) throw error;
      if (!data?.ok || !data?.data?.sent) throw new Error(data?.error || 'Proposal delivery was not accepted');
      return data.data as { shareUrl: string; sent: boolean };
    },
  });
}

export function useTrackProposalEvent() {
  return useMutation({
    mutationFn: async ({
      estimateId,
      eventType,
      selectedTier,
      metadata,
    }: {
      estimateId: string;
      eventType: 'viewed' | 'tier_selected' | 'downloaded' | 'signature_started';
      selectedTier?: 'good' | 'better' | 'best';
      metadata?: Record<string, unknown>;
    }) => {
      const { data, error } = await supabase.functions.invoke('generate-proposal', {
        body: {
          action: 'track',
          estimateId,
          eventType,
          selectedTier,
          metadata,
        },
      });

      if (error) throw error;
      return data;
    },
  });
}

export function useProposalDetails(estimateId: string | undefined) {
  return useQuery({
    queryKey: ['proposal-details', estimateId],
    queryFn: async () => {
      if (!estimateId) throw new Error('No estimate ID');

      const { data, error } = await supabase
        .from('enhanced_estimates')
        .select(`
          *,
          projects (
            id,
            name,
            property_id,
            properties (
              id,
              address_line1,
              city,
              state,
              zip_code
            )
          ),
          contacts (
            id,
            first_name,
            last_name,
            email,
            phone
          )
        `)
        .eq('id', estimateId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!estimateId,
  });
}

export function useAcceptProposal() {
  return useMutation({
    mutationFn: async ({
      estimateId,
      tenantId,
      selectedTier,
      customerEmail,
      customerName,
      customerPhone,
    }: {
      estimateId: string;
      tenantId: string;
      selectedTier: 'good' | 'better' | 'best';
      customerEmail: string;
      customerName: string;
      customerPhone?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('generate-proposal', {
        body: {
          action: 'accept',
          estimateId,
          tenantId,
          selectedTier,
          customerEmail,
          customerName,
          customerPhone,
        },
      });

      if (error) throw error;
      if (!data.ok) throw new Error(data.error || 'Failed to accept proposal');
      
      return data.data as { 
        signatureUrl: string; 
        envelopeId: string;
        recipientId: string;
        accessToken: string;
        selectedTier: string;
        tierPrice: number;
      };
    },
  });
}

function pricingPayload(input: PricingInput) {
  const keys = ['ridge', 'hip', 'valley', 'eave', 'rake'] as const;
  if (!keys.every(key => Number.isFinite(input.linearMeasurements?.[key]) && input.linearMeasurements[key] >= 0)) {
    throw new Error('Enter all five roof edge measurements in feet; use 0 where an edge is absent');
  }
  return { roofAreaSqFt: input.roofArea, pitch: input.pitch, complexity: input.complexity,
    wastePercent: input.wastePercentage ?? 10, overhead: (input.overheadPercentage ?? 15) / 100,
    linearMeasurements: input.linearMeasurements };
}
