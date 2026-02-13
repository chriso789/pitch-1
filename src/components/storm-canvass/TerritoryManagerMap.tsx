import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, MapPin, Users } from "lucide-react";
import LiveAreaStatsBadge from "./LiveAreaStatsBadge";
import { cn } from "@/lib/utils";

interface CanvassArea {
  id: string;
  name: string;
  color: string;
  polygon_geojson: any;
}

interface TeamMember {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface AreaAssignment {
  area_id: string;
  user_id: string;
}

export default function TerritoryManagerMap() {
  const { activeTenantId, profile } = useActiveTenantId();
  const [areas, setAreas] = useState<CanvassArea[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [assignments, setAssignments] = useState<AreaAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newAreaName, setNewAreaName] = useState("");
  const [newAreaColor, setNewAreaColor] = useState("#3b82f6");
  const [drawnPolygon, setDrawnPolygon] = useState<any>(null);

  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const drawingManagerRef = useRef<google.maps.drawing.DrawingManager | null>(null);
  const polygonOverlaysRef = useRef<google.maps.Polygon[]>([]);
  const drawnOverlayRef = useRef<google.maps.Polygon | null>(null);

  // Load areas + team + assignments
  const fetchData = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);

    const [areasRes, teamRes, assignRes] = await Promise.all([
      supabase
        .from("canvass_areas")
        .select("id, name, color, polygon_geojson")
        .eq("tenant_id", activeTenantId),
      supabase
        .from("profiles")
        .select("id, first_name, last_name, email")
        .eq("tenant_id", activeTenantId),
      supabase
        .from("canvass_area_assignments")
        .select("area_id, user_id")
        .eq("tenant_id", activeTenantId)
        .eq("is_active", true),
    ]);

