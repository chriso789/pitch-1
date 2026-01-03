import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Route, 
  MapPin, 
  Clock, 
  Navigation,
  Sparkles,
  GripVertical,
  Loader2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface RouteStop {
  id: string;
  address: string;
  latitude: number;
  longitude: number;
  scheduled_start_time: string | null;
  stop_order: number;
  status: string;
}

interface CrewOption {
  id: string;
  name: string;
}

interface CrewRouteOptimizerProps {
  selectedCrewId: string | null;
}

export function CrewRouteOptimizer({ selectedCrewId }: CrewRouteOptimizerProps) {
  const [crewOptions, setCrewOptions] = useState<CrewOption[]>([]);
  const [selectedCrew, setSelectedCrew] = useState<string | null>(selectedCrewId);
  const [routeStops, setRouteStops] = useState<RouteStop[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [routeStats, setRouteStats] = useState<{
    totalDistance: number;
    totalDuration: number;
    stopsCount: number;
  } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadCrewOptions();
  }, []);

  useEffect(() => {
    if (selectedCrewId) {
      setSelectedCrew(selectedCrewId);
    }
  }, [selectedCrewId]);

  useEffect(() => {
    if (selectedCrew) {
      loadCrewRoute(selectedCrew);
    }
  }, [selectedCrew]);

  const loadCrewOptions = async () => {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("id, first_name, last_name");

      if (data) {
        setCrewOptions(
          data.map((p) => ({
            id: p.id,
            name: `${p.first_name || ""} ${p.last_name || ""}`.trim() || "Unknown",
          }))
        );
      }
    } catch (error) {
      console.error("Error loading crew options:", error);
    }
  };

  const loadCrewRoute = async (crewId: string) => {
    try {
      setIsLoading(true);
      const today = new Date().toISOString().split("T")[0];

      // Load assignments for selected crew
      const { data: assignments, error } = await supabase
        .from("crew_assignments")
        .select("*")
        .eq("crew_id", crewId)
        .eq("assignment_date", today)
        .neq("status", "completed")
        .order("stop_order", { ascending: true });

      if (error) throw error;

      const stops: RouteStop[] = (assignments || []).map((a: any, index: number) => ({
        id: a.id,
        address: a.address || "Unknown",
        latitude: a.latitude,
        longitude: a.longitude,
        scheduled_start_time: a.scheduled_start_time,
        stop_order: a.stop_order || index + 1,
        status: a.status,
      }));

      setRouteStops(stops);

      // Set route stats based on stops
      setRouteStats({
        totalDistance: 0, // Will be calculated by optimize function
        totalDuration: stops.length * 60, // Estimate 60 min per stop
        stopsCount: stops.length,
      });
    } catch (error) {
      console.error("Error loading crew route:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const optimizeRoute = async () => {
    if (!selectedCrew) return;

    try {
      setIsOptimizing(true);

      const { data, error } = await supabase.functions.invoke("optimize-crew-route", {
        body: {
          crew_id: selectedCrew,
          date: new Date().toISOString().split("T")[0],
        },
      });

      if (error) throw error;

      toast({
        title: "Route Optimized",
        description: `Saved ${data.saved_miles?.toFixed(1) || 0} miles and ${data.saved_minutes || 0} minutes`,
      });

      // Reload the route
      loadCrewRoute(selectedCrew);
    } catch (error: any) {
      console.error("Error optimizing route:", error);
      toast({
        title: "Optimization Failed",
        description: error.message || "Could not optimize route",
        variant: "destructive",
      });
    } finally {
      setIsOptimizing(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "assigned":
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600">Pending</Badge>;
      case "en_route":
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-600">En Route</Badge>;
      case "on_site":
        return <Badge variant="outline" className="bg-green-500/10 text-green-600">On Site</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Route className="h-5 w-5" />
          Route Optimizer
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Select Crew</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select value={selectedCrew || ""} onValueChange={setSelectedCrew}>
              <SelectTrigger>
                <SelectValue placeholder="Select crew member..." />
              </SelectTrigger>
              <SelectContent>
                {crewOptions.map((crew) => (
                  <SelectItem key={crew.id} value={crew.id}>
                    {crew.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button 
              className="w-full" 
              onClick={optimizeRoute}
              disabled={!selectedCrew || isOptimizing}
            >
              {isOptimizing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Optimizing...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Optimize Route
                </>
              )}
            </Button>

            {routeStats && (
              <div className="pt-4 border-t space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Stops:</span>
                  <span className="font-medium">{routeStats.stopsCount}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Distance:</span>
                  <span className="font-medium">{routeStats.totalDistance.toFixed(1)} mi</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Est. Duration:</span>
                  <span className="font-medium">
                    {Math.floor(routeStats.totalDuration / 60)}h {routeStats.totalDuration % 60}m
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Route Stops */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Route Stops</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !selectedCrew ? (
              <div className="text-center py-8 text-muted-foreground">
                Select a crew member to view their route
              </div>
            ) : routeStops.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No stops assigned for today
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {routeStops.map((stop, index) => (
                    <div
                      key={stop.id}
                      className="flex items-start gap-3 p-3 border rounded-lg bg-card hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                          {index + 1}
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2">
                            <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                            <span className="text-sm font-medium">{stop.address}</span>
                          </div>
                          {getStatusBadge(stop.status)}
                        </div>

                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                          {stop.scheduled_start_time && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Scheduled: {new Date(stop.scheduled_start_time).toLocaleTimeString([], { 
                                hour: "numeric", 
                                minute: "2-digit" 
                              })}
                            </span>
                          )}
                        </div>
                      </div>

                      <Button size="sm" variant="outline" asChild>
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${stop.latitude},${stop.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Navigation className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
