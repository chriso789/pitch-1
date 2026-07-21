import { useState, useEffect, useRef } from 'react';
import { Search, MapPin, Loader2, Navigation, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { locationService } from '@/services/locationService';

interface AddressSearchBarProps {
  userLocation: { lat: number; lng: number };
  onAddressSelect: (place: PlaceResult) => void;
  dropdownPlacement?: 'auto' | 'above' | 'below';
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

export default function AddressSearchBar({ userLocation, onAddressSelect, dropdownPlacement = 'auto' }: AddressSearchBarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTokenRef = useRef<string>(crypto.randomUUID());
  const containerRef = useRef<HTMLDivElement | null>(null);

  const dropdownPositionClass =
    dropdownPlacement === 'below'
      ? 'top-full mt-1'
      : dropdownPlacement === 'above'
        ? 'bottom-full mb-1'
        : 'top-full mt-1';

  useEffect(() => {
    if (searchQuery.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const params: Record<string, string> = {
          input: searchQuery,
          types: 'address',
          components: 'country:us',
          sessiontoken: sessionTokenRef.current,
        };
        if (userLocation && userLocation.lat !== 0 && userLocation.lng !== 0) {
          params.location = `${userLocation.lat},${userLocation.lng}`;
          params.radius = '50000';
        }

        const { data, error } = await supabase.functions.invoke('google-maps-proxy', {
          body: { endpoint: 'autocomplete', params },
        });

        if (error) throw error;
        const preds = (data?.predictions || []) as PlaceResult[];
        setSuggestions(preds);
        setOpen(preds.length > 0 || searchQuery.length >= 3);
      } catch (err) {
        console.error('[AddressSearchBar] autocomplete error:', err);
        setSuggestions([]);
        setOpen(false);
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchQuery, userLocation]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, []);

  const handleSelectPlace = async (place: PlaceResult) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('google-maps-proxy', {
        body: {
          endpoint: 'details',
          params: {
            place_id: place.place_id,
            fields: 'geometry,formatted_address',
            sessiontoken: sessionTokenRef.current,
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
      sessionTokenRef.current = crypto.randomUUID();
    } catch (err) {
      console.error('[AddressSearchBar] place details error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const calculateDistanceToPlace = (place: PlaceResult) => {
    if (!place.geometry?.location) return null;
    if (!userLocation || (userLocation.lat === 0 && userLocation.lng === 0)) return null;
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
    <div ref={containerRef} className="relative w-full">
      <div className="flex items-center gap-2 rounded-lg border bg-background shadow-md px-3 h-11">
        <Search className="h-4 w-4 shrink-0 opacity-50" />
        <input
          type="text"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Search for an address..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : searchQuery ? (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => {
              setSearchQuery('');
              setSuggestions([]);
              setOpen(false);
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {open && (
        <div className={`absolute left-0 right-0 z-[70] max-h-80 overflow-y-auto rounded-md border bg-popover shadow-lg ${dropdownPositionClass}`}>
          {suggestions.length > 0 ? (
            <ul className="py-1">
              {suggestions.map((place) => {
                const distance = calculateDistanceToPlace(place);
                return (
                  <li key={place.place_id}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSelectPlace(place)}
                      className="flex w-full items-start gap-3 p-3 text-left hover:bg-accent"
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
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : !isLoading && searchQuery.trim().length >= 3 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">No results found</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
