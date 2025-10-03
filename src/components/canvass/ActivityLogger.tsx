import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Camera, Clock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export function ActivityLogger() {
  const queryClient = useQueryClient();
  const [activityType, setActivityType] = useState<string>("door_knock");
  const [notes, setNotes] = useState("");
  const [gpsVerifying, setGpsVerifying] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);

  const getLocation = () => {
    setGpsVerifying(true);
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          setGpsVerifying(false);
          toast.success("Location captured!");
        },
        (error) => {
          setGpsVerifying(false);
          toast.error("Failed to get location. Please enable GPS.");
          console.error("Geolocation error:", error);
        }
      );
    } else {
      setGpsVerifying(false);
      toast.error("Geolocation is not supported by your browser");
    }
  };

  const logActivityMutation = useMutation({
    mutationFn: async (data: any) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("canvass_activity_log").insert({
        tenant_id: user.user_metadata.tenant_id,
        user_id: user.id,
        activity_type: data.activityType,
        activity_data: data.activityData,
        latitude: data.latitude,
        longitude: data.longitude,
        verified: !!data.latitude && !!data.longitude,
      });

      if (error) throw error;

      // Trigger achievement processing
      await supabase.functions.invoke("process-achievement-unlock", {
        body: { user_id: user.id },
      });

      // Trigger competition score update
      await supabase.functions.invoke("update-competition-scores", {
        body: { user_id: user.id },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-activity-stats"] });
      queryClient.invalidateQueries({ queryKey: ["activity-stats"] });
      toast.success("Activity logged successfully!");
      setNotes("");
      setLocation(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to log activity");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!location) {
      toast.error("Please capture your GPS location first");
      return;
    }

    logActivityMutation.mutate({
      activityType,
      activityData: {
        notes,
        timestamp: new Date().toISOString(),
      },
      latitude: location.lat,
      longitude: location.lng,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log Activity</CardTitle>
        <CardDescription>Record your canvassing activities with GPS verification</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="activity-type">Activity Type</Label>
            <Select value={activityType} onValueChange={setActivityType}>
              <SelectTrigger id="activity-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="door_knock">Door Knock</SelectItem>
                <SelectItem value="lead_created">Lead Created</SelectItem>
                <SelectItem value="photo_upload">Photo Upload</SelectItem>
                <SelectItem value="appointment_set">Appointment Set</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any additional details..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>GPS Verification</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={getLocation}
                disabled={gpsVerifying || !!location}
                className="flex-1"
              >
                {gpsVerifying && <Clock className="h-4 w-4 mr-2 animate-spin" />}
                {!gpsVerifying && location && <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />}
                {!gpsVerifying && !location && <MapPin className="h-4 w-4 mr-2" />}
                {location ? "Location Captured" : "Capture Location"}
              </Button>
            </div>
            {location && (
              <p className="text-xs text-muted-foreground">
                Lat: {location.lat.toFixed(6)}, Lng: {location.lng.toFixed(6)}
              </p>
            )}
          </div>

          <Button type="submit" disabled={logActivityMutation.isPending || !location} className="w-full">
            {logActivityMutation.isPending ? "Logging..." : "Log Activity"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
