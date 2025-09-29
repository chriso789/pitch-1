import React, { useState, useEffect, useRef } from 'react';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MapPin, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

declare global {
  interface Window {
    google: any;
  }
}

interface AddressValidationProps {
  onAddressSelected: (address: StructuredAddress) => void;
  defaultValue?: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
}

interface StructuredAddress {
  street_number: string;
  route: string;
  locality: string;
  administrative_area_level_1: string;
  postal_code: string;
  country: string;
  formatted_address: string;
  latitude: number;
  longitude: number;
  place_id: string;
  validated: boolean;
  validation_status: 'valid' | 'partial' | 'invalid' | 'unverified';
}

export const AddressValidation: React.FC<AddressValidationProps> = ({
  onAddressSelected,
  defaultValue = '',
  label = 'Address',
  placeholder = 'Start typing address...',
  required = false
}) => {
  const [inputValue, setInputValue] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [validated, setValidated] = useState(false);
  const [validationStatus, setValidationStatus] = useState<'valid' | 'partial' | 'invalid' | 'unverified'>('unverified');
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteService = useRef<any>(null);
  const placesService = useRef<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    // Initialize Google Places API
    if (window.google?.maps?.places) {
      autocompleteService.current = new window.google.maps.places.AutocompleteService();
      placesService.current = new window.google.maps.places.PlacesService(document.createElement('div'));
    } else {
      // Load Google Maps API if not already loaded
      loadGoogleMapsAPI();
    }
  }, []);

  const loadGoogleMapsAPI = () => {
    if (!window.google) {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&libraries=places`;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        autocompleteService.current = new window.google.maps.places.AutocompleteService();
        placesService.current = new window.google.maps.places.PlacesService(document.createElement('div'));
      };
      document.head.appendChild(script);
    }
  };

  const handleInputChange = async (value: string) => {
    setInputValue(value);
    setValidated(false);
    setValidationStatus('unverified');

    if (value.length < 3) {
      setSuggestions([]);
      return;
    }

    if (autocompleteService.current) {
      autocompleteService.current.getPlacePredictions(
        {
          input: value,
          types: ['address'],
          componentRestrictions: { country: 'us' }
        },
        (predictions: any[], status: any) => {
          if (status === window.google.maps.places.PlacesServiceStatus.OK && predictions) {
            setSuggestions(predictions.slice(0, 5));
          } else {
            setSuggestions([]);
          }
        }
      );
    }
  };

  const selectAddress = (prediction: any) => {
    setLoading(true);
    setSuggestions([]);

    if (placesService.current) {
      placesService.current.getDetails(
        {
          placeId: prediction.place_id,
          fields: ['address_components', 'formatted_address', 'geometry', 'place_id']
        },
        async (place: any, status: any) => {
          if (status === window.google.maps.places.PlacesServiceStatus.OK && place) {
            const structuredAddress = await parseGooglePlace(place);
            
            // Validate with Google Address Validation API
            const validatedAddress = await validateWithGoogleAPI(structuredAddress);
            
            setInputValue(validatedAddress.formatted_address);
            setValidated(true);
            setValidationStatus(validatedAddress.validation_status);
            onAddressSelected(validatedAddress);
          }
          setLoading(false);
        }
      );
    }
  };

  const parseGooglePlace = async (place: any): Promise<StructuredAddress> => {
    const components: any = {};
    
    place.address_components?.forEach((component: any) => {
      const types = component.types;
      if (types.includes('street_number')) {
        components.street_number = component.long_name;
      }
      if (types.includes('route')) {
        components.route = component.long_name;
      }
      if (types.includes('locality')) {
        components.locality = component.long_name;
      }
      if (types.includes('administrative_area_level_1')) {
        components.administrative_area_level_1 = component.short_name;
      }
      if (types.includes('postal_code')) {
        components.postal_code = component.long_name;
      }
      if (types.includes('country')) {
        components.country = component.short_name;
      }
    });

    return {
      street_number: components.street_number || '',
      route: components.route || '',
      locality: components.locality || '',
      administrative_area_level_1: components.administrative_area_level_1 || '',
      postal_code: components.postal_code || '',
      country: components.country || 'US',
      formatted_address: place.formatted_address || '',
      latitude: place.geometry?.location?.lat() || 0,
      longitude: place.geometry?.location?.lng() || 0,
      place_id: place.place_id || '',
      validated: false,
      validation_status: 'unverified'
    };
  };

  const validateWithGoogleAPI = async (address: StructuredAddress): Promise<StructuredAddress> => {
    try {
      const { data, error } = await supabase.functions.invoke('google-address-validation', {
        body: { address: address.formatted_address }
      });

      if (error) {
        console.warn('Address validation failed:', error);
        return { ...address, validation_status: 'unverified' };
      }

      const result = data?.result;
      if (result?.verdict?.addressComplete && result?.verdict?.hasUnconfirmedComponents === false) {
        return {
          ...address,
          validated: true,
          validation_status: 'valid',
          // Update with corrected address if available
          formatted_address: result.address?.formattedAddress || address.formatted_address
        };
      } else if (result?.verdict?.addressComplete) {
        return { ...address, validated: true, validation_status: 'partial' };
      } else {
        return { ...address, validated: false, validation_status: 'invalid' };
      }
    } catch (error) {
      console.warn('Address validation error:', error);
      return { ...address, validation_status: 'unverified' };
    }
  };

  const getValidationBadge = () => {
    if (!validated && validationStatus === 'unverified') return null;
    
    switch (validationStatus) {
      case 'valid':
        return (
          <Badge variant="default" className="bg-green-100 text-green-800 border-green-200">
            <CheckCircle className="h-3 w-3 mr-1" />
            Verified
          </Badge>
        );
      case 'partial':
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-200">
            <AlertCircle className="h-3 w-3 mr-1" />
            Partial Match
          </Badge>
        );
      case 'invalid':
        return (
          <Badge variant="destructive">
            <AlertCircle className="h-3 w-3 mr-1" />
            Invalid
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-2 relative">
      <div className="flex items-center gap-2">
        <Label htmlFor="address">{label}</Label>
        {required && <span className="text-destructive">*</span>}
        {getValidationBadge()}
      </div>
      
      <div className="relative">
        <Input
          ref={inputRef}
          id="address"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder={placeholder}
          className={validated 
            ? validationStatus === 'valid' 
              ? 'border-green-500 focus:border-green-500' 
              : validationStatus === 'invalid'
              ? 'border-red-500 focus:border-red-500'
              : 'border-yellow-500 focus:border-yellow-500'
            : ''
          }
          disabled={loading}
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {suggestions.length > 0 && (
        <Card className="absolute top-full left-0 right-0 z-50 border shadow-lg">
          <CardContent className="p-0">
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.place_id}
                onClick={() => selectAddress(suggestion)}
                className="w-full p-3 text-left hover:bg-muted transition-colors flex items-start gap-2 border-b last:border-b-0"
              >
                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-medium text-sm">
                    {suggestion.structured_formatting?.main_text || suggestion.description}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {suggestion.structured_formatting?.secondary_text || ''}
                  </div>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
};