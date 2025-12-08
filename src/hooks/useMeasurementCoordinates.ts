import { useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type CoordinateSource = 
  | 'user_pin_selection'
  | 'contact_verified_address'
  | 'contact_lat_lng'
  | 'pipeline_metadata'
  | 'geocoded_from_address'
  | 'props_fallback'
  | 'unknown';

export interface MeasurementCoordinates {
  lat: number;
  lng: number;
  source: CoordinateSource;
  accuracy: 'high' | 'medium' | 'low';
  isValid: boolean;
}

interface UseMeasurementCoordinatesOptions {
  pipelineEntryId?: string;
  propLat?: number;
  propLng?: number;
  address?: string;
}

/**
 * Single source of truth for measurement coordinates
 * Priority order:
 * 1. User-selected PIN from StructureSelectionMap (highest accuracy)
 * 2. Contact verified_address from Google Places API
 * 3. Contact latitude/longitude (legacy)
 * 4. Pipeline metadata coordinates
 * 5. Geocoded from address string
 * 6. Props passed to component (lowest accuracy)
 */
export function useMeasurementCoordinates(options: UseMeasurementCoordinatesOptions) {
  const { pipelineEntryId, propLat, propLng, address } = options;
  
  // User-confirmed PIN coordinates (highest priority)
  const [confirmedCoords, setConfirmedCoords] = useState<{
    lat: number;
    lng: number;
    source: 'user_pin_selection';
  } | null>(null);
  
  // Loaded coordinates from database
  const [loadedCoords, setLoadedCoords] = useState<MeasurementCoordinates | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Set user-confirmed PIN coordinates (highest priority)
   * Called when user confirms structure in StructureSelectionMap
   */
  const setUserPinCoordinates = useCallback((lat: number, lng: number) => {
    console.log('📍 User confirmed PIN coordinates:', { lat, lng });
    setConfirmedCoords({ lat, lng, source: 'user_pin_selection' });
  }, []);

  /**
   * Clear user-confirmed coordinates
   */
  const clearUserPinCoordinates = useCallback(() => {
    setConfirmedCoords(null);
  }, []);

  /**
   * Load coordinates from database with priority fallbacks
   */
  const loadCoordinates = useCallback(async (): Promise<MeasurementCoordinates> => {
    if (!pipelineEntryId) {
      // Use prop coordinates if no pipeline entry
      if (propLat && propLng && propLat !== 0 && propLng !== 0) {
        return {
          lat: propLat,
          lng: propLng,
          source: 'props_fallback',
          accuracy: 'low',
          isValid: true,
        };
      }
      return { lat: 0, lng: 0, source: 'unknown', accuracy: 'low', isValid: false };
    }

    setIsLoading(true);
    setError(null);

    try {
      // Fetch pipeline entry with contact data
      const { data: pipelineData, error: fetchError } = await supabase
        .from('pipeline_entries')
        .select('contact_id, metadata, contacts!inner(verified_address, latitude, longitude, address_street, address_city, address_state, address_zip)')
        .eq('id', pipelineEntryId)
        .single();

      if (fetchError) {
        console.error('Failed to fetch pipeline data:', fetchError);
        throw new Error('Could not load property coordinates');
      }

      const contactsData = (pipelineData as any)?.contacts;
      const contact = Array.isArray(contactsData) ? contactsData[0] : contactsData;
      const metadata = (pipelineData as any)?.metadata;

      let result: MeasurementCoordinates = { lat: 0, lng: 0, source: 'unknown', accuracy: 'low', isValid: false };

      // Priority #1: Contact verified_address (Google-verified, highest accuracy)
      if (contact?.verified_address?.lat && contact?.verified_address?.lng) {
        result = {
          lat: contact.verified_address.lat,
          lng: contact.verified_address.lng,
          source: 'contact_verified_address',
          accuracy: 'high',
          isValid: true,
        };
        console.log('📍 Using verified_address coordinates (Priority 1):', result);
      }
      // Priority #2: Contact latitude/longitude (legacy)
      else if (contact?.latitude && contact?.longitude) {
        result = {
          lat: contact.latitude,
          lng: contact.longitude,
          source: 'contact_lat_lng',
          accuracy: 'medium',
          isValid: true,
        };
        console.log('📍 Using contact lat/lng coordinates (Priority 2):', result);
      }
      // Priority #3: Pipeline metadata verified_address.geometry.location
      else if (metadata?.verified_address?.geometry?.location?.lat && metadata?.verified_address?.geometry?.location?.lng) {
        result = {
          lat: metadata.verified_address.geometry.location.lat,
          lng: metadata.verified_address.geometry.location.lng,
          source: 'pipeline_metadata',
          accuracy: 'medium',
          isValid: true,
        };
        console.log('📍 Using pipeline metadata coordinates (Priority 3):', result);
      }
      // Priority #4: Pipeline metadata verified_address (flat structure)
      else if (metadata?.verified_address?.lat && metadata?.verified_address?.lng) {
        result = {
          lat: metadata.verified_address.lat,
          lng: metadata.verified_address.lng,
          source: 'pipeline_metadata',
          accuracy: 'medium',
          isValid: true,
        };
        console.log('📍 Using pipeline metadata flat coordinates (Priority 4):', result);
      }
      // Priority #5: Props fallback
      else if (propLat && propLng && propLat !== 0 && propLng !== 0) {
        result = {
          lat: propLat,
          lng: propLng,
          source: 'props_fallback',
          accuracy: 'low',
          isValid: true,
        };
        console.log('📍 Using props coordinates (Priority 5):', result);
      }
      // Priority #6: Geocode from address
      else {
        const addressToGeocode = 
          metadata?.verified_address?.formatted_address ||
          (contact?.address_street && contact?.address_city && contact?.address_state 
            ? `${contact.address_street}, ${contact.address_city}, ${contact.address_state} ${contact.address_zip || ''}`
            : address);

        if (addressToGeocode) {
          console.log('📍 Geocoding address:', addressToGeocode);
          
          const { data: geocodeData, error: geocodeError } = await supabase.functions.invoke('google-maps-proxy', {
            body: {
              endpoint: 'geocode',
              params: { address: addressToGeocode }
            }
          });

          if (!geocodeError && geocodeData?.results?.[0]?.geometry?.location) {
            result = {
              lat: geocodeData.results[0].geometry.location.lat,
              lng: geocodeData.results[0].geometry.location.lng,
              source: 'geocoded_from_address',
              accuracy: 'medium',
              isValid: true,
            };
            console.log('📍 Geocoded coordinates (Priority 6):', result);

            // Save geocoded coordinates to contact for future use
            if (pipelineData?.contact_id) {
              supabase
                .from('contacts')
                .update({ latitude: result.lat, longitude: result.lng })
                .eq('id', pipelineData.contact_id)
                .then(({ error }) => {
                  if (error) console.error('Failed to save geocoded coordinates:', error);
                  else console.log('💾 Saved geocoded coordinates to contact');
                });
            }
          }
        }
      }

      setLoadedCoords(result);
      return result;
    } catch (err: any) {
      setError(err.message);
      console.error('Coordinate loading error:', err);
      return { lat: 0, lng: 0, source: 'unknown', accuracy: 'low', isValid: false };
    } finally {
      setIsLoading(false);
    }
  }, [pipelineEntryId, propLat, propLng, address]);

  /**
   * Get the active coordinates with priority:
   * 1. User-confirmed PIN (if set)
   * 2. Loaded coordinates from database
   * 3. Prop coordinates as fallback
   */
  const activeCoordinates = useMemo((): MeasurementCoordinates => {
    // Priority 1: User-confirmed PIN coordinates
    if (confirmedCoords) {
      return {
        lat: confirmedCoords.lat,
        lng: confirmedCoords.lng,
        source: 'user_pin_selection',
        accuracy: 'high',
        isValid: true,
      };
    }

    // Priority 2: Loaded coordinates
    if (loadedCoords?.isValid) {
      return loadedCoords;
    }

    // Priority 3: Prop fallback
    if (propLat && propLng && propLat !== 0 && propLng !== 0) {
      return {
        lat: propLat,
        lng: propLng,
        source: 'props_fallback',
        accuracy: 'low',
        isValid: true,
      };
    }

    return { lat: 0, lng: 0, source: 'unknown', accuracy: 'low', isValid: false };
  }, [confirmedCoords, loadedCoords, propLat, propLng]);

  return {
    // Active coordinates (single source of truth)
    coordinates: activeCoordinates,
    lat: activeCoordinates.lat,
    lng: activeCoordinates.lng,
    source: activeCoordinates.source,
    accuracy: activeCoordinates.accuracy,
    isValid: activeCoordinates.isValid,
    
    // User PIN management
    hasUserPinSelection: !!confirmedCoords,
    setUserPinCoordinates,
    clearUserPinCoordinates,
    
    // Loading state
    isLoading,
    error,
    loadCoordinates,
    
    // Raw loaded coordinates (before user override)
    loadedCoordinates: loadedCoords,
  };
}
