import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { 
  Popover, 
  PopoverContent, 
  PopoverTrigger 
} from "@/components/ui/popover";
import { 
  Command, 
  CommandEmpty, 
  CommandGroup, 
  CommandItem, 
  CommandList 
} from "@/components/ui/command";
import { MapPin, Loader2, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";

export interface AddressComponents {
  street_number?: string;
  street_name?: string;
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
}

interface AddressPrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

interface AddressAutocompleteProps {
  value?: string;
  onChange?: (value: string) => void;
  onAddressSelect?: (address: AddressComponents) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
}

export function AddressAutocomplete({
  value = "",
  onChange,
  onAddressSelect,
  placeholder = "Enter an address...",
  className,
  disabled,
  required,
  error,
}: AddressAutocompleteProps) {
  const [inputValue, setInputValue] = useState(value);
  const [predictions, setPredictions] = useState<AddressPrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState<AddressComponents | null>(null);
  
  const debouncedValue = useDebounce(inputValue, 300);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch predictions when input changes
  useEffect(() => {
    if (debouncedValue.length < 3) {
      setPredictions([]);
      return;
    }

    fetchPredictions(debouncedValue);
  }, [debouncedValue]);

  async function fetchPredictions(query: string) {
    setLoading(true);
    try {
      // Check if Google Maps API is available
      if (typeof window !== "undefined" && (window as unknown as { google?: { maps?: { places?: unknown } } }).google?.maps?.places) {
        const service = new google.maps.places.AutocompleteService();
        const response = await new Promise<google.maps.places.AutocompletePrediction[]>((resolve) => {
          service.getPlacePredictions(
            {
              input: query,
              componentRestrictions: { country: "us" },
              types: ["address"],
            },
            (predictions, status) => {
              if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
                resolve(predictions);
              } else {
                resolve([]);
              }
            }
          );
        });

        setPredictions(
          response.map((p) => ({
            place_id: p.place_id,
            description: p.description,
            structured_formatting: {
              main_text: p.structured_formatting.main_text,
              secondary_text: p.structured_formatting.secondary_text,
            },
          }))
        );
      } else {
        // Fallback: no predictions available
        setPredictions([]);
      }
    } catch (err) {
      console.error("Error fetching predictions:", err);
      setPredictions([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectPrediction(prediction: AddressPrediction) {
    setInputValue(prediction.description);
    onChange?.(prediction.description);
    setOpen(false);

    // Get place details
    if (typeof window !== "undefined" && (window as unknown as { google?: { maps?: { places?: unknown } } }).google?.maps?.places) {
      const service = new google.maps.places.PlacesService(
        document.createElement("div")
      );

      service.getDetails(
        {
          placeId: prediction.place_id,
          fields: ["address_components", "geometry", "formatted_address"],
        },
        (place, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && place) {
            const components = parseAddressComponents(place);
            setSelectedAddress(components);
            onAddressSelect?.(components);
          }
        }
      );
    }
  }

  function parseAddressComponents(
    place: google.maps.places.PlaceResult
  ): AddressComponents {
    const components: Record<string, string> = {};

    place.address_components?.forEach((component) => {
      const type = component.types[0];
      components[type] = component.short_name;
      components[`${type}_long`] = component.long_name;
    });

    const streetNumber = components.street_number || "";
    const streetName = components.route || "";

    return {
      street_number: streetNumber,
      street_name: streetName,
      address_line1: `${streetNumber} ${streetName}`.trim(),
      city: components.locality || components.sublocality_level_1 || "",
      state: components.administrative_area_level_1 || "",
      zip_code: components.postal_code || "",
      country: components.country || "US",
      latitude: place.geometry?.location?.lat(),
      longitude: place.geometry?.location?.lng(),
      formatted_address: place.formatted_address || "",
      place_id: place.place_id,
    };
  }

  return (
    <div className={cn("relative", className)}>
      <Popover open={open && predictions.length > 0} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                onChange?.(e.target.value);
                setOpen(true);
              }}
              onFocus={() => predictions.length > 0 && setOpen(true)}
              placeholder={placeholder}
              disabled={disabled}
              required={required}
              className={cn(
                "pl-10 pr-10",
                error && "border-destructive",
                selectedAddress && "pr-10"
              )}
            />
            {loading && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
            {selectedAddress && !loading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <Check className="h-4 w-4 text-green-500" />
                <span className="text-xs text-green-600 font-medium">Verified</span>
              </div>
            )}
          </div>
        </PopoverTrigger>
        <PopoverContent 
          className="p-0 w-[var(--radix-popover-trigger-width)]" 
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Command>
            <CommandList>
              <CommandEmpty>
                {loading ? "Searching..." : "No addresses found"}
              </CommandEmpty>
              <CommandGroup>
                {predictions.map((prediction) => (
                  <CommandItem
                    key={prediction.place_id}
                    value={prediction.description}
                    onSelect={() => handleSelectPrediction(prediction)}
                    className="cursor-pointer"
                  >
                    <MapPin className="mr-2 h-4 w-4 text-muted-foreground" />
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {prediction.structured_formatting.main_text}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {prediction.structured_formatting.secondary_text}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {error && (
        <div className="flex items-center gap-1 mt-1 text-sm text-destructive">
          <AlertCircle className="h-3 w-3" />
          {error}
        </div>
      )}
    </div>
  );
}
