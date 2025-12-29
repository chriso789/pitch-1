import React, { useState, useRef } from "react";
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
  
  const streetInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleAddressChange = async (field: keyof AddressData, value: string) => {
    setAddress(prev => ({ ...prev, [field]: value }));
    setVerificationStatus("none");

    // Trigger autocomplete for street address using edge function
    if (field === "street" && value.length > 3) {
      try {
        const { data, error } = await supabase.functions.invoke('google-maps-proxy', {
          body: {
            endpoint: 'autocomplete',
            params: {
              input: value,
              types: 'address',
              components: 'country:us'
            }
          }
        });

        if (error) throw error;

        if (data?.predictions && data.predictions.length > 0) {
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
    } else if (field === "street") {
      setShowSuggestions(false);
    }
  };

  const selectSuggestion = async (prediction: any) => {
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

      if (data?.result) {
        const place = data.result;
        const addressComponents = place.address_components || [];
        
        // Parse address components with better fallbacks
        let streetNumber = "";
        let route = "";
        let city = "";
        let state = "";
        let zip = "";

        addressComponents.forEach((component: any) => {
          const types = component.types;
          if (types.includes("street_number")) {
            streetNumber = component.long_name;
          } else if (types.includes("route")) {
            route = component.long_name;
          } else if (types.includes("locality") || types.includes("sublocality") || types.includes("administrative_area_level_3")) {
            // Use first match for city (locality preferred)
            if (!city) city = component.long_name;
          } else if (types.includes("administrative_area_level_1")) {
            state = component.short_name;
          } else if (types.includes("postal_code")) {
            zip = component.long_name;
          }
        });

        const newAddress: AddressData = {
          street: `${streetNumber} ${route}`.trim(),
          city,
          state,
          zip,
          lat: place.geometry?.location?.lat,
          lng: place.geometry?.location?.lng,
          place_id: prediction.place_id,
          formatted_address: place.formatted_address,
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
        <div className="relative">
          <Input
            ref={streetInputRef}
            placeholder="Start typing full address for suggestions..."
            value={address.street}
            onChange={(e) => handleAddressChange("street", e.target.value)}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Type your address above for autocomplete, or fill fields manually
          </p>
          
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-60 overflow-auto">
              {suggestions.map((suggestion, index) => (
                <div
                  key={index}
                  className="px-4 py-2 cursor-pointer hover:bg-muted"
                  onClick={() => selectSuggestion(suggestion)}
                >
                  <div className="font-medium">{suggestion.structured_formatting.main_text}</div>
                  <div className="text-sm text-muted-foreground">
                    {suggestion.structured_formatting.secondary_text}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input
            placeholder="City"
            value={address.city}
            onChange={(e) => handleAddressChange("city", e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="State"
              value={address.state}
              onChange={(e) => handleAddressChange("state", e.target.value)}
              maxLength={2}
            />
            <Input
              placeholder="ZIP"
              value={address.zip}
              onChange={(e) => handleAddressChange("zip", e.target.value)}
              maxLength={10}
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