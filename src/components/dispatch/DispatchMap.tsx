import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, RefreshCw } from "lucide-react";

interface CrewLocation {
  id: string;
  crew_id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  is_active: boolean;
  recorded_at: string;
}

interface JobPin {
  id: string;
  latitude: number;
  longitude: number;
  address: string;
  status: string;
  assigned_crew_id: string | null;
}

interface DispatchMapProps {
  selectedCrewId: string | null;
  onCrewSelect: (crewId: string | null) => void;
}

export function DispatchMap({ selectedCrewId, onCrewSelect }: DispatchMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const crewMarkers = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const jobMarkers = useRef<Map<string, mapboxgl.Marker>>(new Map());
  
  const [mapboxToken, setMapboxToken] = useState<string>("");
  const [isMapReady, setIsMapReady] = useState(false);
  const [crewLocations, setCrewLocations] = useState<CrewLocation[]>([]);
  const [jobPins, setJobPins] = useState<JobPin[]>([]);
  const { toast } = useToast();

  // Load Mapbox token from localStorage or prompt user
  useEffect(() => {
    const savedToken = localStorage.getItem("mapbox_token");
    if (savedToken) {
      setMapboxToken(savedToken);
    }
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || !mapboxToken) return;

    mapboxgl.accessToken = mapboxToken;
    
    try {
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [-98.5795, 39.8283], // Center of US
        zoom: 4,
      });

      map.current.addControl(new mapboxgl.NavigationControl(), "top-right");

      map.current.on("load", () => {
        setIsMapReady(true);
        loadCrewLocations();
        loadJobAssignments();
      });

      return () => {
        map.current?.remove();
      };
    } catch (error) {
      console.error("Error initializing map:", error);
      toast({
        title: "Map Error",
        description: "Failed to initialize map. Check your Mapbox token.",
        variant: "destructive",
      });
    }
  }, [mapboxToken]);

  // Subscribe to real-time crew location updates
  useEffect(() => {
    if (!isMapReady) return;

    const channel = supabase
      .channel("crew-locations-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "crew_locations",
        },
        (payload) => {
          const newLocation = payload.new as any;
          updateCrewMarker({
            id: newLocation.id,
            crew_id: newLocation.crew_id,
            user_id: newLocation.user_id,
            latitude: newLocation.latitude,
            longitude: newLocation.longitude,
            accuracy: newLocation.accuracy,
            heading: newLocation.heading,
            speed: newLocation.speed,
            is_active: newLocation.is_active,
            recorded_at: newLocation.recorded_at,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isMapReady]);

  // Center map on selected crew
  useEffect(() => {
    if (!map.current || !selectedCrewId) return;

    const crewLocation = crewLocations.find((c) => c.crew_id === selectedCrewId);
    if (crewLocation) {
      map.current.flyTo({
        center: [crewLocation.longitude, crewLocation.latitude],
        zoom: 14,
        duration: 1000,
      });
    }
  }, [selectedCrewId, crewLocations]);

  const loadCrewLocations = async () => {
    try {
      const { data, error } = await supabase
        .from("crew_locations")
        .select("*")
        .eq("is_active", true);

      if (error) throw error;

      if (data) {
        const locations: CrewLocation[] = data.map((d: any) => ({
          id: d.id,
          crew_id: d.crew_id,
          user_id: d.user_id,
          latitude: d.latitude,
          longitude: d.longitude,
          accuracy: d.accuracy,
          heading: d.heading,
          speed: d.speed,
          is_active: d.is_active,
          recorded_at: d.recorded_at,
        }));
        setCrewLocations(locations);
        locations.forEach(updateCrewMarker);
      }
    } catch (error) {
      console.error("Error loading crew locations:", error);
    }
  };

  const loadJobAssignments = async () => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("crew_assignments")
        .select("*")
        .eq("assignment_date", today)
        .not("latitude", "is", null);

      if (error) throw error;

      if (data) {
        const pins: JobPin[] = data.map((a: any) => ({
          id: a.id,
          latitude: a.latitude,
          longitude: a.longitude,
          address: a.address || "Unknown",
          status: a.status,
          assigned_crew_id: a.crew_id,
        }));
        setJobPins(pins);
        pins.forEach(updateJobMarker);
      }
    } catch (error) {
      console.error("Error loading job assignments:", error);
    }
  };

  const updateCrewMarker = (location: CrewLocation) => {
    if (!map.current) return;

    const existingMarker = crewMarkers.current.get(location.crew_id);
    
    if (existingMarker) {
      existingMarker.setLngLat([location.longitude, location.latitude]);
    } else {
      // Create crew marker element
      const el = document.createElement("div");
      el.className = "crew-marker";
      el.style.cssText = `
        width: 40px;
        height: 40px;
        background: linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.8));
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
        font-size: 14px;
        cursor: pointer;
      `;
      el.innerHTML = "👷";
      el.onclick = () => onCrewSelect(location.crew_id);

      const marker = new mapboxgl.Marker(el)
        .setLngLat([location.longitude, location.latitude])
        .setPopup(
          new mapboxgl.Popup({ offset: 25 }).setHTML(`
            <div style="padding: 8px;">
              <strong>Crew Member</strong><br/>
              <span>Speed: ${location.speed ? Math.round(location.speed * 2.237) + " mph" : "N/A"}</span><br/>
              <span>Last update: ${new Date(location.recorded_at).toLocaleTimeString()}</span>
            </div>
          `)
        )
        .addTo(map.current!);

      crewMarkers.current.set(location.crew_id, marker);
    }

    // Update locations state
    setCrewLocations((prev) => {
      const existing = prev.findIndex((c) => c.crew_id === location.crew_id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = location;
        return updated;
      }
      return [...prev, location];
    });
  };

  const updateJobMarker = (job: JobPin) => {
    if (!map.current) return;

    const existingMarker = jobMarkers.current.get(job.id);
    if (existingMarker) return;

    const getStatusColor = (status: string) => {
      switch (status) {
        case "assigned": return "#f59e0b";
        case "en_route": return "#3b82f6";
        case "on_site": return "#10b981";
        case "completed": return "#6b7280";
        default: return "#ef4444";
      }
    };

    const el = document.createElement("div");
    el.style.cssText = `
      width: 30px;
      height: 30px;
      background: ${getStatusColor(job.status)};
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 2px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    `;

    const marker = new mapboxgl.Marker(el)
      .setLngLat([job.longitude, job.latitude])
      .setPopup(
        new mapboxgl.Popup({ offset: 25 }).setHTML(`
          <div style="padding: 8px;">
            <strong>${job.address}</strong><br/>
            <span>Status: ${job.status}</span>
          </div>
        `)
      )
      .addTo(map.current!);

    jobMarkers.current.set(job.id, marker);
  };

  const handleSaveToken = () => {
    if (mapboxToken) {
      localStorage.setItem("mapbox_token", mapboxToken);
      window.location.reload();
    }
  };

  if (!mapboxToken || !localStorage.getItem("mapbox_token")) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
        <Card className="p-6 max-w-md w-full mx-4">
          <div className="flex items-center gap-3 mb-4">
            <MapPin className="h-6 w-6 text-primary" />
            <h3 className="text-lg font-semibold">Mapbox Token Required</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Enter your Mapbox public token to enable the dispatch map. Get your token from{" "}
            <a href="https://mapbox.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">
              mapbox.com
            </a>
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="pk.eyJ1..."
              value={mapboxToken}
              onChange={(e) => setMapboxToken(e.target.value)}
            />
            <Button onClick={handleSaveToken}>Save</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <div ref={mapContainer} className="w-full h-full" />
      
      {/* Map Controls */}
      <div className="absolute top-4 left-4 z-10">
        <Button size="sm" variant="secondary" onClick={() => { loadCrewLocations(); loadJobAssignments(); }}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10 bg-card border rounded-lg p-3 text-sm">
        <div className="font-medium mb-2">Legend</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-primary" />
            <span>Crew Member</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <span>Job - Assigned</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500" />
            <span>Job - En Route</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span>Job - On Site</span>
          </div>
        </div>
      </div>
    </div>
  );
}
