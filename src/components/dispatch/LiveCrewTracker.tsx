import { useEffect, useState } from "react";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { 
  Users, 
  MapPin, 
  Clock, 
  Gauge,
  Search
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

interface CrewMember {
  id: string;
  name: string;
  avatar_url?: string;
  status: "active" | "idle" | "offline";
  location?: {
    latitude: number;
    longitude: number;
    speed: number | null;
    heading: number | null;
    last_update: string;
  };
  current_job?: string;
}

interface LiveCrewTrackerProps {
  onCrewSelect: (crewId: string | null) => void;
  selectedCrewId: string | null;
}

export function LiveCrewTracker({ onCrewSelect, selectedCrewId }: LiveCrewTrackerProps) {
  const [crewMembers, setCrewMembers] = useState<CrewMember[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadCrewMembers();
    
    // Subscribe to real-time location updates
    const channel = supabase
      .channel("crew-tracker")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "crew_locations",
        },
        (payload) => {
          handleLocationUpdate(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadCrewMembers = async () => {
    try {
      setIsLoading(true);
      
      // Get all profiles (we'll filter by those with locations)
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, avatar_url, role");

      if (error) throw error;

      // Get latest locations for each crew
      const { data: locations } = await supabase
        .from("crew_locations")
        .select("*")
        .eq("is_active", true);

      // Get today's assignments
      const today = new Date().toISOString().split("T")[0];
      const { data: assignments } = await supabase
        .from("crew_assignments")
        .select("*")
        .eq("assignment_date", today)
        .in("status", ["assigned", "en_route", "on_site"]);

      // Build crew members from profiles that have locations or assignments
      const crewUserIds = new Set([
        ...(locations || []).map((l: any) => l.user_id),
        ...(assignments || []).map((a: any) => a.crew_id),
      ]);

      const members: CrewMember[] = (profiles || [])
        .filter((profile) => crewUserIds.has(profile.id))
        .map((profile) => {
          const location = (locations || []).find((l: any) => l.user_id === profile.id);
          const assignment = (assignments || []).find((a: any) => a.crew_id === profile.id);
          
          const lastUpdate = location?.recorded_at;
          const isRecent = lastUpdate && 
            new Date().getTime() - new Date(lastUpdate).getTime() < 5 * 60 * 1000; // 5 minutes

          return {
            id: profile.id,
            name: `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || "Unknown",
            avatar_url: profile.avatar_url || undefined,
            status: isRecent ? "active" : location ? "idle" : "offline",
            location: location ? {
              latitude: location.latitude,
              longitude: location.longitude,
              speed: location.speed,
              heading: location.heading,
              last_update: location.recorded_at,
            } : undefined,
            current_job: assignment?.address,
          };
        });

      setCrewMembers(members);
    } catch (error) {
      console.error("Error loading crew members:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLocationUpdate = (newLocation: any) => {
    setCrewMembers((prev) =>
      prev.map((member) => {
        if (member.id === newLocation.user_id) {
          return {
            ...member,
            status: "active" as const,
            location: {
              latitude: newLocation.latitude,
              longitude: newLocation.longitude,
              speed: newLocation.speed,
              heading: newLocation.heading,
              last_update: newLocation.recorded_at,
            },
          };
        }
        return member;
      })
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-green-500";
      case "idle": return "bg-yellow-500";
      case "offline": return "bg-muted";
      default: return "bg-muted";
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active": return "bg-green-500/10 text-green-600 border-green-500/20";
      case "idle": return "bg-yellow-500/10 text-yellow-600 border-yellow-500/20";
      case "offline": return "bg-muted text-muted-foreground";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const filteredMembers = crewMembers.filter((member) =>
    member.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeCount = crewMembers.filter((m) => m.status === "active").length;
  const totalCount = crewMembers.length;

  return (
    <div className="h-full flex flex-col">
      <CardHeader className="border-b shrink-0">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="h-5 w-5" />
          Crew Tracker
        </CardTitle>
        <div className="flex items-center gap-2 mt-2">
          <Badge variant="outline" className="bg-green-500/10 text-green-600">
            {activeCount} Active
          </Badge>
          <Badge variant="outline">
            {totalCount} Total
          </Badge>
        </div>
      </CardHeader>

      <div className="p-3 border-b shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search crew..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading crew...
            </div>
          ) : filteredMembers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No crew members found
            </div>
          ) : (
            filteredMembers.map((member) => (
              <Card
                key={member.id}
                className={cn(
                  "cursor-pointer transition-all hover:bg-accent",
                  selectedCrewId === member.id && "ring-2 ring-primary"
                )}
                onClick={() => onCrewSelect(member.id)}
              >
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="relative">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={member.avatar_url} />
                        <AvatarFallback>
                          {member.name.split(" ").map((n) => n[0]).join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div 
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background",
                          getStatusColor(member.status)
                        )} 
                      />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="font-medium truncate">{member.name}</p>
                        <Badge variant="outline" className={cn("text-xs", getStatusBadge(member.status))}>
                          {member.status}
                        </Badge>
                      </div>
                      
                      {member.current_job && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate">{member.current_job}</span>
                        </div>
                      )}
                      
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        {member.location?.speed != null && (
                          <span className="flex items-center gap-1">
                            <Gauge className="h-3 w-3" />
                            {Math.round(member.location.speed * 2.237)} mph
                          </span>
                        )}
                        {member.location?.last_update && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDistanceToNow(new Date(member.location.last_update), { addSuffix: true })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