    setAreas((areasRes.data as CanvassArea[]) || []);
    setTeamMembers((teamRes.data as TeamMember[]) || []);
    setAssignments((assignRes.data as AreaAssignment[]) || []);
    setLoading(false);
  }, [activeTenantId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Init Google Map
  useEffect(() => {
    if (!mapRef.current || !window.google) return;
    if (googleMapRef.current) return;

    const map = new google.maps.Map(mapRef.current, {
      center: { lat: 27.3, lng: -82.5 },
      zoom: 10,
      mapTypeId: "hybrid",
      disableDefaultUI: true,
      zoomControl: true,
    });
    googleMapRef.current = map;

    const dm = new google.maps.drawing.DrawingManager({
      drawingMode: null,
      drawingControl: false,
      polygonOptions: {
        fillColor: "#3b82f6",
        fillOpacity: 0.25,
        strokeColor: "#3b82f6",
        strokeWeight: 2,
        editable: true,
      },
    });
    dm.setMap(map);
    drawingManagerRef.current = dm;

    google.maps.event.addListener(dm, "polygoncomplete", (polygon: google.maps.Polygon) => {
      if (drawnOverlayRef.current) drawnOverlayRef.current.setMap(null);
      drawnOverlayRef.current = polygon;

      const path = polygon.getPath();
      const coords: number[][] = [];
      for (let i = 0; i < path.getLength(); i++) {
        const p = path.getAt(i);
        coords.push([p.lng(), p.lat()]);
      }
      if (coords.length > 0) coords.push(coords[0]);
      setDrawnPolygon({ type: "Polygon", coordinates: [coords] });
      dm.setDrawingMode(null);
    });
  }, []);

  // Render existing area polygons
  useEffect(() => {
    const map = googleMapRef.current;
    if (!map) return;

    polygonOverlaysRef.current.forEach((p) => p.setMap(null));
    polygonOverlaysRef.current = [];

    for (const area of areas) {
      const coords = area.polygon_geojson?.coordinates?.[0] || [];
      if (coords.length < 3) continue;

      const path = coords.map((c: number[]) => ({ lat: c[1], lng: c[0] }));
      const poly = new google.maps.Polygon({
        paths: path,
        fillColor: area.color || "#3b82f6",
        fillOpacity: 0.2,
        strokeColor: area.color || "#3b82f6",
        strokeWeight: 2,
        map,
      });

      polygonOverlaysRef.current.push(poly);
    }
  }, [areas]);

  const startDrawing = () => {
    if (drawnOverlayRef.current) {
      drawnOverlayRef.current.setMap(null);
      drawnOverlayRef.current = null;
    }
    setDrawnPolygon(null);
    drawingManagerRef.current?.setDrawingMode(google.maps.drawing.OverlayType.POLYGON);
  };

  const saveArea = async () => {
    if (!activeTenantId || !drawnPolygon || !newAreaName.trim()) {
      toast.error("Draw a polygon and enter a name");
      return;
    }

    setSaving(true);
    try {
      const { data: created, error } = await supabase
        .from("canvass_areas")
        .insert({
          tenant_id: activeTenantId,
          name: newAreaName.trim(),
          polygon_geojson: drawnPolygon,
          color: newAreaColor,
          created_by: profile?.id,
        })
        .select()
        .single();

      if (error) throw error;

      await supabase.functions.invoke("canvass-area-build-membership", {
        body: { tenant_id: activeTenantId, area_id: created.id },
      });

      toast.success(`Area "${newAreaName}" saved`);
      setNewAreaName("");
      setDrawnPolygon(null);
      if (drawnOverlayRef.current) {
        drawnOverlayRef.current.setMap(null);
        drawnOverlayRef.current = null;
      }
      fetchData();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to save area");
    } finally {
      setSaving(false);
    }
  };

  const deleteArea = async (areaId: string) => {
    if (!activeTenantId) return;
    const { error } = await supabase.from("canvass_areas").delete().eq("id", areaId).eq("tenant_id", activeTenantId);
    if (error) {
      toast.error("Failed to delete area");
    } else {
      toast.success("Area deleted");
      fetchData();
    }
  };

  const toggleRepAssignment = async (areaId: string, userId: string, currentlyAssigned: boolean) => {
    if (!activeTenantId) return;

    if (currentlyAssigned) {
      await supabase
        .from("canvass_area_assignments")
        .delete()
        .eq("tenant_id", activeTenantId)
        .eq("area_id", areaId)
        .eq("user_id", userId);
    } else {
      await supabase
        .from("canvass_area_assignments")
        .upsert({
          tenant_id: activeTenantId,
          area_id: areaId,
          user_id: userId,
          is_active: true,
        }, { onConflict: "tenant_id,area_id,user_id" });
    }

    // Refresh assignments
    const { data } = await supabase
      .from("canvass_area_assignments")
      .select("area_id, user_id")
      .eq("tenant_id", activeTenantId)
      .eq("is_active", true);
    setAssignments((data as AreaAssignment[]) || []);
  };

  const getAreaAssignees = (areaId: string): string[] => {
    return assignments.filter(a => a.area_id === areaId).map(a => a.user_id);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      {/* Map */}
      <div className="flex-1 min-h-[400px] rounded-lg overflow-hidden border">
        <div ref={mapRef} className="w-full h-full" />
      </div>

      {/* Sidebar */}
      <Card className="w-full lg:w-80 flex-shrink-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Canvass Areas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Draw controls */}
          <div className="space-y-2">
            <Button size="sm" variant="outline" onClick={startDrawing} className="w-full">
              <Plus className="h-3.5 w-3.5 mr-1" /> Draw New Area
            </Button>
            {drawnPolygon && (
              <div className="space-y-2 p-2 border rounded-md bg-muted/50">
                <div>
                  <Label className="text-xs">Area Name</Label>
                  <Input
                    value={newAreaName}
                    onChange={(e) => setNewAreaName(e.target.value)}
                    placeholder="e.g. North Sarasota"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Color</Label>
                  <input
                    type="color"
                    value={newAreaColor}
                    onChange={(e) => setNewAreaColor(e.target.value)}
                    className="h-6 w-8 rounded border cursor-pointer"
                  />
                </div>
                <Button size="sm" onClick={saveArea} disabled={saving} className="w-full">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                  Save Area
                </Button>
              </div>
            )}
          </div>

          {/* Existing areas */}
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2">
              {loading && (
                <div className="text-xs text-muted-foreground text-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                </div>
              )}
              {!loading && areas.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No areas yet</p>
              )}
              {areas.map((area) => {
                const assignees = getAreaAssignees(area.id);
                return (
                  <div key={area.id} className="border rounded-md p-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <div
                          className="h-3 w-3 rounded-full border"
                          style={{ backgroundColor: area.color }}
                        />
                        <span className="text-xs font-medium">{area.name}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => deleteArea(area.id)}
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>

                    {/* Live stats */}
                    {activeTenantId && (
                      <LiveAreaStatsBadge
                        tenantId={activeTenantId}
                        areaId={area.id}
                        compact
                      />
                    )}

                    {/* Rep assignment */}
                    <div className="flex items-center gap-1 flex-wrap">
                      {assignees.map(uid => {
                        const member = teamMembers.find(m => m.id === uid);
                        return (
                          <Badge key={uid} variant="secondary" className="text-[10px] px-1.5 py-0">
                            {member?.first_name || 'Rep'}
                          </Badge>
                        );
                      })}

                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-5 w-5">
                            <Users className="h-3 w-3" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-2 z-[200] bg-popover" align="start">
                          <p className="text-xs font-medium mb-2">Assign Reps</p>
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {teamMembers.map(member => {
                              const isAssigned = assignees.includes(member.id);
                              return (
                                <label
                                  key={member.id}
                                  className="flex items-center gap-2 p-1 rounded hover:bg-muted cursor-pointer text-xs"
                                >
                                  <Checkbox
                                    checked={isAssigned}
                                    onCheckedChange={() => toggleRepAssignment(area.id, member.id, isAssigned)}
                                  />
                                  <span className="truncate">{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email || 'Unknown'}</span>
                                </label>
                              );
                            })}
                            {teamMembers.length === 0 && (
                              <p className="text-xs text-muted-foreground py-2 text-center">No team members</p>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
