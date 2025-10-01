import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { MapPin, Building2 } from "lucide-react";
import { toast } from "sonner";

interface Location {
  id: string;
  name: string;
  address_street?: string;
  address_city?: string;
  address_state?: string;
}

interface LocationSelectionDialogProps {
  userId: string;
  onLocationSelected: (locationId: string) => void;
}

export function LocationSelectionDialog({ userId, onLocationSelected }: LocationSelectionDialogProps) {
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [open, setOpen] = useState(false);

  // Fetch user's assigned locations
  const { data: assignments } = useQuery({
    queryKey: ['user-location-assignments', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_location_assignments')
        .select('location_id')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error) throw error;
      
      // Fetch full location details
      if (!data || data.length === 0) return [];
      
      const locationIds = data.map(a => a.location_id);
      const { data: locations, error: locError } = await supabase
        .from('locations')
        .select('id, name, address_street, address_city, address_state')
        .in('id', locationIds);
      
      if (locError) throw locError;
      return locations || [];
    },
    enabled: !!userId,
  });

  const locations = assignments || [];

  useEffect(() => {
    // Check if user has active location in session
    const activeLocationId = sessionStorage.getItem('active_location_id');
    
    if (!activeLocationId && locations && locations.length > 1) {
      // User has multiple locations but no active one selected
      setOpen(true);
    } else if (!activeLocationId && locations && locations.length === 1) {
      // User has only one location, auto-select it
      const locationId = locations[0].id;
      sessionStorage.setItem('active_location_id', locationId);
      onLocationSelected(locationId);
    } else if (activeLocationId) {
      // User already has active location
      onLocationSelected(activeLocationId);
    }
  }, [locations, onLocationSelected]);

  const handleConfirm = () => {
    if (!selectedLocation) {
      toast.error('Please select a location');
      return;
    }

    sessionStorage.setItem('active_location_id', selectedLocation);
    onLocationSelected(selectedLocation);
    setOpen(false);
    toast.success('Location selected');
  };

  if (!locations || locations.length <= 1) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Select Your Location
          </DialogTitle>
          <DialogDescription>
            You have access to multiple locations. Please select which location you want to work with.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <RadioGroup value={selectedLocation} onValueChange={setSelectedLocation}>
            {locations.map((location) => (
              <div key={location.id} className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-accent/50 cursor-pointer">
                <RadioGroupItem value={location.id} id={location.id} />
                <Label htmlFor={location.id} className="flex-1 cursor-pointer">
                  <div className="font-medium">{location.name}</div>
                  {location.address_city && location.address_state && (
                    <div className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                      <MapPin className="h-3 w-3" />
                      {location.address_city}, {location.address_state}
                    </div>
                  )}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleConfirm} disabled={!selectedLocation}>
            Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
