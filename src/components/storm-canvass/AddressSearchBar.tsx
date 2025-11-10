import { useState, useEffect, useRef } from 'react';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Search, MapPin, Loader2, Navigation } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { locationService } from '@/services/locationService';

interface AddressSearchBarProps {
  userLocation: { lat: number; lng: number };
  onAddressSelect: (place: PlaceResult) => void;
}

interface PlaceResult {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
  geometry?: {
    location: { lat: number; lng: number };
  };
}

export default function AddressSearchBar({ userLocation, onAddressSelect }: AddressSearchBarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (searchQuery.length < 3) {
      setSuggestions([]);
      return;
    }

    // Debounce API calls
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('google-maps-proxy', {
          body: {
            endpoint: 'autocomplete',
            params: {
              input: searchQuery,
              location: `${userLocation.lat},${userLocation.lng}`,
              radius: '8000', // 5 miles in meters
              types: 'address',
            },
          },
        });

        if (error) throw error;
        setSuggestions(data?.predictions || []);
        setOpen(true);
      } catch (error) {
        console.error('Autocomplete error:', error);
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [searchQuery, userLocation]);

  const handleSelectPlace = async (place: PlaceResult) => {
    setIsLoading(true);
    try {
      // Fetch place details to get coordinates
      const { data, error } = await supabase.functions.invoke('google-maps-proxy', {
        body: {
          endpoint: 'details',
          params: {
            place_id: place.place_id,
            fields: 'geometry,formatted_address',
          },
        },
      });

      if (error) throw error;

      const placeWithGeometry = {
        ...place,
        geometry: data?.result?.geometry,
      };

      onAddressSelect(placeWithGeometry);
      setSearchQuery(place.structured_formatting.main_text);
      setOpen(false);
      setSuggestions([]);
    } catch (error) {
      console.error('Place details error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const calculateDistanceToPlace = (place: PlaceResult) => {
    if (!place.geometry?.location) return null;
    const distance = locationService.calculateDistance(
      userLocation.lat,
      userLocation.lng,
      place.geometry.location.lat,
      place.geometry.location.lng,
      'miles'
    );
    return distance.distance < 0.1
      ? `${Math.round(distance.distance * 5280)} ft`
      : `${distance.distance.toFixed(1)} mi`;
  };

  return (
    <Command className="relative rounded-lg border shadow-md bg-background">
      <div className="flex items-center border-b px-3">
        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
        <CommandInput
          placeholder="Search for an address..."
          value={searchQuery}
          onValueChange={setSearchQuery}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
        />
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {open && suggestions.length > 0 && (
        <CommandList className="absolute top-full left-0 right-0 mt-1 z-50 max-h-80 overflow-y-auto rounded-md border bg-popover shadow-lg">
          <CommandGroup>
            {suggestions.map((place) => {
              const distance = calculateDistanceToPlace(place);
              return (
                <CommandItem
                  key={place.place_id}
                  onSelect={() => handleSelectPlace(place)}
                  className="flex items-start gap-3 p-3 cursor-pointer hover:bg-accent"
                >
                  <MapPin className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{place.structured_formatting.main_text}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {place.structured_formatting.secondary_text}
                    </div>
                    {distance && (
                      <div className="flex items-center gap-1 text-xs text-primary mt-1">
                        <Navigation className="h-3 w-3" />
                        <span>{distance} away</span>
                      </div>
                    )}
                  </div>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      )}

      {open && !isLoading && suggestions.length === 0 && searchQuery.length >= 3 && (
        <CommandList className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border bg-popover shadow-lg">
          <CommandEmpty className="p-4 text-sm text-muted-foreground text-center">
            No results found
          </CommandEmpty>
        </CommandList>
      )}
    </Command>
  );
}
