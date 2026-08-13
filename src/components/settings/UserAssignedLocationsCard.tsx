import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Building2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";

interface UserAssignedLocationsCardProps {
  userId: string;
}

interface AssignedLocation {
  id: string;
  name: string;
  address_city?: string | null;
  address_state?: string | null;
  is_primary?: boolean | null;
}

export const UserAssignedLocationsCard: React.FC<UserAssignedLocationsCardProps> = ({ userId }) => {
  const effectiveTenantId = useEffectiveTenantId();

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ["user-assigned-locations", userId, effectiveTenantId],
    enabled: !!userId && !!effectiveTenantId,
    queryFn: async (): Promise<AssignedLocation[]> => {
      const { data: assignments, error } = await supabase
        .from("user_location_assignments")
        .select("location_id, is_primary")
        .eq("user_id", userId)
        .eq("tenant_id", effectiveTenantId!)
        .eq("is_active", true);
      if (error) throw error;

      const ids = (assignments || []).map((a: any) => a.location_id).filter(Boolean);
      if (ids.length === 0) return [];

      const { data: locs, error: locErr } = await supabase
        .from("locations")
        .select("id, name, address_city, address_state")
        .in("id", ids)
        .eq("tenant_id", effectiveTenantId!)
        .order("name");
      if (locErr) throw locErr;

      const primaryMap = new Map<string, boolean>(
        (assignments || []).map((a: any) => [a.location_id, !!a.is_primary])
      );

      return (locs || []).map((l: any) => ({ ...l, is_primary: primaryMap.get(l.id) }));
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          Assigned Locations
          {locations.length > 0 && (
            <Badge variant="secondary" className="ml-1">{locations.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading locations…</p>
        ) : locations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No locations assigned. Assign locations from Settings → Locations → User Assignments.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {locations.map((loc) => (
              <div
                key={loc.id}
                className="flex items-start gap-3 rounded-lg border p-3"
              >
                <Building2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{loc.name}</p>
                    {loc.is_primary && <Badge className="text-xs">Primary</Badge>}
                  </div>
                  {(loc.address_city || loc.address_state) && (
                    <p className="text-sm text-muted-foreground truncate">
                      {[loc.address_city, loc.address_state].filter(Boolean).join(", ")}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default UserAssignedLocationsCard;
