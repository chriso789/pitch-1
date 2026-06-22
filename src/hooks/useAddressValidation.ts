// PR #3: React hook for canonical address validation
import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type AddressValidationStatus =
  | 'unvalidated'
  | 'valid'
  | 'needs_review'
  | 'invalid'
  | 'override_accepted';

export interface ValidateAddressInput {
  tenant_id: string;
  source_entity_type:
    | 'contact'
    | 'company'
    | 'pipeline_entry'
    | 'project'
    | 'order'
    | 'permit'
    | 'measurement_request';
  source_entity_id: string;
  raw_input?: string;
  address_lines?: string[];
  locality?: string;
  administrative_area?: string;
  postal_code?: string;
  country_code?: string;
  place_id?: string;
  session_token?: string;
  force_revalidate?: boolean;
}

export interface ValidateAddressResult {
  property_address_id: string;
  validation_status: AddressValidationStatus;
  formatted_address: string | null;
  decision_reason: string;
  missing_component_types: string[];
  unresolved_tokens: string[];
  latitude: number | null;
  longitude: number | null;
  place_id: string | null;
}

export function useAddressValidation() {
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<ValidateAddressResult | null>(null);

  const validate = useCallback(
    async (input: ValidateAddressInput): Promise<ValidateAddressResult | null> => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('validate-property-address', {
          body: input,
        });
        if (error) throw error;
        if (!data || data.error) throw new Error(data?.error ?? 'validation_failed');
        setLastResult(data as ValidateAddressResult);
        return data as ValidateAddressResult;
      } catch (e: any) {
        console.error('useAddressValidation', e);
        toast.error(`Address validation failed: ${e.message ?? e}`);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const requireProductionReady = useCallback(
    async (
      tenant_id: string,
      source_entity_type: ValidateAddressInput['source_entity_type'],
      source_entity_id: string,
    ): Promise<{ ready: boolean; status: AddressValidationStatus | null }> => {
      const { data, error } = await supabase
        .from('property_addresses')
        .select('validation_status')
        .eq('tenant_id', tenant_id)
        .eq('source_entity_type', source_entity_type)
        .eq('source_entity_id', source_entity_id)
        .is('archived_at', null)
        .maybeSingle();
      if (error) return { ready: false, status: null };
      const status = (data?.validation_status ?? null) as AddressValidationStatus | null;
      return {
        ready: status === 'valid' || status === 'override_accepted',
        status,
      };
    },
    [],
  );

  return { validate, requireProductionReady, loading, lastResult };
}
