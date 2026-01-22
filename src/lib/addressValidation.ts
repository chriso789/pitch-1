import { supabase } from '@/integrations/supabase/client';
import { AddressComponents } from '@/components/AddressAutocomplete';

export interface ValidatedAddressData {
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  latitude?: number;
  longitude?: number;
  formatted_address: string;
  place_id?: string;
  address_components: AddressComponents;
  validation_score?: number;
}

/**
 * Saves validated address data to a contact record
 */
export async function saveValidatedAddress(
  contactId: string,
  addressData: ValidatedAddressData
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('contacts')
      .update({
        address_street: addressData.address_line1,
        address_street_2: addressData.address_line2 || null,
        address_city: addressData.city,
        address_state: addressData.state,
        address_zip: addressData.zip_code,
        latitude: addressData.latitude,
        longitude: addressData.longitude,
        google_place_id: addressData.place_id,
        address_components: addressData.address_components as any,
        address_validated: true,
        address_validated_at: new Date().toISOString(),
        address_validation_score: addressData.validation_score || null,
      })
      .eq('id', contactId);

    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error('Error saving validated address:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Calls the Google Address Validation edge function for enhanced validation
 */
export async function validateAddressWithGoogle(
  address: string
): Promise<{
  success: boolean;
  validation?: {
    isValid: boolean;
    hasUnconfirmedComponents: boolean;
    hasInferredComponents: boolean;
    geocodeGranularity: string;
    formattedAddress?: string;
    components?: Record<string, string>;
    geocode?: { latitude: number; longitude: number };
  };
  error?: string;
}> {
  try {
    const { data, error } = await supabase.functions.invoke('google-address-validation', {
      body: { address, enableUspsCass: true }
    });

    if (error) throw error;

    if (!data?.validation) {
      return { success: false, error: 'No validation data returned' };
    }

    return {
      success: true,
      validation: {
        isValid: data.validation.isValid,
        hasUnconfirmedComponents: data.validation.hasUnconfirmedComponents,
        hasInferredComponents: data.validation.hasInferredComponents,
        geocodeGranularity: data.validation.geocodeGranularity,
        formattedAddress: data.address?.formattedAddress,
        components: data.address?.addressComponents,
        geocode: data.geocode?.location
          ? {
              latitude: data.geocode.location.latitude,
              longitude: data.geocode.location.longitude,
            }
          : undefined,
      },
    };
  } catch (error: any) {
    console.error('Address validation error:', error);
    return { success: false, error: error.message };
  }
}
