import { useMutation, useQuery } from '@tanstack/react-query';
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
        body: { action: 'get-pricing', pricingInput: input },
      });

      if (error) throw error;
      return data as { good: TierPricing; better: TierPricing; best: TierPricing };
    },
  });
}

export function useGenerateProposal() {
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
      const { data, error } = await supabase.functions.invoke('generate-proposal', {
        body: {
          action: 'generate',
          projectId,
          pricingInput,
          scopeOfWork,
          coverPhotoUrl,
        },
      });

      if (error) throw error;
      return data as ProposalData;
    },
  });
}

export function useProposalPreview(estimateId: string | undefined) {
  return useQuery({
    queryKey: ['proposal-preview', estimateId],
    queryFn: async () => {
      if (!estimateId) throw new Error('No estimate ID');

      const { data, error } = await supabase.functions.invoke('generate-proposal', {
        body: { action: 'preview', estimateId },
      });

      if (error) throw error;
      return data as { html: string };
    },
    enabled: !!estimateId,
  });
}

export function useSendProposal() {
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
          estimateId,
          recipientEmail,
          recipientName,
          customMessage,
        },
      });

      if (error) throw error;
      return data as { shareUrl: string; sent: boolean };
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
