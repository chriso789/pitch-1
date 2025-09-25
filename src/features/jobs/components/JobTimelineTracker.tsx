import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';
import { 
  Clock, 
  Plus, 
  CheckCircle, 
  AlertCircle, 
  Calendar,
  User,
  MessageSquare,
  MapPin,
  Camera,
  FileText,
  Wrench
} from 'lucide-react';

interface TimelineEvent {
  id: string;
  event_type: 'status_change' | 'milestone' | 'note' | 'photo_uploaded' | 'document_added' | 'inspection' | 'work_completed';
  title: string;
  description?: string;
  status?: 'completed' | 'in_progress' | 'pending' | 'cancelled';
  created_at: string;
  created_by?: string;
  metadata?: {
    previous_status?: string;
    new_status?: string;
    location?: string;
    file_count?: number;
    document_type?: string;
  };
}

interface JobTimelineTrackerProps {
  jobId: string;
}

interface NewEvent {
  event_type: 'milestone' | 'note' | 'inspection' | 'work_completed';
  title: string;
  description: string;
  status: 'completed' | 'in_progress' | 'pending';
}

export const JobTimelineTracker = ({ jobId }: JobTimelineTrackerProps) => {
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newEvent, setNewEvent] = useState<NewEvent>({
    event_type: 'milestone',
    title: '',
    description: '',
    status: 'completed'
  });

  useEffect(() => {
    fetchTimelineEvents();
  }, [jobId]);

  const fetchTimelineEvents = async () => {
    try {
      // Mock data for now - replace with actual database query
      const mockEvents: TimelineEvent[] = [
        {
          id: '1',
          event_type: 'status_change',
          title: 'Job Created',
          description: 'Initial job setup and contact assignment',
          status: 'completed',
          created_at: '2024-01-15T08:00:00Z',
          created_by: 'admin_user',
          metadata: {
            new_status: 'pending'
          }
        },
        {
          id: '2',
          event_type: 'milestone',
          title: 'Initial Inspection Completed',
          description: 'Roof damage assessment completed, photos taken of all affected areas',
          status: 'completed',
          created_at: '2024-01-15T10:30:00Z',
          created_by: 'inspector_john',
          metadata: {
            location: '123 Oak St, Austin, TX'
          }
        },
        {
          id: '3',
          event_type: 'photo_uploaded',
          title: 'Inspection Photos Added',
          description: 'Uploaded 8 photos from initial roof inspection',
          status: 'completed',
          created_at: '2024-01-15T11:00:00Z',
          created_by: 'inspector_john',
          metadata: {
            file_count: 8
          }
        },
        {
          id: '4',
          event_type: 'document_added',
          title: 'Contract Signed',
          description: 'Customer signed roofing contract for $18,450',
          status: 'completed',
          created_at: '2024-01-16T14:20:00Z',
          created_by: 'sales_manager',
          metadata: {
            document_type: 'contract'
          }
        },
        {
          id: '5',
          event_type: 'status_change',
          title: 'Job Status: Active',
          description: 'Job approved and moved to active status, materials ordered',
          status: 'completed',
          created_at: '2024-01-17T09:15:00Z',
          created_by: 'project_manager',
          metadata: {
            previous_status: 'pending',
            new_status: 'active'
          }
        },
        {
          id: '6',
          event_type: 'milestone',
          title: 'Materials Delivered',
          description: 'All roofing materials delivered and stored on-site',
          status: 'completed',
          created_at: '2024-01-18T07:30:00Z',
          created_by: 'crew_lead',
        },
        {
          id: '7',
          event_type: 'work_completed',
          title: 'Tear-off Completed',
          description: 'Old shingles removed, roof deck inspected and prepared',
          status: 'completed',
          created_at: '2024-01-19T16:00:00Z',
          created_by: 'crew_lead',
        },
        {
          id: '8',
          event_type: 'work_completed',
          title: 'New Shingles Installation',
          description: 'New shingle installation 75% complete, weather permitting',
          status: 'in_progress',
          created_at: '2024-01-22T12:00:00Z',
          created_by: 'crew_lead',
        },
        {
          id: '9',
          event_type: 'inspection',
          title: 'Final Inspection Scheduled',
          description: 'City inspection scheduled for January 26th, 2024',
          status: 'pending',
          created_at: '2024-01-23T10:00:00Z',
          created_by: 'project_manager',
        }
      ];
      
      // Sort by creation date, newest first
      mockEvents.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setTimelineEvents(mockEvents);
    } catch (error) {
      console.error('Error fetching timeline events:', error);
    } finally {
      setLoading(false);
    }
  };

  const addTimelineEvent = async () => {
    try {
      const eventData: TimelineEvent = {
        id: Date.now().toString(),
        ...newEvent,
        created_at: new Date().toISOString(),
        created_by: 'current_user'
      };

      setTimelineEvents(prev => [eventData, ...prev]);
      setShowAddEvent(false);
      setNewEvent({
        event_type: 'milestone',
        title: '',
        description: '',
        status: 'completed'
      });

      toast({
        title: 'Success',
        description: 'Timeline event added successfully'
      });
    } catch (error) {
      console.error('Error adding timeline event:', error);
      toast({
        title: 'Error',
        description: 'Failed to add timeline event',
        variant: 'destructive'
      });
    }
  };

  const getEventIcon = (eventType: string, status?: string) => {
    const iconClass = "h-5 w-5";
    
    switch (eventType) {
      case 'milestone':
        return status === 'completed' ? 
          <CheckCircle className={`${iconClass} text-success`} /> : 
          <Clock className={`${iconClass} text-warning`} />;
      case 'status_change':
        return <AlertCircle className={`${iconClass} text-primary`} />;
      case 'note':
        return <MessageSquare className={`${iconClass} text-blue-500`} />;
      case 'photo_uploaded':
        return <Camera className={`${iconClass} text-green-500`} />;
      case 'document_added':
        return <FileText className={`${iconClass} text-purple-500`} />;
      case 'inspection':
        return <MapPin className={`${iconClass} text-orange-500`} />;
      case 'work_completed':
        return <Wrench className={`${iconClass} text-blue-600`} />;
      default:
        return <Clock className={`${iconClass} text-muted-foreground`} />;
    }
  };

  const getStatusColor = (status?: string) => {
    const colors = {
      'completed': 'bg-success text-success-foreground',
      'in_progress': 'bg-warning text-warning-foreground',
      'pending': 'bg-muted text-muted-foreground',
      'cancelled': 'bg-destructive text-destructive-foreground'
    };
    return colors[status as keyof typeof colors] || 'bg-muted text-muted-foreground';
  };

  const formatEventType = (eventType: string) => {
    return eventType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return {
      date: date.toLocaleDateString(),
      time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Job Timeline</h3>
          <p className="text-muted-foreground">{timelineEvents.length} events recorded</p>
        </div>
        <Dialog open={showAddEvent} onOpenChange={setShowAddEvent}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Event
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Timeline Event</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="event_type">Event Type</Label>
                  <Select value={newEvent.event_type} onValueChange={(value: any) => setNewEvent(prev => ({ ...prev, event_type: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="milestone">Milestone</SelectItem>
                      <SelectItem value="note">Note</SelectItem>
                      <SelectItem value="inspection">Inspection</SelectItem>
                      <SelectItem value="work_completed">Work Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="status">Status</Label>
                  <Select value={newEvent.status} onValueChange={(value: any) => setNewEvent(prev => ({ ...prev, status: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={newEvent.title}
                  onChange={(e) => setNewEvent(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Event title"
                />
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={newEvent.description}
                  onChange={(e) => setNewEvent(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Event description"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowAddEvent(false)}>
                  Cancel
                </Button>
                <Button onClick={addTimelineEvent} disabled={!newEvent.title}>
                  Add Event
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Timeline */}
      <Card>
        <CardContent className="p-0">
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-8 top-0 bottom-0 w-px bg-border"></div>
            
            {timelineEvents.length > 0 ? (
              <div className="space-y-0">
                {timelineEvents.map((event, index) => {
                  const { date, time } = formatDate(event.created_at);
                  
                  return (
                    <div key={event.id} className={`relative p-6 ${index > 0 ? 'border-t' : ''}`}>
                      {/* Timeline marker */}
                      <div className="absolute left-6 w-4 h-4 bg-background border-2 border-border rounded-full flex items-center justify-center">
                        <div className="w-2 h-2 bg-primary rounded-full"></div>
                      </div>
                      
                      {/* Event content */}
                      <div className="ml-8 space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center space-x-3">
                              {getEventIcon(event.event_type, event.status)}
                              <h4 className="font-semibold">{event.title}</h4>
                              {event.status && (
                                <Badge className={getStatusColor(event.status)} variant="outline">
                                  {event.status.replace('_', ' ')}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                              <Badge variant="outline" className="bg-muted/50">
                                {formatEventType(event.event_type)}
                              </Badge>
                              <span>•</span>
                              <span>{date} at {time}</span>
                              {event.created_by && (
                                <>
                                  <span>•</span>
                                  <span>by {event.created_by.replace('_', ' ')}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        {event.description && (
                          <p className="text-muted-foreground">{event.description}</p>
                        )}
                        
                        {/* Event metadata */}
                        {event.metadata && (
                          <div className="flex flex-wrap gap-2">
                            {event.metadata.previous_status && event.metadata.new_status && (
                              <div className="text-xs bg-muted px-2 py-1 rounded">
                                Status: {event.metadata.previous_status} → {event.metadata.new_status}
                              </div>
                            )}
                            {event.metadata.location && (
                              <div className="text-xs bg-muted px-2 py-1 rounded flex items-center space-x-1">
                                <MapPin className="h-3 w-3" />
                                <span>{event.metadata.location}</span>
                              </div>
                            )}
                            {event.metadata.file_count && (
                              <div className="text-xs bg-muted px-2 py-1 rounded">
                                {event.metadata.file_count} files
                              </div>
                            )}
                            {event.metadata.document_type && (
                              <div className="text-xs bg-muted px-2 py-1 rounded">
                                Type: {event.metadata.document_type}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-12 text-center">
                <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="font-semibold text-lg mb-2">No timeline events</h3>
                <p className="text-muted-foreground mb-4">
                  Add events to track job progress and milestones
                </p>
                <Button onClick={() => setShowAddEvent(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add First Event
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};