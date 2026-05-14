import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
import { MapPin, Building2, Loader2 } from "lucide-react";
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
  const [isSaving, setIsSaving] = useState(false);
  const navigate = useNavigate();

  // Fetch user's tenant ID for saving settings
  const { data: profile } = useQuery({
    queryKey: ['user-profile-tenant', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('active_tenant_id, tenant_id')
        .eq('id', userId)
        .single();
      return data;
    },
    enabled: !!userId,
  });

  const activeTenantId = profile?.active_tenant_id || profile?.tenant_id;

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

  // Check if user needs to select a location (only on initial load)
  useEffect(() => {
    const checkExistingLocation = async () => {
      if (!userId || !activeTenantId || !locations || locations.length <= 1) return;

      // 1. Try localStorage first for instant resume
      const cached = localStorage.getItem('pitch_current_location');
      if (cached && locations.some(l => l.id === cached)) {
        onLocationSelected(cached);
        return;
      }

      // 2. Check database for saved location
      const { data: existingSetting } = await supabase
        .from('app_settings')
        .select('setting_value')
        .eq('user_id', userId)
        .eq('tenant_id', activeTenantId)
        .eq('setting_key', 'current_location_id')
        .maybeSingle();

      const savedId = existingSetting?.setting_value as string | undefined;
      const chosen = (savedId && locations.some(l => l.id === savedId))
        ? savedId
        : locations[0].id;

      // Auto-select without prompting — users cannot switch locations after login
      localStorage.setItem('pitch_current_location', chosen);
      onLocationSelected(chosen);

      // Persist if not already saved
      if (chosen !== savedId) {
        await supabase
          .from('app_settings')
          .upsert({
            user_id: userId,
            tenant_id: activeTenantId,
            setting_key: 'current_location_id',
            setting_value: chosen,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,tenant_id,setting_key' });
      }
    };

    if (locations && locations.length === 1) {
      // User has only one location, auto-select it and save
      const locationId = locations[0].id;
      localStorage.setItem('pitch_current_location', locationId);
      onLocationSelected(locationId);
    } else if (locations && locations.length > 1 && activeTenantId) {
      checkExistingLocation();
    }
  }, [locations, userId, activeTenantId, onLocationSelected]);

  const handleConfirm = async () => {
    if (!selectedLocation) {
      toast.error('Please select a location');
      return;
    }

    setIsSaving(true);
    try {
      // Save directly to app_settings (RLS allows users to manage their own settings).
      // Avoids the previous edge-function call that was failing silently.
      const { error: upsertError } = await supabase
        .from('app_settings')
        .upsert({
          user_id: userId,
          tenant_id: activeTenantId,
          setting_key: 'current_location_id',
          setting_value: selectedLocation,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,tenant_id,setting_key' });

      if (upsertError) {
        console.error('[LocationSelectionDialog] Upsert failed:', upsertError);
        throw upsertError;
      }

      // Save to localStorage for immediate access on next login
      localStorage.setItem('pitch_current_location', selectedLocation);

      // Notify callback
      onLocationSelected(selectedLocation);

      // Close dialog
      setOpen(false);

      toast.success('Location selected');

      // Navigate without hard reload
      navigate('/dashboard', { replace: true });
    } catch (error) {
      console.error('Error saving location:', error);
      toast.error('Failed to save location preference');
      setIsSaving(false);
    }
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
          <Button onClick={handleConfirm} disabled={!selectedLocation || isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Continue'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
