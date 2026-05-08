import React, { useState, useEffect } from 'react';
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  ExternalLink,
} from "lucide-react";
import { format, isSameDay } from "date-fns";

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

const DashboardCalendar = () => {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<CalendarEvent[]>([]);
  const [selectedRep, setSelectedRep] = useState('all');
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
    let filtered = events;
    if (selectedRep && selectedRep !== 'all') {
      filtered = filtered.filter(event => event.salesRep === selectedRep);
    }
    setFilteredEvents(filtered);
  }, [events, selectedRep]);

  const fetchCalendarData = async () => {
    try {
      setLoading(true);
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

      const mockEvents: CalendarEvent[] = [];
      projectsData?.forEach((project: any) => {
        const salesRep = project.pipeline_entries?.profiles 
          ? `${project.pipeline_entries.profiles.first_name} ${project.pipeline_entries.profiles.last_name}`
          : 'Unknown Rep';
        
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

      const uniqueReps = [...new Set(mockEvents.map(event => event.salesRep))];
      setSalesReps(uniqueReps);
      setEvents(mockEvents);
    } catch (error) {
      console.error('Error fetching calendar data:', error);
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

  const getEventsForDate = (date: Date) => {
    return filteredEvents.filter(event => isSameDay(event.date, date));
  };

  const getEventTypeConfig = (type: string) => {
    return eventTypes.find(t => t.value === type) || eventTypes[0];
  };

  const handleAddEvent = async () => {
    const event: CalendarEvent = {
      id: `custom-${Date.now()}`,
      title: newEvent.title,
      date: new Date(newEvent.date),
      type: newEvent.type,
      projectId: newEvent.projectId,
      projectName: projects.find(p => p.id === newEvent.projectId)?.name || 'Unknown Project',
      salesRep: 'Current User',
      status: 'scheduled',
      notes: newEvent.notes
    };

    setEvents(prev => [...prev, event]);
    setShowEventDialog(false);
    setNewEvent({ title: '', date: format(new Date(), 'yyyy-MM-dd'), type: 'appointment', projectId: '', notes: '' });
    toast({ title: "Success", description: "Event added to calendar" });
  };

  const syncWithGoogleCalendar = () => {
    toast({
      title: "Google Calendar Sync",
      description: "Google Calendar integration will be set up to sync appointments and events",
    });
  };

  if (loading) {
    return (
      <Card className="shadow-soft border-0">
        <CardContent className="p-6 text-center text-muted-foreground">Loading calendar...</CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-soft border-0">
      <CardContent className="p-4 md:p-6 space-y-4">
        {/* Calendar Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-primary" />
            <h2 className="text-base md:text-lg font-semibold">Calendar</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedRep} onValueChange={setSelectedRep}>
              <SelectTrigger className="w-[160px] h-9 text-sm">
                <SelectValue placeholder="All Reps" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sales Reps</SelectItem>
                {salesReps.map(rep => (
                  <SelectItem key={rep} value={rep}>{rep}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedRep !== 'all' && (
              <Button variant="outline" size="sm" onClick={() => setSelectedRep('all')}>
                <Filter className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={syncWithGoogleCalendar}>
              <ExternalLink className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">Sync Google</span>
            </Button>
            <Dialog open={showEventDialog} onOpenChange={setShowEventDialog}>
              <DialogTrigger asChild>
                <Button size="sm" className="gradient-primary">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Event
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Calendar Event</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="dash-title">Event Title</Label>
                    <Input id="dash-title" value={newEvent.title} onChange={(e) => setNewEvent(prev => ({ ...prev, title: e.target.value }))} placeholder="Enter event title" />
                  </div>
                  <div>
                    <Label htmlFor="dash-date">Date</Label>
                    <Input id="dash-date" type="date" value={newEvent.date} onChange={(e) => setNewEvent(prev => ({ ...prev, date: e.target.value }))} />
                  </div>
                  <div>
                    <Label htmlFor="dash-type">Event Type</Label>
                    <Select value={newEvent.type} onValueChange={(value: any) => setNewEvent(prev => ({ ...prev, type: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {eventTypes.map(type => (
                          <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="dash-project">Project</Label>
                    <Select value={newEvent.projectId} onValueChange={(value) => setNewEvent(prev => ({ ...prev, projectId: value }))}>
                      <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                      <SelectContent>
                        {projects.map(project => (
                          <SelectItem key={project.id} value={project.id}>{project.project_number} - {project.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="dash-notes">Notes</Label>
                    <Textarea id="dash-notes" value={newEvent.notes} onChange={(e) => setNewEvent(prev => ({ ...prev, notes: e.target.value }))} placeholder="Additional notes..." />
                  </div>
                  <Button onClick={handleAddEvent} className="w-full">Add Event</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Event Type Legend */}
        <div className="flex flex-wrap gap-3">
          {eventTypes.map((type) => (
            <div key={type.value} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded-full ${type.color}`} />
              <span className="text-xs text-muted-foreground">{type.label}</span>
            </div>
          ))}
        </div>

        {/* Calendar + Events */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
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
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-primary" />
              {format(selectedDate, 'MMM dd, yyyy')}
            </h3>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {getEventsForDate(selectedDate).length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-4">
                  No events scheduled
                </p>
              ) : (
                getEventsForDate(selectedDate).map((event) => {
                  const typeConfig = getEventTypeConfig(event.type);
                  return (
                    <div key={event.id} className="p-2.5 rounded-lg bg-muted/50 space-y-1">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${typeConfig.color}`} />
                        <span className="font-medium text-sm truncate">{event.title}</span>
                      </div>
                      <div className="text-xs text-muted-foreground pl-4">
                        <div>Project: {event.projectName}</div>
                        <div>Rep: {event.salesRep}</div>
                        {event.notes && <div>Notes: {event.notes}</div>}
                      </div>
                      <Badge variant="outline" className="text-[10px] ml-4">{typeConfig.label}</Badge>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default DashboardCalendar;
