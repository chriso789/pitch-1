import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, Clock, MapPin, Cloud, Sparkles, User, ChevronRight, ThumbsUp, Navigation } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

interface TimeSlot {
  start: string;
  end: string;
  score: number;
  factors: {
    weather: number;
    travel: number;
    preference: number;
    availability: number;
  };
  weather_summary?: string;
  travel_time_minutes?: number;
}

interface AIAppointmentSchedulerProps {
  contactId: string;
  jobId?: string;
  appointmentType?: string;
  canvasserId?: string;
  onAppointmentCreated?: (appointment: any) => void;
}

export const AIAppointmentScheduler: React.FC<AIAppointmentSchedulerProps> = ({
  contactId,
  jobId,
  appointmentType = 'inspection',
  canvasserId,
  onAppointmentCreated,
}) => {
  const [loading, setLoading] = useState(false);
  const [suggestedSlots, setSuggestedSlots] = useState<TimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [creatingAppointment, setCreatingAppointment] = useState(false);
  const [contactInfo, setContactInfo] = useState<{ name: string; address: string } | null>(null);
  const [canvasserLocation, setCanvasserLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    // Try to get current location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCanvasserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          console.log('Could not get location:', error);
        }
      );
    }
  }, []);

  const fetchSuggestions = async () => {
    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) {
        toast.error('Please log in to continue');
        return;
      }

      const response = await supabase.functions.invoke('ai-appointment-scheduler', {
        body: {
          contact_id: contactId,
          canvasser_id: canvasserId,
          appointment_type: appointmentType,
          canvasser_location: canvasserLocation,
          homeowner_preferences: {},
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      setSuggestedSlots(response.data.suggested_slots || []);
      setContactInfo(response.data.contact);
      toast.success('AI suggestions ready!');
    } catch (error: any) {
      console.error('Error fetching suggestions:', error);
      toast.error(error.message || 'Failed to get AI suggestions');
    } finally {
      setLoading(false);
    }
  };

  const createAppointment = async () => {
    if (!selectedSlot) return;

    setCreatingAppointment(true);
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .single();

      const { data: appointment, error } = await supabase
        .from('appointments')
        .insert({
          tenant_id: profile?.tenant_id,
          contact_id: contactId,
          job_id: jobId,
          assigned_to: canvasserId,
          title: `${appointmentType.charAt(0).toUpperCase() + appointmentType.slice(1)} - ${contactInfo?.name || 'Customer'}`,
          appointment_type: appointmentType,
          scheduled_start: selectedSlot.start,
          scheduled_end: selectedSlot.end,
          address: contactInfo?.address,
          ai_suggested: true,
          ai_score: selectedSlot.score,
          weather_risk: selectedSlot.weather_summary,
          weather_data: { summary: selectedSlot.weather_summary },
          status: 'scheduled',
        })
        .select()
        .single();

      if (error) throw error;

      toast.success('Appointment scheduled successfully!');
      onAppointmentCreated?.(appointment);
      setSuggestedSlots([]);
      setSelectedSlot(null);
    } catch (error: any) {
      console.error('Error creating appointment:', error);
      toast.error(error.message || 'Failed to create appointment');
    } finally {
      setCreatingAppointment(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-500';
    if (score >= 60) return 'text-yellow-500';
    return 'text-orange-500';
  };

  const getScoreBg = (score: number) => {
    if (score >= 80) return 'bg-green-500/10 border-green-500/30';
    if (score >= 60) return 'bg-yellow-500/10 border-yellow-500/30';
    return 'bg-orange-500/10 border-orange-500/30';
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">AI Appointment Scheduler</CardTitle>
            <CardDescription>
              Intelligent scheduling based on location, weather, and preferences
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {suggestedSlots.length === 0 ? (
          <div className="text-center py-6">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <Calendar className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground mb-4">
              Let AI suggest the best appointment times based on weather, travel time, and availability.
            </p>
            <Button onClick={fetchSuggestions} disabled={loading}>
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-background border-t-transparent mr-2" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Get AI Suggestions
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Recommended Time Slots</span>
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="h-3 w-3" />
                AI Powered
              </Badge>
            </div>

            {suggestedSlots.map((slot, index) => (
              <div
                key={index}
                onClick={() => setSelectedSlot(slot)}
                className={cn(
                  'p-4 rounded-lg border cursor-pointer transition-all',
                  selectedSlot === slot
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">
                        {format(parseISO(slot.start), 'EEEE, MMMM d')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        {format(parseISO(slot.start), 'h:mm a')} - {format(parseISO(slot.end), 'h:mm a')}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Badge variant="outline" className="gap-1 text-xs">
                        <Cloud className="h-3 w-3" />
                        {slot.weather_summary || 'Good'}
                      </Badge>
                      {slot.travel_time_minutes && (
                        <Badge variant="outline" className="gap-1 text-xs">
                          <Navigation className="h-3 w-3" />
                          {slot.travel_time_minutes} min drive
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className={cn('text-right', getScoreColor(slot.score))}>
                    <div className={cn('px-3 py-1 rounded-full border text-sm font-semibold', getScoreBg(slot.score))}>
                      {slot.score}%
                    </div>
                    <span className="text-xs text-muted-foreground">match</span>
                  </div>
                </div>

                {selectedSlot === slot && (
                  <div className="mt-3 pt-3 border-t grid grid-cols-4 gap-2">
                    <div className="text-center">
                      <div className="text-xs text-muted-foreground">Weather</div>
                      <div className="text-sm font-medium">{slot.factors.weather}%</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-muted-foreground">Travel</div>
                      <div className="text-sm font-medium">{slot.factors.travel}%</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-muted-foreground">Preference</div>
                      <div className="text-sm font-medium">{slot.factors.preference}%</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-muted-foreground">Available</div>
                      <div className="text-sm font-medium">{slot.factors.availability}%</div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setSuggestedSlots([]);
                  setSelectedSlot(null);
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={!selectedSlot || creatingAppointment}
                onClick={createAppointment}
              >
                {creatingAppointment ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-background border-t-transparent mr-2" />
                    Scheduling...
                  </>
                ) : (
                  <>
                    <ThumbsUp className="h-4 w-4 mr-2" />
                    Confirm Appointment
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AIAppointmentScheduler;
