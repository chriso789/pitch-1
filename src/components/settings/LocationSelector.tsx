import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { MapPin, Check } from "lucide-react";

interface Location {
  id: string;
  name: string;
}

interface LocationSelectorProps {
  tenantId: string;
  onLocationChange?: (locationId: string) => void;
}

export function LocationSelector({ tenantId, onLocationChange }: LocationSelectorProps) {
  const { toast } = useToast();
  const [locations, setLocations] = useState<Location[]>([]);
  const [activeLocation, setActiveLocation] = useState<string>("");
  const [qboDepartmentName, setQboDepartmentName] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLocations();
    loadActiveLocation();
  }, [tenantId]);

  const loadLocations = async () => {
    try {
      const { data } = await supabase
        .from("locations")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("name");

      if (data) setLocations(data);
    } catch (error) {
      console.error("Error loading locations:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadActiveLocation = async () => {
    try {
      // Load from local storage as fallback until user_sessions table is populated
      const savedLocation = localStorage.getItem(`active_location_${tenantId}`);
      if (savedLocation && locations.find(l => l.id === savedLocation)) {
        setActiveLocation(savedLocation);
        loadQBOMapping(savedLocation);
      }
    } catch (error) {
      console.error("Error loading active location:", error);
    }
  };

  const loadQBOMapping = async (locationId: string) => {
    try {
      const { data } = await supabase
        .from("qbo_location_map")
        .select("department_name")
        .eq("tenant_id", tenantId)
        .eq("location_id", locationId)
        .eq("is_active", true)
        .single();

      if (data) setQboDepartmentName(data.department_name || "");
    } catch (error) {
      // Mapping might not exist yet
      setQboDepartmentName("");
    }
  };

  const handleLocationChange = async (locationId: string) => {
    try {
      setActiveLocation(locationId);
      localStorage.setItem(`active_location_${tenantId}`, locationId);
      loadQBOMapping(locationId);
      
      // Call qbo-worker to persist
      await supabase.functions.invoke("qbo-worker", {
        body: {
          op: "setLocation",
          args: { location_id: locationId },
        },
      });

      toast({
        title: "Location Updated",
        description: "This location will be used for QuickBooks invoices",
      });

      if (onLocationChange) onLocationChange(locationId);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Active Location</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          Active Location
        </CardTitle>
        <CardDescription>
          Selected location will be used for QuickBooks invoice tracking
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select value={activeLocation} onValueChange={handleLocationChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select a location" />
          </SelectTrigger>
          <SelectContent>
            {locations.map((location) => (
              <SelectItem key={location.id} value={location.id}>
                <div className="flex items-center gap-2">
                  {location.name}
                  {activeLocation === location.id && <Check className="h-4 w-4 text-primary" />}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {activeLocation && (
          <div className="pt-2 border-t">
            <p className="text-sm font-medium mb-2">QuickBooks Integration</p>
            {qboDepartmentName ? (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  Mapped to QBO Department: {qboDepartmentName}
                </Badge>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Not mapped to a QuickBooks department yet
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
