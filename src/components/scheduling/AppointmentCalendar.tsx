import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Calendar as CalendarIcon, Clock, User, MapPin, CheckCircle, XCircle, AlertCircle, Plus, Cloud } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, parseISO, addDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { CalendarWeatherOverlay } from './CalendarWeatherOverlay';
interface Appointment {
  id: string;
  title: string;
  appointment_type: string;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
  address?: string;
  ai_suggested?: boolean;
  ai_score?: number;
  contact?: {
    first_name: string;
    last_name: string;
  };
  assigned_to_profile?: {
    first_name: string;
    last_name: string;
  };
}

interface AppointmentCalendarProps {
  tenantId?: string;
  onSelectAppointment?: (appointment: Appointment) => void;
  onCreateNew?: () => void;
}

export const AppointmentCalendar: React.FC<AppointmentCalendarProps> = ({
  tenantId,
  onSelectAppointment,
  onCreateNew,
}) => {
  const { profile } = useUserProfile();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [view, setView] = useState<'day' | 'week'>('week');
  const [showWeather, setShowWeather] = useState(true);
  
  // Default location (company HQ or fallback to Texas)
  const [weatherLocation] = useState({ latitude: 32.7767, longitude: -96.7970 });

  const effectiveTenantId = tenantId || profile?.tenant_id;
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  useEffect(() => {
    fetchAppointments();
  }, [selectedDate, effectiveTenantId]);

  const fetchAppointments = async () => {
    if (!effectiveTenantId) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          *,
          contact:contacts(first_name, last_name),
          assigned_to_profile:profiles!appointments_assigned_to_fkey(first_name, last_name)
        `)
        .eq('tenant_id', effectiveTenantId)
        .gte('scheduled_start', weekStart.toISOString())
        .lte('scheduled_start', weekEnd.toISOString())
        .order('scheduled_start');

      if (error) throw error;
      setAppointments(data || []);
    } catch (error) {
      console.error('Error fetching appointments:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'cancelled': return 'bg-red-500';
      case 'confirmed': return 'bg-blue-500';
      case 'in_progress': return 'bg-yellow-500';
      default: return 'bg-muted-foreground';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="h-3 w-3" />;
      case 'cancelled': return <XCircle className="h-3 w-3" />;
      case 'confirmed': return <CheckCircle className="h-3 w-3" />;
      default: return <AlertCircle className="h-3 w-3" />;
    }
  };

  const getAppointmentTypeColor = (type: string) => {
    switch (type) {
      case 'inspection': return 'border-l-blue-500';
      case 'estimate': return 'border-l-purple-500';
      case 'installation': return 'border-l-green-500';
      case 'follow_up': return 'border-l-orange-500';
      case 'adjustment': return 'border-l-yellow-500';
      default: return 'border-l-muted-foreground';
    }
  };

  const getDayAppointments = (date: Date) => {
    return appointments.filter(apt => 
      isSameDay(parseISO(apt.scheduled_start), date)
    );
  };

  const timeSlots = Array.from({ length: 12 }, (_, i) => i + 7); // 7 AM to 6 PM

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5" />
              Appointment Calendar
            </CardTitle>
            <CardDescription>
              {format(weekStart, 'MMMM d')} - {format(weekEnd, 'MMMM d, yyyy')}
            </CardDescription>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                id="show-weather"
                checked={showWeather}
                onCheckedChange={setShowWeather}
              />
              <Label htmlFor="show-weather" className="text-sm flex items-center gap-1 cursor-pointer">
                <Cloud className="h-4 w-4" />
                Weather
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelectedDate(addDays(selectedDate, -7))}>
                Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedDate(new Date())}>
                Today
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedDate(addDays(selectedDate, 7))}>
                Next
              </Button>
              {onCreateNew && (
                <Button size="sm" onClick={onCreateNew}>
                  <Plus className="h-4 w-4 mr-1" />
                  New
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={view} onValueChange={(v) => setView(v as 'day' | 'week')}>
          <TabsList className="mb-4">
            <TabsTrigger value="week">Week View</TabsTrigger>
            <TabsTrigger value="day">Day View</TabsTrigger>
          </TabsList>

          <TabsContent value="week" className="mt-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-2">
                {weekDays.map((day) => {
                  const dayAppointments = getDayAppointments(day);
                  const isToday = isSameDay(day, new Date());
                  
                  return (
                    <div
                      key={day.toISOString()}
                      className={cn(
                        'min-h-[200px] border rounded-lg p-2',
                        isToday && 'border-primary bg-primary/5'
                      )}
                    >
                      <div className={cn(
                        'text-center mb-2 pb-2 border-b',
                        isToday && 'font-bold text-primary'
                      )}>
                        <div className="text-xs text-muted-foreground">{format(day, 'EEE')}</div>
                        <div className="text-lg">{format(day, 'd')}</div>
                        {showWeather && (
                          <div className="mt-1">
                            <CalendarWeatherOverlay
                              latitude={weatherLocation.latitude}
                              longitude={weatherLocation.longitude}
                              date={day}
                              compact
                            />
                          </div>
                        )}
                      </div>
                      
                      <div className="space-y-1">
                        {dayAppointments.map((apt) => (
                          <div
                            key={apt.id}
                            onClick={() => onSelectAppointment?.(apt)}
                            className={cn(
                              'p-2 rounded text-xs cursor-pointer border-l-4 bg-muted/50 hover:bg-muted transition-colors',
                              getAppointmentTypeColor(apt.appointment_type)
                            )}
                          >
                            <div className="font-medium truncate">{apt.title}</div>
                            <div className="flex items-center gap-1 text-muted-foreground mt-1">
                              <Clock className="h-3 w-3" />
                              {format(parseISO(apt.scheduled_start), 'h:mm a')}
                            </div>
                            {apt.ai_suggested && (
                              <Badge variant="secondary" className="mt-1 text-[10px] px-1 py-0">
                                AI {apt.ai_score}%
                              </Badge>
                            )}
                          </div>
                        ))}
                        {dayAppointments.length === 0 && (
                          <div className="text-center text-xs text-muted-foreground py-4">
                            No appointments
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="day" className="mt-0">
            <div className="space-y-2">
              {timeSlots.map((hour) => {
                const slotAppointments = appointments.filter(apt => {
                  const aptHour = parseISO(apt.scheduled_start).getHours();
                  return aptHour === hour && isSameDay(parseISO(apt.scheduled_start), selectedDate);
                });

                return (
                  <div key={hour} className="flex gap-4 py-2 border-b">
                    <div className="w-16 text-sm text-muted-foreground">
                      {format(new Date().setHours(hour, 0), 'h:mm a')}
                    </div>
                    <div className="flex-1">
                      {slotAppointments.map((apt) => (
                        <div
                          key={apt.id}
                          onClick={() => onSelectAppointment?.(apt)}
                          className={cn(
                            'p-3 rounded-lg cursor-pointer border-l-4 bg-muted/50 hover:bg-muted transition-colors mb-1',
                            getAppointmentTypeColor(apt.appointment_type)
                          )}
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="font-medium">{apt.title}</div>
                              <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {format(parseISO(apt.scheduled_start), 'h:mm a')} - {format(parseISO(apt.scheduled_end), 'h:mm a')}
                                </span>
                                {apt.address && (
                                  <span className="flex items-center gap-1">
                                    <MapPin className="h-3 w-3" />
                                    {apt.address}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="gap-1">
                                {getStatusIcon(apt.status)}
                                {apt.status}
                              </Badge>
                              {apt.ai_suggested && (
                                <Badge variant="secondary">AI {apt.ai_score}%</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      {slotAppointments.length === 0 && (
                        <div className="h-8" /> // Empty slot placeholder
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded border-l-4 border-l-blue-500 bg-muted" />
            <span>Inspection</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded border-l-4 border-l-purple-500 bg-muted" />
            <span>Estimate</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded border-l-4 border-l-green-500 bg-muted" />
            <span>Installation</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded border-l-4 border-l-orange-500 bg-muted" />
            <span>Follow-up</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded border-l-4 border-l-yellow-500 bg-muted" />
            <span>Adjustment</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default AppointmentCalendar;
