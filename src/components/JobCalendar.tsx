import React, { useState, useEffect } from 'react';
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BackButton } from "./BackButton";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Calendar as CalendarIcon, 
  Truck, 
  Users, 
  Building, 
  Clock,
  Plus,
  Filter,
  ExternalLink
} from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from "date-fns";

interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  type: 'material_delivery' | 'labor_scheduled' | 'inspection' | 'appointment';
  projectId: string;
  projectName: string;
  salesRep: string;
  status: string;
  notes?: string;
}

interface JobCalendarProps {
  onBack?: () => void;
}

const JobCalendar = ({ onBack }: JobCalendarProps) => {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<CalendarEvent[]>([]);
  const [selectedRep, setSelectedRep] = useState('');
  const [salesReps, setSalesReps] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEventDialog, setShowEventDialog] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    type: 'appointment' as const,
    projectId: '',
    notes: ''
  });
  const [projects, setProjects] = useState<any[]>([]);
  const { toast } = useToast();

  const eventTypes = [
    { value: 'material_delivery', label: 'Material Delivery', icon: Truck, color: 'bg-blue-500' },
    { value: 'labor_scheduled', label: 'Labor Scheduled', icon: Users, color: 'bg-green-500' },
    { value: 'inspection', label: 'Inspection', icon: Building, color: 'bg-yellow-500' },
    { value: 'appointment', label: 'Appointment', icon: CalendarIcon, color: 'bg-purple-500' }
  ];

  useEffect(() => {
    fetchCalendarData();
    fetchProjects();
  }, []);

  useEffect(() => {
    filterEvents();
  }, [events, selectedRep]);

  const fetchCalendarData = async () => {
    try {
      setLoading(true);
      
      // For now, we'll create mock calendar events based on projects
      // In a real implementation, you'd have a calendar_events table
      const { data: projectsData, error } = await supabase
        .from('projects')
        .select(`
          *,
          pipeline_entries!inner(
            *,
            contacts(*),
            profiles!pipeline_entries_assigned_to_fkey(first_name, last_name)
          )
        `)
        .eq('status', 'active');

      if (error) throw error;

      // Generate mock events for demonstration
      const mockEvents: CalendarEvent[] = [];
      projectsData?.forEach((project: any) => {
        const salesRep = project.pipeline_entries?.profiles 
          ? `${project.pipeline_entries.profiles.first_name} ${project.pipeline_entries.profiles.last_name}`
          : 'Unknown Rep';
        
        // Add material delivery event (3 days from start date)
        const materialDate = new Date(project.start_date);
        materialDate.setDate(materialDate.getDate() + 3);
        
        mockEvents.push({
          id: `material-${project.id}`,
          title: `Material Delivery - ${project.name}`,
          date: materialDate,
          type: 'material_delivery',
          projectId: project.id,
          projectName: project.name,
          salesRep,
          status: 'scheduled'
        });

        // Add labor event (5 days from start date)
        const laborDate = new Date(project.start_date);
        laborDate.setDate(laborDate.getDate() + 5);
        
        mockEvents.push({
          id: `labor-${project.id}`,
          title: `Labor Start - ${project.name}`,
          date: laborDate,
          type: 'labor_scheduled',
          projectId: project.id,
          projectName: project.name,
          salesRep,
          status: 'scheduled'
        });
      });

      // Extract unique sales reps
      const uniqueReps = [...new Set(mockEvents.map(event => event.salesRep))];
      setSalesReps(uniqueReps);
      setEvents(mockEvents);
      
    } catch (error) {
      console.error('Error fetching calendar data:', error);
      toast({
        title: "Error",
        description: "Failed to load calendar data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchProjects = async () => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, project_number')
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProjects(data || []);
    } catch (error) {
      console.error('Error fetching projects:', error);
    }
  };

  const filterEvents = () => {
    let filtered = events;
    if (selectedRep) {
      filtered = filtered.filter(event => event.salesRep === selectedRep);
    }
    setFilteredEvents(filtered);
  };

  const getEventsForDate = (date: Date) => {
    return filteredEvents.filter(event => isSameDay(event.date, date));
  };

  const getEventTypeConfig = (type: string) => {
    return eventTypes.find(t => t.value === type) || eventTypes[0];
  };

  const handleAddEvent = async () => {
    try {
      // In a real implementation, you'd save to a calendar_events table
      const event: CalendarEvent = {
        id: `custom-${Date.now()}`,
        title: newEvent.title,
        date: new Date(newEvent.date),
        type: newEvent.type,
        projectId: newEvent.projectId,
        projectName: projects.find(p => p.id === newEvent.projectId)?.name || 'Unknown Project',
        salesRep: 'Current User', // Would get from auth context
        status: 'scheduled',
        notes: newEvent.notes
      };

      setEvents(prev => [...prev, event]);
      setShowEventDialog(false);
      setNewEvent({
        title: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        type: 'appointment',
        projectId: '',
        notes: ''
      });

      toast({
        title: "Success",
        description: "Event added to calendar",
      });
    } catch (error) {
      console.error('Error adding event:', error);
      toast({
        title: "Error",
        description: "Failed to add event",
        variant: "destructive",
      });
    }
  };

  const syncWithGoogleCalendar = () => {
    // This would implement Google Calendar API integration
    toast({
      title: "Google Calendar Sync",
      description: "Google Calendar integration will be set up to sync appointments and events",
    });
  };

  if (loading) {
    return <div className="p-6">Loading calendar...</div>;
  }

  return (
    <div className="space-y-6">
      {onBack && <BackButton onClick={onBack} />}
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            Job Calendar
          </h1>
          <p className="text-muted-foreground">
            Schedule and track project milestones, appointments, and deliveries
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={syncWithGoogleCalendar}>
            <ExternalLink className="h-4 w-4 mr-2" />
            Sync Google Calendar
          </Button>
          <Dialog open={showEventDialog} onOpenChange={setShowEventDialog}>
            <DialogTrigger asChild>
              <Button className="gradient-primary">
                <Plus className="h-4 w-4 mr-2" />
                Add Event
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Calendar Event</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="title">Event Title</Label>
                  <Input
                    id="title"
                    value={newEvent.title}
                    onChange={(e) => setNewEvent(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Enter event title"
                  />
                </div>
                <div>
                  <Label htmlFor="date">Date</Label>
                  <Input
                    id="date"
                    type="date"
                    value={newEvent.date}
                    onChange={(e) => setNewEvent(prev => ({ ...prev, date: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="type">Event Type</Label>
                  <Select 
                    value={newEvent.type} 
                    onValueChange={(value: any) => setNewEvent(prev => ({ ...prev, type: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {eventTypes.map(type => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="project">Project</Label>
                  <Select 
                    value={newEvent.projectId} 
                    onValueChange={(value) => setNewEvent(prev => ({ ...prev, projectId: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map(project => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.project_number} - {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    value={newEvent.notes}
                    onChange={(e) => setNewEvent(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Additional notes..."
                  />
                </div>
                <Button onClick={handleAddEvent} className="w-full">
                  Add Event
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Filters */}
        <div className="lg:col-span-3">
          <Card className="shadow-soft border-0">
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <Label htmlFor="rep-filter">Filter by Sales Rep</Label>
                  <Select value={selectedRep} onValueChange={setSelectedRep}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Sales Reps" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All Sales Reps</SelectItem>
                      {salesReps.map(rep => (
                        <SelectItem key={rep} value={rep}>{rep}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedRep && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setSelectedRep('')}
                    className="mt-6"
                  >
                    <Filter className="h-4 w-4 mr-2" />
                    Clear Filter
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Calendar */}
        <Card className="shadow-soft border-0 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-primary" />
              {format(selectedDate, 'MMMM yyyy')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => date && setSelectedDate(date)}
              className="pointer-events-auto"
              modifiers={{
                hasEvents: (date) => getEventsForDate(date).length > 0
              }}
              modifiersStyles={{
                hasEvents: { 
                  backgroundColor: 'hsl(var(--primary))',
                  color: 'white',
                  fontWeight: 'bold'
                }
              }}
            />
          </CardContent>
        </Card>

        {/* Events for Selected Date */}
        <Card className="shadow-soft border-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Events for {format(selectedDate, 'MMM dd, yyyy')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {getEventsForDate(selectedDate).length === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  No events scheduled for this date
                </p>
              ) : (
                getEventsForDate(selectedDate).map((event) => {
                  const typeConfig = getEventTypeConfig(event.type);
                  return (
                    <div key={event.id} className="p-3 rounded-lg bg-muted/50 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${typeConfig.color}`} />
                        <span className="font-medium">{event.title}</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        <div>Project: {event.projectName}</div>
                        <div>Sales Rep: {event.salesRep}</div>
                        {event.notes && <div>Notes: {event.notes}</div>}
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {typeConfig.label}
                      </Badge>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Event Legend */}
      <Card className="shadow-soft border-0">
        <CardHeader>
          <CardTitle>Event Types</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {eventTypes.map((type) => (
              <div key={type.value} className="flex items-center gap-2">
                <div className={`w-4 h-4 rounded-full ${type.color}`} />
                <span className="text-sm">{type.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default JobCalendar;