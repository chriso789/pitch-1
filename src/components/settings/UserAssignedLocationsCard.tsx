import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { MapPin, Building2, Loader2, Save, Pencil, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { useToast } from "@/hooks/use-toast";

interface UserAssignedLocationsCardProps {
  userId: string;
}

interface LocationRow {
  id: string;
  name: string;
  address_city?: string | null;
  address_state?: string | null;
}

export const UserAssignedLocationsCard: React.FC<UserAssignedLocationsCardProps> = ({ userId }) => {
  const effectiveTenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const queryKey = ["user-assigned-locations", userId, effectiveTenantId];

  const { data, isLoading } = useQuery({
    queryKey,
    enabled: !!userId && !!effectiveTenantId,
    queryFn: async (): Promise<{ all: LocationRow[]; assignedIds: string[] }> => {
      const { data: locs, error: locErr } = await supabase
        .from("locations")
        .select("id, name, address_city, address_state")
        .eq("tenant_id", effectiveTenantId!)
        .order("name");
      if (locErr) throw locErr;

      const { data: assignments, error } = await supabase
        .from("user_location_assignments")
        .select("location_id")
        .eq("user_id", userId)
        .eq("tenant_id", effectiveTenantId!)
        .eq("is_active", true);
      if (error) throw error;

      return {
        all: (locs || []) as LocationRow[],
        assignedIds: (assignments || []).map((a: any) => a.location_id).filter(Boolean),
      };
    },
  });

  const allLocations = data?.all || [];
  const assignedIds = useMemo(() => data?.assignedIds || [], [data]);
  const assigned = allLocations.filter((l) => assignedIds.includes(l.id));

  const startEditing = () => {
    setSelected(assignedIds);
    setEditing(true);
  };

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSave = async () => {
    if (!effectiveTenantId) return;
    try {
      setSaving(true);
      const toRemove = assignedIds.filter((id) => !selected.includes(id));
      const toAdd = selected.filter((id) => !assignedIds.includes(id));

      if (toRemove.length > 0) {
        const { error } = await supabase
          .from("user_location_assignments")
          .delete()
          .eq("user_id", userId)
          .eq("tenant_id", effectiveTenantId)
          .in("location_id", toRemove);
        if (error) throw error;
      }

      if (toAdd.length > 0) {
        const { data: authData } = await supabase.auth.getUser();
        const { error } = await supabase.from("user_location_assignments").insert(
          toAdd.map((location_id) => ({
            user_id: userId,
            location_id,
            tenant_id: effectiveTenantId,
            assigned_by: authData?.user?.id ?? null,
            is_active: true,
          }))
        );
        if (error) throw error;
      }

      await queryClient.invalidateQueries({ queryKey });
      setEditing(false);
      toast({ title: "Locations updated", description: `${selected.length} location(s) assigned` });
    } catch (error: any) {
      console.error("Error saving location assignments:", error);
      toast({
        title: "Error saving assignments",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          Assigned Locations
          {assigned.length > 0 && (
            <Badge variant="secondary" className="ml-1">{assigned.length}</Badge>
          )}
        </CardTitle>
        {!editing ? (
          <Button variant="outline" size="sm" onClick={startEditing} disabled={isLoading}>
            <Pencil className="h-4 w-4 mr-1" />
            Manage
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Save
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading locations…</p>
        ) : editing ? (
          allLocations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No locations exist for this company yet.</p>
          ) : (
            <div className="space-y-2 max-h-[320px] overflow-y-auto">
              {allLocations.map((loc) => (
                <div
                  key={loc.id}
                  className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                    selected.includes(loc.id) ? "bg-primary/5 border-primary/20" : "hover:bg-muted/50"
                  }`}
                >
                  <Checkbox
                    id={`loc-${loc.id}`}
                    checked={selected.includes(loc.id)}
                    onCheckedChange={() => toggle(loc.id)}
                  />
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <Label htmlFor={`loc-${loc.id}`} className="font-medium cursor-pointer">
                      {loc.name}
                    </Label>
                    {(loc.address_city || loc.address_state) && (
                      <p className="text-sm text-muted-foreground truncate">
                        {[loc.address_city, loc.address_state].filter(Boolean).join(", ")}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : assigned.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No locations assigned. Use Manage to assign locations.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {assigned.map((loc) => (
              <div key={loc.id} className="flex items-start gap-3 rounded-lg border p-3">
                <Building2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium truncate">{loc.name}</p>
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
