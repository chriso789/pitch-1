import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Clock, 
  Camera, 
  MessageSquare, 
  ClipboardList, 
  MapPin,
  Play,
  Square,
  CheckCircle,
  Upload,
  Send,
  Wrench,
  Calendar,
  LogOut,
  Navigation,
  Loader2,
  AlertTriangle,
  FileCheck
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useCrewDashboard, CrewJobAssignment } from "@/hooks/useCrewDashboard";
import { useCrewAuth } from "@/hooks/useCrewAuth";
import { CrewPhotoUpload } from "./CrewPhotoUpload";

interface TimeEntry {
  id: string;
  clock_in: string;
  clock_out: string | null;
  work_order_id: string;
  notes: string;
}

export function CrewPortal() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [currentTimeEntry, setCurrentTimeEntry] = useState<TimeEntry | null>(null);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isTrackingLocation, setIsTrackingLocation] = useState(false);
  const [lastLocationUpdate, setLastLocationUpdate] = useState<Date | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [showPhotoUpload, setShowPhotoUpload] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const { toast } = useToast();

  // Use the new crew hooks
  const { jobs, counts, docsStatus, loading, error, refetch } = useCrewDashboard();
  const { user, crewUser, crewProfile, activeCompany, loading: authLoading } = useCrewAuth();

  const handleClockIn = async () => {
    try {
      if (!user) return;

      let location = null;
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
          });
          location = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          };
        } catch (e) {
          console.log("Could not get location for clock in");
        }
      }

      const { data, error } = await supabase
        .from("crew_time_entries")
        .insert({
          crew_member_id: user.id,
          tenant_id: activeCompany?.companyId,
          clock_in: new Date().toISOString(),
          location_in: location
        })
        .select()
        .single();

      if (error) throw error;

      setCurrentTimeEntry(data);
      setTimeEntries(prev => [data, ...prev]);
      toast({
        title: "Clocked In",
        description: `Started at ${format(new Date(), "h:mm a")}`
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const handleClockOut = async () => {
    if (!currentTimeEntry) return;

    try {
      let location = null;
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
          });
          location = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          };
        } catch (e) {
          console.log("Could not get location for clock out");
        }
      }

      const { error } = await supabase
        .from("crew_time_entries")
        .update({
          clock_out: new Date().toISOString(),
          location_out: location
        })
        .eq("id", currentTimeEntry.id);

      if (error) throw error;

      setCurrentTimeEntry(null);
      toast({
        title: "Clocked Out",
        description: `Ended at ${format(new Date(), "h:mm a")}`
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const updateJobStatus = async (jobId: string, newStatus: string) => {
    try {
      const { error } = await supabase.rpc('update_crew_job_status' as any, {
        p_assignment_id: jobId,
        p_new_status: newStatus
      });

      if (error) throw error;

      toast({
        title: "Status Updated",
        description: `Job marked as ${newStatus.replace("_", " ")}`
      });
      refetch();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !user) return;

    try {
      // For now, use portal messages - can be updated to crew-specific messaging
      const { error } = await supabase
        .from("portal_messages")
        .insert({
          tenant_id: activeCompany?.companyId,
          sender_type: "crew",
          sender_id: user.id,
          recipient_type: "admin",
          message: newMessage
        });

      if (error) throw error;

      setNewMessage("");
      toast({
        title: "Message Sent",
        description: "Your message has been delivered"
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "assigned": return "bg-muted text-muted-foreground";
      case "en_route": return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "on_site": return "bg-amber-500/10 text-amber-500 border-amber-500/20";
      case "work_started": return "bg-primary/10 text-primary border-primary/20";
      case "waiting": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      case "completed": return "bg-green-500/10 text-green-500 border-green-500/20";
      default: return "bg-muted text-muted-foreground";
    }
  };

  // GPS Tracking Functions
  const startLocationTracking = async () => {
    if (!navigator.geolocation) {
      toast({
        title: "GPS Not Supported",
        description: "Your device doesn't support GPS tracking",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsTrackingLocation(true);
      
      watchIdRef.current = navigator.geolocation.watchPosition(
        async (position) => {
          await syncGPSLocation(position);
        },
        (error) => {
          console.error("GPS error:", error);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 30000,
          timeout: 10000,
        }
      );

      toast({
        title: "GPS Tracking Started",
        description: "Your location is now being tracked",
      });
    } catch (error: any) {
      setIsTrackingLocation(false);
    }
  };

  const stopLocationTracking = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTrackingLocation(false);
    toast({
      title: "GPS Tracking Stopped",
      description: "Location tracking has been disabled",
    });
  };

  const syncGPSLocation = async (position: GeolocationPosition) => {
    try {
      if (!user || !activeCompany) return;

      await supabase.functions.invoke("crew-gps-sync", {
        body: {
          crew_id: user.id,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
        },
      });

      setLastLocationUpdate(new Date());
    } catch (error) {
      console.error("Error syncing GPS location:", error);
    }
  };

  const handlePhotoUpload = async (file: File) => {
    if (!selectedJobId || !user || !activeCompany) return;
    
    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${crypto.randomUUID()}.${fileExt}`;
      const storagePath = `${activeCompany.companyId}/${selectedJobId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('crew-job-photos')
        .upload(storagePath, file);

      if (uploadError) throw uploadError;

      // Insert record via RPC
      const { error: insertError } = await supabase.rpc('insert_crew_job_photo' as any, {
        p_company_id: activeCompany.companyId,
        p_assignment_id: selectedJobId,
        p_bucket_id: 'before',
        p_storage_path: storagePath,
        p_original_filename: file.name,
        p_gps_lat: null,
        p_gps_lng: null
      });

      if (insertError) throw insertError;

      toast({
        title: "Photo Uploaded",
        description: "Photo has been added to the job"
      });
      refetch();
    } catch (error: any) {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsUploading(false);
      setShowPhotoUpload(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="p-6 text-center">
          <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <p className="text-destructive">{error}</p>
          <Button className="mt-4" onClick={() => refetch()}>Retry</Button>
        </Card>
      </div>
    );
  }

  const displayName = crewProfile?.primaryContactName || 
    crewProfile?.legalBusinessName || 
    user?.email?.split('@')[0] || 
    'Crew Member';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border sticky top-0 z-50">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback>
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold text-foreground">{displayName}</p>
              <p className="text-xs text-muted-foreground">
                {activeCompany?.companyName || 'Crew Portal'}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Stats Banner */}
      <div className="bg-primary/5 border-b border-primary/20 px-4 py-3">
        <div className="grid grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-primary">{counts.today}</p>
            <p className="text-xs text-muted-foreground">Today</p>
          </div>
          <div>
            <p className="text-2xl font-bold">{counts.upcoming}</p>
            <p className="text-xs text-muted-foreground">Upcoming</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-amber-500">{counts.blocked}</p>
            <p className="text-xs text-muted-foreground">Blocked</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-green-500">{counts.completedThisWeek}</p>
            <p className="text-xs text-muted-foreground">This Week</p>
          </div>
        </div>
      </div>

      {/* Docs Status Alert */}
      {docsStatus !== 'valid' && (
        <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span className="text-sm text-destructive">
            {docsStatus === 'expired' ? 'Documents expired - update required' : 'Documents expiring soon'}
          </span>
        </div>
      )}

      {/* Time Clock Banner */}
      <div className="bg-muted/50 border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            {currentTimeEntry ? (
              <span className="text-sm font-medium">
                Clocked in since {format(new Date(currentTimeEntry.clock_in), "h:mm a")}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">Not clocked in</span>
            )}
          </div>
          {currentTimeEntry ? (
            <Button size="sm" variant="destructive" onClick={handleClockOut}>
              <Square className="h-4 w-4 mr-1" />
              Clock Out
            </Button>
          ) : (
            <Button size="sm" onClick={handleClockIn}>
              <Play className="h-4 w-4 mr-1" />
              Clock In
            </Button>
          )}
        </div>
      </div>

      {/* GPS Tracking Banner */}
      <div className="bg-card border-b px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Navigation className="h-4 w-4 text-muted-foreground" />
            {isTrackingLocation ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-green-600 font-medium flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  GPS Active
                </span>
                {lastLocationUpdate && (
                  <span className="text-xs text-muted-foreground">
                    Last sync: {format(lastLocationUpdate, "h:mm:ss a")}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">GPS tracking off</span>
            )}
          </div>
          {isTrackingLocation ? (
            <Button size="sm" variant="outline" onClick={stopLocationTracking}>
              Stop Tracking
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={startLocationTracking}>
              <Navigation className="h-4 w-4 mr-1" />
              Start GPS
            </Button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start rounded-none border-b bg-card px-4 h-12">
          <TabsTrigger value="dashboard" className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            Jobs
          </TabsTrigger>
          <TabsTrigger value="navigation" className="flex items-center gap-2">
            <Navigation className="h-4 w-4" />
            Navigate
          </TabsTrigger>
          <TabsTrigger value="time" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Time
          </TabsTrigger>
          <TabsTrigger value="photos" className="flex items-center gap-2">
            <Camera className="h-4 w-4" />
            Photos
          </TabsTrigger>
          <TabsTrigger value="messages" className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Messages
          </TabsTrigger>
        </TabsList>

        <div className="p-4">
          <TabsContent value="dashboard" className="mt-0 space-y-4">
            <h2 className="text-lg font-semibold">Job Assignments</h2>
            {jobs.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Wrench className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No jobs assigned</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {jobs.map((job: CrewJobAssignment) => (
                  <Card key={job.id} className={job.isLocked ? 'border-destructive/50' : ''}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <h3 className="font-medium">{job.scopeSummary || 'Job Assignment'}</h3>
                          <p className="text-sm text-muted-foreground">
                            {job.scheduledDate ? format(new Date(job.scheduledDate), "MMM d, yyyy") : 'No date scheduled'}
                          </p>
                        </div>
                        <Badge variant="outline" className={getStatusColor(job.status)}>
                          {job.status.replace("_", " ")}
                        </Badge>
                      </div>
                      
                      {job.arrivalWindowStart && job.arrivalWindowEnd && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                          <Clock className="h-4 w-4" />
                          <span>
                            {format(new Date(job.arrivalWindowStart), "h:mm a")} - {format(new Date(job.arrivalWindowEnd), "h:mm a")}
                          </span>
                        </div>
                      )}

                      {job.specialInstructions && (
                        <p className="text-sm text-muted-foreground mb-3 bg-muted/50 p-2 rounded">
                          {job.specialInstructions}
                        </p>
                      )}

                      {/* Progress indicators */}
                      <div className="flex gap-4 mb-3 text-sm">
                        <div className="flex items-center gap-1">
                          <Camera className="h-4 w-4" />
                          <span>{job.photoProgress.current}/{job.photoProgress.required} photos</span>
                          {job.photosComplete && <CheckCircle className="h-4 w-4 text-green-500" />}
                        </div>
                        <div className="flex items-center gap-1">
                          <ClipboardList className="h-4 w-4" />
                          <span>{job.checklistProgress.current}/{job.checklistProgress.required} items</span>
                          {job.checklistComplete && <CheckCircle className="h-4 w-4 text-green-500" />}
                        </div>
                        {job.docsValid && (
                          <div className="flex items-center gap-1 text-green-600">
                            <FileCheck className="h-4 w-4" />
                            <span>Docs valid</span>
                          </div>
                        )}
                      </div>

                      {job.isLocked && (
                        <div className="flex items-center gap-2 text-sm text-destructive mb-3">
                          <AlertTriangle className="h-4 w-4" />
                          <span>{job.lockReason || job.blockedReason || 'Job is locked'}</span>
                        </div>
                      )}

                      <div className="flex gap-2">
                        {job.status === "assigned" && !job.isLocked && (
                          <Button size="sm" onClick={() => updateJobStatus(job.id, "en_route")}>
                            <Navigation className="h-4 w-4 mr-1" />
                            En Route
                          </Button>
                        )}
                        {job.status === "en_route" && (
                          <Button size="sm" onClick={() => updateJobStatus(job.id, "on_site")}>
                            <MapPin className="h-4 w-4 mr-1" />
                            On Site
                          </Button>
                        )}
                        {job.status === "on_site" && (
                          <Button size="sm" onClick={() => updateJobStatus(job.id, "work_started")}>
                            <Play className="h-4 w-4 mr-1" />
                            Start Work
                          </Button>
                        )}
                        {job.status === "work_started" && job.canComplete && (
                          <Button size="sm" onClick={() => updateJobStatus(job.id, "completed")}>
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Complete
                          </Button>
                        )}
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => {
                            setSelectedJobId(job.id);
                            setShowPhotoUpload(true);
                          }}
                        >
                          <Camera className="h-4 w-4 mr-1" />
                          Add Photo
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="navigation" className="mt-0 space-y-4">
            <h2 className="text-lg font-semibold">Today's Route</h2>
            {jobs.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Navigation className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No stops assigned for today</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {jobs.filter(j => j.scheduledDate === new Date().toISOString().split('T')[0]).map((job, index) => (
                  <Card key={job.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold">
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <h3 className="font-medium">{job.scopeSummary || 'Job Site'}</h3>
                          <p className="text-sm text-muted-foreground">
                            {job.arrivalWindowStart ? format(new Date(job.arrivalWindowStart), "h:mm a") : 'TBD'}
                          </p>
                        </div>
                        <Badge variant="outline" className={getStatusColor(job.status)}>
                          {job.status.replace("_", " ")}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="time" className="mt-0 space-y-4">
            <h2 className="text-lg font-semibold">Time Entries</h2>
            {timeEntries.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No time entries today</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {timeEntries.map((entry) => (
                  <Card key={entry.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">
                            {format(new Date(entry.clock_in), "h:mm a")}
                            {entry.clock_out && ` - ${format(new Date(entry.clock_out), "h:mm a")}`}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {entry.clock_out 
                              ? `${Math.round((new Date(entry.clock_out).getTime() - new Date(entry.clock_in).getTime()) / 3600000 * 10) / 10} hours`
                              : "In progress..."
                            }
                          </p>
                        </div>
                        {!entry.clock_out && (
                          <Badge className="bg-green-500/10 text-green-500">Active</Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="photos" className="mt-0 space-y-4">
            <h2 className="text-lg font-semibold">Project Photos</h2>
            {jobs.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Camera className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No jobs to upload photos for</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {jobs.map(job => (
                  <Card key={job.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h3 className="font-medium">{job.scopeSummary || 'Job'}</h3>
                          <p className="text-sm text-muted-foreground">
                            {job.photoProgress.current}/{job.photoProgress.required} photos uploaded
                          </p>
                        </div>
                        {job.photosComplete && (
                          <Badge className="bg-green-500/10 text-green-500">Complete</Badge>
                        )}
                      </div>
                      <Button 
                        onClick={() => {
                          setSelectedJobId(job.id);
                          setShowPhotoUpload(true);
                        }}
                      >
                        <Camera className="h-4 w-4 mr-2" />
                        Upload Photo
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="messages" className="mt-0 space-y-4">
            <h2 className="text-lg font-semibold">Messages</h2>
            <Card className="flex flex-col h-[400px]">
              <ScrollArea className="flex-1 p-4">
                <div className="text-center text-muted-foreground py-8">
                  <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Messages coming soon</p>
                </div>
              </ScrollArea>
              <div className="p-4 border-t">
                <div className="flex gap-2">
                  <Input 
                    placeholder="Type a message..." 
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && sendMessage()}
                  />
                  <Button onClick={sendMessage}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          </TabsContent>
        </div>
      </Tabs>

      {/* Photo Upload Modal */}
      {showPhotoUpload && selectedJobId && (
        <CrewPhotoUpload
          jobId={selectedJobId}
          bucketId="before"
          bucketLabel="Job Photo"
          onUpload={handlePhotoUpload}
          uploading={isUploading}
          onClose={() => {
            setShowPhotoUpload(false);
            setSelectedJobId(null);
          }}
        />
      )}
    </div>
  );
}

export default CrewPortal;
