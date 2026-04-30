import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, AlertCircle, MapPin, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface AddressData {
  street: string;
  city: string;
  state: string;
  zip: string;
  lat?: number;
  lng?: number;
  place_id?: string;
  formatted_address?: string;
}

interface AddressVerificationProps {
  onAddressVerified: (address: AddressData, verificationData: any) => void;
  initialAddress?: Partial<AddressData>;
  label?: string;
  required?: boolean;
}

const parseGoogleAddress = (place: any, fallbackText = ""): AddressData => {
  const formatted = place?.formatted_address || fallbackText;
  const addressComponents = place?.address_components || [];

  let streetNumber = "";
  let route = "";
  let city = "";
  let cityFallback = "";
  let state = "";
  let zip = "";
  let zipSuffix = "";

  addressComponents.forEach((component: any) => {
    const types = component.types || [];
    if (types.includes("street_number")) streetNumber = component.long_name;
    if (types.includes("route")) route = component.long_name;
    if (types.includes("locality")) city = component.long_name;
    if (!city && (types.includes("sublocality") || types.includes("sublocality_level_1") || types.includes("postal_town") || types.includes("administrative_area_level_3"))) city = component.long_name;
    if (!cityFallback && (types.includes("neighborhood") || types.includes("administrative_area_level_2"))) cityFallback = component.long_name;
    if (types.includes("administrative_area_level_1")) state = component.short_name;
    if (types.includes("postal_code")) zip = component.long_name;
    if (types.includes("postal_code_suffix")) zipSuffix = component.long_name;
  });

  if (!city) city = cityFallback;
  if (zip && zipSuffix && !zip.includes("-")) zip = `${zip}-${zipSuffix}`;

  const parts = formatted.split(",").map((part: string) => part.trim()).filter(Boolean);
  if (!city && parts.length >= 3) city = parts[parts.length - 3];
  const stateZip = (parts[parts.length - 2] || "").match(/^([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/);
  if (stateZip) {
    if (!state) state = stateZip[1];
    if (!zip && stateZip[2]) zip = stateZip[2];
  }

  return {
    street: `${streetNumber} ${route}`.trim() || parts[0] || "",
    city,
    state,
    zip,
    lat: place?.geometry?.location?.lat,
    lng: place?.geometry?.location?.lng,
    formatted_address: formatted,
  };
};

const AddressVerification: React.FC<AddressVerificationProps> = ({
  onAddressVerified,
  initialAddress = {},
  label = "Address",
  required = false,
}) => {
  const [address, setAddress] = useState<AddressData>({
    street: initialAddress.street || "",
    city: initialAddress.city || "",
    state: initialAddress.state || "",
    zip: initialAddress.zip || "",
    ...initialAddress,
  });
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<
    "none" | "verified" | "partial" | "failed"
  >("none");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionDropdownStyle, setSuggestionDropdownStyle] = useState<React.CSSProperties>({});

  const streetInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);
  const activeSelectionRef = useRef<string | null>(null);
  const { toast } = useToast();

  const updateSuggestionDropdownPosition = useCallback(() => {
    if (!streetInputRef.current) return;

    const rect = streetInputRef.current.getBoundingClientRect();
    setSuggestionDropdownStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  // Random field names so Chrome / 1Password / LastPass can't recognize them as address fields
  const fieldNames = useMemo(() => {
    const r = Math.random().toString(36).slice(2, 10);
    return {
      street: `street-${r}`,
      city: `city-${r}`,
      state: `state-${r}`,
      zip: `zip-${r}`,
    };
  }, []);

  // Belt-and-suspenders: some browsers re-enable autofill after mount
  useEffect(() => {
    if (streetInputRef.current) {
      streetInputRef.current.setAttribute("autocomplete", "new-password");
    }
  }, []);

  useEffect(() => {
    if (!showSuggestions) return;

    updateSuggestionDropdownPosition();

    const handlePositionUpdate = () => updateSuggestionDropdownPosition();
    window.addEventListener("resize", handlePositionUpdate);
    window.addEventListener("scroll", handlePositionUpdate, true);

    return () => {
      window.removeEventListener("resize", handlePositionUpdate);
      window.removeEventListener("scroll", handlePositionUpdate, true);
    };
  }, [showSuggestions, updateSuggestionDropdownPosition]);

  const fetchSuggestions = async (value: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('google-maps-proxy', {
        body: {
          endpoint: 'autocomplete',
          params: {
            input: value,
            types: 'address',
            components: 'country:us',
          },
        },
      });
      if (error) throw error;
      if (data?.predictions && data.predictions.length > 0) {
        updateSuggestionDropdownPosition();
        setSuggestions(data.predictions.slice(0, 5));
        setShowSuggestions(true);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    } catch (error) {
      console.error("Autocomplete error:", error);
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const handleAddressChange = (field: keyof AddressData, value: string) => {
    setAddress(prev => ({ ...prev, [field]: value }));
    setVerificationStatus("none");

    if (field === "street") {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      if (value.trim().length >= 3) {
        debounceRef.current = window.setTimeout(() => fetchSuggestions(value.trim()), 200);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }
  };

  const selectSuggestion = async (prediction: any) => {
    if (activeSelectionRef.current === prediction.place_id) return;
    activeSelectionRef.current = prediction.place_id;

    const optimisticAddress = parseGoogleAddress(
      { formatted_address: prediction.description, place_id: prediction.place_id },
      prediction.description,
    );

    setAddress(prev => ({ ...prev, ...optimisticAddress, place_id: prediction.place_id }));

    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    // Clear suggestions immediately
    setSuggestions([]);
    setShowSuggestions(false);
    setIsVerifying(true);

    try {
      const { data, error } = await supabase.functions.invoke('google-maps-proxy', {
        body: {
          endpoint: 'details',
          params: {
            place_id: prediction.place_id,
            fields: 'address_components,formatted_address,geometry'
          }
        }
      });

      if (error) throw error;

      console.log('Google Places details response:', data);

      if (data?.result) {
        const place = data.result;
        const newAddress: AddressData = {
          ...parseGoogleAddress(place, prediction.description),
          lat: place.geometry?.location?.lat,
          lng: place.geometry?.location?.lng,
          place_id: prediction.place_id,
        };

        console.log('Parsed Address from Google:', newAddress);

        setAddress(newAddress);
        setVerificationStatus("verified");
        
        const verificationData = {
          place_id: prediction.place_id,
          formatted_address: place.formatted_address,
          geometry: place.geometry,
          verification_timestamp: new Date().toISOString(),
          verification_status: "verified",
        };

        onAddressVerified(newAddress, verificationData);
        setIsVerifying(false);
        
        toast({
          title: "Address Verified",
          description: "Address has been verified with Google Places.",
        });
      } else {
        throw new Error("No place details returned");
      }
    } catch (error) {
      setIsVerifying(false);
      setVerificationStatus("failed");
      console.error("Places details error:", error);
      toast({
        title: "Verification Failed",
        description: "Could not verify address details.",
        variant: "destructive",
      });
    } finally {
      activeSelectionRef.current = null;
    }
  };

  const verifyAddress = async () => {
    if (!address.street) {
      toast({
        title: "Missing Address",
        description: "Please enter a street address.",
        variant: "destructive",
      });
      return;
    }

    setIsVerifying(true);
    
    try {
      // Build address string with available components (state/zip optional)
      let fullAddress = address.street;
      if (address.city) fullAddress += `, ${address.city}`;
      if (address.state) fullAddress += `, ${address.state}`;
      if (address.zip) fullAddress += ` ${address.zip}`;
      
      const { data, error } = await supabase.functions.invoke('google-maps-proxy', {
        body: {
          endpoint: 'geocode',
          params: {
            address: fullAddress
          }
        }
      });

      if (error) throw error;

      if (data?.results && data.results.length > 0) {
        const result = data.results[0];
        const location = result.geometry.location;
        
        const verifiedAddress: AddressData = {
          ...address,
          lat: location.lat,
          lng: location.lng,
          formatted_address: result.formatted_address,
          place_id: result.place_id,
        };
        
        setAddress(verifiedAddress);
        setVerificationStatus("verified");
        
        const verificationData = {
          place_id: result.place_id,
          formatted_address: result.formatted_address,
          geometry: result.geometry,
          verification_timestamp: new Date().toISOString(),
          verification_status: "verified",
        };
        
        onAddressVerified(verifiedAddress, verificationData);
        setIsVerifying(false);
        
        toast({
          title: "Address Verified",
          description: "Address has been verified successfully.",
        });
      } else {
        setIsVerifying(false);
        setVerificationStatus("partial");
        
        const verificationData = {
          verification_timestamp: new Date().toISOString(),
          verification_status: "partial",
          error: "No results found",
        };
        
        onAddressVerified(address, verificationData);
        
        toast({
          title: "Partial Verification",
          description: "Address could not be fully verified but has been saved.",
          variant: "destructive",
        });
      }
    } catch (error) {
      setIsVerifying(false);
      setVerificationStatus("failed");
      console.error("Geocoding error:", error);
      
      toast({
        title: "Verification Error",
        description: "An error occurred while verifying the address.",
        variant: "destructive",
      });
    }
  };

  const getStatusIcon = () => {
    switch (verificationStatus) {
      case "verified":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "partial":
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case "failed":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <MapPin className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = () => {
    switch (verificationStatus) {
      case "verified":
        return <Badge variant="default" className="bg-green-100 text-green-800">Verified</Badge>;
      case "partial":
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">Partial</Badge>;
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return null;
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            {getStatusIcon()}
            {label}
            {required && <span className="text-red-500">*</span>}
          </CardTitle>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Honeypot fields — Chrome fills these instead of the real ones */}
        <div style={{ position: "absolute", top: -9999, left: -9999, height: 0, width: 0, overflow: "hidden" }} aria-hidden="true">
          <input type="text" name="address" tabIndex={-1} autoComplete="street-address" />
          <input type="text" name="city" tabIndex={-1} autoComplete="address-level2" />
          <input type="text" name="state" tabIndex={-1} autoComplete="address-level1" />
          <input type="text" name="zip" tabIndex={-1} autoComplete="postal-code" />
        </div>

        <div className="relative">
          <Input
            ref={streetInputRef}
            placeholder="Start typing full address for suggestions..."
            value={address.street}
            onChange={(e) => handleAddressChange("street", e.target.value)}
            onFocus={() => {
              updateSuggestionDropdownPosition();
              if (suggestions.length > 0) setShowSuggestions(true);
            }}
            onBlur={() => {
              // Delay so click on suggestion still registers
              window.setTimeout(() => setShowSuggestions(false), 150);
            }}
            className="w-full"
            autoComplete="new-password"
            name={fieldNames.street}
            id={fieldNames.street}
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showSuggestions}
            aria-controls="google-address-suggestions"
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Type your address above for autocomplete, or fill fields manually
          </p>
        </div>

        {showSuggestions && suggestions.length > 0 && typeof document !== "undefined" && createPortal(
          <div
            id="google-address-suggestions"
            className="pointer-events-auto z-[80] max-h-60 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-lg"
            style={suggestionDropdownStyle}
            onPointerDownCapture={(e) => e.preventDefault()}
            onMouseDownCapture={(e) => e.preventDefault()}
          >
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.place_id || index}
                type="button"
                className="flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition-colors hover:bg-muted focus:bg-muted focus:outline-none"
                onPointerDown={(e) => {
                  e.preventDefault();
                  selectSuggestion(suggestion);
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectSuggestion(suggestion);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  selectSuggestion(suggestion);
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  selectSuggestion(suggestion);
                }}
              >
                <div className="font-medium leading-snug">{suggestion.description}</div>
                <div className="text-xs text-muted-foreground">
                  {suggestion.structured_formatting?.main_text !== suggestion.description
                    ? suggestion.structured_formatting?.main_text
                    : "Google recognized address"}
                </div>
              </button>
            ))}
          </div>,
          document.body,
        )}

        <div className="grid grid-cols-2 gap-4">
          <Input
            placeholder="City"
            value={address.city}
            onChange={(e) => handleAddressChange("city", e.target.value)}
            autoComplete="new-password"
            name={fieldNames.city}
            id={fieldNames.city}
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="State"
              value={address.state}
              onChange={(e) => handleAddressChange("state", e.target.value)}
              maxLength={2}
              autoComplete="new-password"
              name={fieldNames.state}
              id={fieldNames.state}
              data-form-type="other"
              data-lpignore="true"
              data-1p-ignore="true"
            />
            <Input
              placeholder="ZIP"
              value={address.zip}
              onChange={(e) => handleAddressChange("zip", e.target.value)}
              maxLength={10}
              autoComplete="new-password"
              name={fieldNames.zip}
              id={fieldNames.zip}
              data-form-type="other"
              data-lpignore="true"
              data-1p-ignore="true"
            />
          </div>
        </div>

        {verificationStatus === "none" && (address.street || address.city) && (
          <Button
            onClick={verifyAddress}
            disabled={isVerifying}
            className="w-full"
            variant="outline"
          >
            {isVerifying ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Verifying...
              </>
            ) : (
              <>
                <MapPin className="h-4 w-4 mr-2" />
                Verify Address
              </>
            )}
          </Button>
        )}

        {address.lat && address.lng && (
          <div className="text-sm text-muted-foreground">
            Coordinates: {address.lat.toFixed(6)}, {address.lng.toFixed(6)}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AddressVerification;