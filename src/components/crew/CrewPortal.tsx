import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Loader2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface WorkOrder {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  scheduled_date: string;
  project: {
    name: string;
    address: string;
  };
}

interface TimeEntry {
  id: string;
  clock_in: string;
  clock_out: string | null;
  work_order_id: string;
  notes: string;
}

interface Message {
  id: string;
  message: string;
  sender_type: string;
  created_at: string;
  is_read: boolean;
}

export function CrewPortal() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentTimeEntry, setCurrentTimeEntry] = useState<TimeEntry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [crewMember, setCrewMember] = useState<any>(null);
  const [newMessage, setNewMessage] = useState("");
  const [isTrackingLocation, setIsTrackingLocation] = useState(false);
  const [lastLocationUpdate, setLastLocationUpdate] = useState<Date | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadCrewData();
    return () => {
      // Cleanup GPS tracking on unmount
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const loadCrewData = async () => {
    try {
      setIsLoading(true);
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get profile
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      
      setCrewMember(profile);

      // Load work orders assigned to this crew member
      const { data: orders } = await supabase
        .from("work_orders")
        .select("*")
        .eq("assigned_to", user.id)
        .in("status", ["pending", "in_progress"])
        .order("scheduled_date", { ascending: true });

      if (orders) {
        setWorkOrders(orders.map((o: any) => ({
          ...o,
          project: {
            name: o.title || "Work Order",
            address: "See project details"
          }
        })));
      }

      // Load today's time entries
      const today = new Date().toISOString().split("T")[0];
      const { data: entries } = await supabase
        .from("crew_time_entries")
        .select("*")
        .eq("crew_member_id", user.id)
        .gte("clock_in", today)
        .order("clock_in", { ascending: false });

      if (entries) {
        setTimeEntries(entries);
        const activeEntry = entries.find(e => !e.clock_out);
        setCurrentTimeEntry(activeEntry || null);
      }

      // Load messages
      const { data: msgs } = await supabase
        .from("portal_messages")
        .select("*")
        .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id},recipient_type.eq.all`)
        .order("created_at", { ascending: false })
        .limit(50);

      if (msgs) {
        setMessages(msgs);
      }
    } catch (error) {
      console.error("Error loading crew data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClockIn = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get current location
      let location = null;
      if (navigator.geolocation) {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject);
        });
        location = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
      }

      const { data, error } = await supabase
        .from("crew_time_entries")
        .insert({
          crew_member_id: user.id,
          tenant_id: crewMember?.tenant_id,
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
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject);
        });
        location = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
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
      loadCrewData();
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

  const updateWorkOrderStatus = async (orderId: string, status: string) => {
    try {
      const { error } = await supabase
        .from("work_orders")
        .update({ 
          status,
          ...(status === "completed" ? { completed_at: new Date().toISOString() } : {})
        })
        .eq("id", orderId);

      if (error) throw error;

      toast({
        title: "Status Updated",
        description: `Work order marked as ${status}`
      });
      loadCrewData();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim()) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from("portal_messages")
        .insert({
          tenant_id: crewMember?.tenant_id,
          sender_type: "crew",
          sender_id: user.id,
          recipient_type: "admin",
          message: newMessage
        });

      if (error) throw error;

      setNewMessage("");
      loadCrewData();
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
      case "pending": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      case "in_progress": return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "completed": return "bg-green-500/10 text-green-500 border-green-500/20";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent": return "bg-red-500/10 text-red-500";
      case "high": return "bg-orange-500/10 text-orange-500";
      case "normal": return "bg-blue-500/10 text-blue-500";
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
      // Request permission
      const permission = await navigator.permissions.query({ name: "geolocation" });
      if (permission.state === "denied") {
        toast({
          title: "Location Permission Denied",
          description: "Please enable location access in your browser settings",
          variant: "destructive",
        });
        return;
      }

      setIsTrackingLocation(true);
      
      watchIdRef.current = navigator.geolocation.watchPosition(
        async (position) => {
          await syncGPSLocation(position);
        },
        (error) => {
          console.error("GPS error:", error);
          toast({
            title: "GPS Error",
            description: error.message,
            variant: "destructive",
          });
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
      console.error("Error starting GPS:", error);
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !crewMember?.tenant_id) return;

      const { error } = await supabase.functions.invoke("crew-gps-sync", {
        body: {
          crew_id: user.id,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
        },
      });

      if (error) throw error;
      setLastLocationUpdate(new Date());
    } catch (error) {
      console.error("Error syncing GPS location:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border sticky top-0 z-50">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={crewMember?.avatar_url} />
              <AvatarFallback>
                {crewMember?.first_name?.[0]}{crewMember?.last_name?.[0]}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold text-foreground">
                {crewMember?.first_name} {crewMember?.last_name}
              </p>
              <p className="text-xs text-muted-foreground">Crew Member</p>
            </div>
          </div>
          <Button variant="ghost" size="icon">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Time Clock Banner */}
      <div className="bg-primary/5 border-b border-primary/20 px-4 py-3">
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
      <div className="bg-muted/50 border-b px-4 py-2">
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
            Work Orders
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
            <h2 className="text-lg font-semibold">Today's Work Orders</h2>
            {workOrders.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Wrench className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No work orders assigned</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {workOrders.map((order) => (
                  <Card key={order.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="font-medium">{order.title}</h3>
                          <p className="text-sm text-muted-foreground">{order.project.name}</p>
                        </div>
                        <div className="flex gap-2">
                          <Badge variant="outline" className={getPriorityColor(order.priority)}>
                            {order.priority}
                          </Badge>
                          <Badge variant="outline" className={getStatusColor(order.status)}>
                            {order.status.replace("_", " ")}
                          </Badge>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
                        <span className="flex items-center gap-1">
                          <MapPin className="h-4 w-4" />
                          {order.project.address}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          {order.scheduled_date ? format(new Date(order.scheduled_date), "MMM d") : "No date"}
                        </span>
                      </div>

                      {order.description && (
                        <p className="text-sm text-muted-foreground mb-3">{order.description}</p>
                      )}

                      <div className="flex gap-2">
                        {order.status === "pending" && (
                          <Button size="sm" onClick={() => updateWorkOrderStatus(order.id, "in_progress")}>
                            <Play className="h-4 w-4 mr-1" />
                            Start
                          </Button>
                        )}
                        {order.status === "in_progress" && (
                          <Button size="sm" onClick={() => updateWorkOrderStatus(order.id, "completed")}>
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Complete
                          </Button>
                        )}
                        <Button size="sm" variant="outline">
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
            {workOrders.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Navigation className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No stops assigned for today</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {workOrders.map((order, index) => (
                  <Card key={order.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold">
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <h3 className="font-medium">{order.title}</h3>
                          <p className="text-sm text-muted-foreground">{order.project.address}</p>
                        </div>
                        <Button size="sm" asChild>
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.project.address)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Navigation className="h-4 w-4 mr-1" />
                            Navigate
                          </a>
                        </Button>
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
            <Card>
              <CardContent className="p-6 text-center">
                <Upload className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                <p className="text-muted-foreground mb-4">Upload photos from the job site</p>
                <Button>
                  <Camera className="h-4 w-4 mr-2" />
                  Take Photo
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="messages" className="mt-0 space-y-4">
            <h2 className="text-lg font-semibold">Messages</h2>
            <Card className="flex flex-col h-[400px]">
              <ScrollArea className="flex-1 p-4">
                {messages.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No messages yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((msg) => (
                      <div 
                        key={msg.id}
                        className={`p-3 rounded-lg ${
                          msg.sender_type === "crew" 
                            ? "bg-primary/10 ml-8" 
                            : "bg-muted mr-8"
                        }`}
                      >
                        <p className="text-sm">{msg.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(new Date(msg.created_at), "MMM d, h:mm a")}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
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
    </div>
  );
}

export default CrewPortal;
