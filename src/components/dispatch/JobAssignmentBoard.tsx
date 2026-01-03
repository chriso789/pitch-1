import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  MapPin, 
  Clock, 
  User,
  ChevronRight,
  Plus
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface CrewAssignment {
  id: string;
  crew_id: string | null;
  job_id: string | null;
  address: string;
  latitude: number;
  longitude: number;
  status: string;
  assignment_date: string;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  notes: string | null;
}

interface CrewOption {
  id: string;
  name: string;
}

const STATUS_COLUMNS = [
  { id: "unassigned", label: "Unassigned", color: "bg-muted" },
  { id: "assigned", label: "Assigned", color: "bg-yellow-500" },
  { id: "en_route", label: "En Route", color: "bg-blue-500" },
  { id: "on_site", label: "On Site", color: "bg-green-500" },
  { id: "completed", label: "Completed", color: "bg-muted" },
];

export function JobAssignmentBoard() {
  const [assignments, setAssignments] = useState<CrewAssignment[]>([]);
  const [crewOptions, setCrewOptions] = useState<CrewOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    loadAssignments();
    loadCrewOptions();
  }, []);

  const loadAssignments = async () => {
    try {
      setIsLoading(true);
      const today = new Date().toISOString().split("T")[0];
      
      const { data, error } = await supabase
        .from("crew_assignments")
        .select("*")
        .gte("assignment_date", today)
        .order("scheduled_start_time", { ascending: true });

      if (error) throw error;
      
      const mappedAssignments: CrewAssignment[] = (data || []).map((a: any) => ({
        id: a.id,
        crew_id: a.crew_id,
        job_id: a.job_id,
        address: a.address || "Unknown",
        latitude: a.latitude,
        longitude: a.longitude,
        status: a.status,
        assignment_date: a.assignment_date,
        scheduled_start_time: a.scheduled_start_time,
        scheduled_end_time: a.scheduled_end_time,
        notes: a.notes,
      }));
      
      setAssignments(mappedAssignments);
    } catch (error) {
      console.error("Error loading assignments:", error);
    } finally {
      setIsLoading(false);
    }
  };

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

  const updateAssignmentStatus = async (assignmentId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from("crew_assignments")
        .update({ 
          status: newStatus,
          ...(newStatus === "on_site" ? { arrival_time: new Date().toISOString() } : {}),
          ...(newStatus === "completed" ? { completion_time: new Date().toISOString() } : {}),
        })
        .eq("id", assignmentId);

      if (error) throw error;

      setAssignments((prev) =>
        prev.map((a) => (a.id === assignmentId ? { ...a, status: newStatus } : a))
      );

      toast({
        title: "Status Updated",
        description: `Assignment moved to ${newStatus}`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const assignCrew = async (assignmentId: string, crewId: string) => {
    try {
      const { error } = await supabase
        .from("crew_assignments")
        .update({ 
          crew_id: crewId,
          status: "assigned",
        })
        .eq("id", assignmentId);

      if (error) throw error;

      setAssignments((prev) =>
        prev.map((a) => 
          a.id === assignmentId ? { ...a, crew_id: crewId, status: "assigned" } : a
        )
      );

      toast({
        title: "Crew Assigned",
        description: "Assignment updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getAssignmentsByStatus = (status: string) => {
    if (status === "unassigned") {
      return assignments.filter((a) => !a.crew_id);
    }
    return assignments.filter((a) => a.status === status && a.crew_id);
  };

  const getCrewName = (crewId: string | null) => {
    if (!crewId) return null;
    return crewOptions.find((c) => c.id === crewId)?.name;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Job Assignment Board</h2>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Add Assignment
        </Button>
      </div>

      <div className="grid grid-cols-5 gap-4 min-h-[600px]">
        {STATUS_COLUMNS.map((column) => (
          <div key={column.id} className="flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-3 h-3 rounded-full ${column.color}`} />
              <h3 className="font-medium">{column.label}</h3>
              <Badge variant="secondary" className="ml-auto">
                {getAssignmentsByStatus(column.id).length}
              </Badge>
            </div>

            <ScrollArea className="flex-1 pr-2">
              <div className="space-y-2">
                {getAssignmentsByStatus(column.id).map((assignment) => (
                  <Card key={assignment.id} className="cursor-move hover:shadow-md transition-shadow">
                    <CardContent className="p-3">
                      <div className="space-y-2">
                        <div className="flex items-start gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                          <span className="text-sm font-medium line-clamp-2">
                            {assignment.address}
                          </span>
                        </div>

                        {assignment.scheduled_start_time && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {format(new Date(assignment.scheduled_start_time), "h:mm a")}
                          </div>
                        )}

                        {column.id === "unassigned" ? (
                          <Select onValueChange={(value) => assignCrew(assignment.id, value)}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Assign crew..." />
                            </SelectTrigger>
                            <SelectContent>
                              {crewOptions.map((crew) => (
                                <SelectItem key={crew.id} value={crew.id}>
                                  {crew.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <User className="h-3 w-3" />
                              {getCrewName(assignment.crew_id)}
                            </div>
                            {column.id !== "completed" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2"
                                onClick={() => {
                                  const currentIndex = STATUS_COLUMNS.findIndex(
                                    (c) => c.id === column.id
                                  );
                                  const nextStatus = STATUS_COLUMNS[currentIndex + 1]?.id;
                                  if (nextStatus) {
                                    updateAssignmentStatus(assignment.id, nextStatus);
                                  }
                                }}
                              >
                                <ChevronRight className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        )}

                        {assignment.notes && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {assignment.notes}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </div>
        ))}
      </div>
    </div>
  );
}
