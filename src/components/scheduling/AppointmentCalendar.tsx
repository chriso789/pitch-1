import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Calendar as CalendarIcon, Clock, User, MapPin, CheckCircle, XCircle, AlertCircle, Plus, Cloud, Users, History, Target } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, parseISO, addDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { CalendarWeatherOverlay } from './CalendarWeatherOverlay';
import { AppointmentHistory } from './AppointmentHistory';

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
  outcome_type_id?: string;
  contact?: {
    first_name: string;
    last_name: string;
  };
  assigned_to_profile?: {
    first_name: string;
    last_name: string;
  };
}

interface TeamMember {
  id: string;
  first_name: string;
  last_name: string;
}

interface OutcomeType {
  id: string;
  name: string;
  color: string;
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
  const [weatherLocation] = useState({ latitude: 32.7767, longitude: -96.7970 });

  // Multi-rep picker
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [selectedReps, setSelectedReps] = useState<string[]>([]);
  const [showTeamPicker, setShowTeamPicker] = useState(false);

  // Outcomes
  const [outcomeTypes, setOutcomeTypes] = useState<OutcomeType[]>([]);
  const [selectedAppointmentForOutcome, setSelectedAppointmentForOutcome] = useState<string | null>(null);

  // History
  const [historyAppointmentId, setHistoryAppointmentId] = useState<string | null>(null);

  const effectiveTenantId = tenantId || profile?.tenant_id;
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  // Load team members and outcome types
  useEffect(() => {
    if (!effectiveTenantId) return;

    const loadTeamAndOutcomes = async () => {
      const [teamResult, outcomesResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, first_name, last_name')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true)
          .order('first_name'),
        supabase
          .from('appointment_outcome_types')
          .select('id, name, color')
          .eq('tenant_id', effectiveTenantId)
          .eq('active', true)
          .order('sort_order'),
      ]);

      if (teamResult.data) setTeamMembers(teamResult.data);
      if (outcomesResult.data) setOutcomeTypes(outcomesResult.data);
    };

    loadTeamAndOutcomes();
  }, [effectiveTenantId]);

  const fetchAppointments = useCallback(async () => {
    if (!effectiveTenantId) return;
    setLoading(true);
    try {
      let query = supabase
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

      // Filter by selected reps if any
      if (selectedReps.length > 0) {
        query = query.in('assigned_to', selectedReps);
      }

      const { data, error } = await query;
      if (error) throw error;
      setAppointments(data || []);
    } catch (error) {
      console.error('Error fetching appointments:', error);
    } finally {
      setLoading(false);
    }
  }, [effectiveTenantId, selectedDate, selectedReps, weekStart, weekEnd]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  const toggleRep = (repId: string) => {
    setSelectedReps(prev =>
      prev.includes(repId) ? prev.filter(id => id !== repId) : [...prev, repId]
    );
  };

  const setOutcome = async (appointmentId: string, outcomeTypeId: string) => {
    const { error } = await supabase
      .from('appointments')
      .update({ outcome_type_id: outcomeTypeId })
      .eq('id', appointmentId);

    if (!error) {
      setAppointments(prev =>
        prev.map(a => a.id === appointmentId ? { ...a, outcome_type_id: outcomeTypeId } : a)
      );
      setSelectedAppointmentForOutcome(null);
    }
  };

  const getOutcomeBadge = (outcomeTypeId?: string) => {
    if (!outcomeTypeId) return null;
    const outcome = outcomeTypes.find(o => o.id === outcomeTypeId);
    if (!outcome) return null;
    return (
      <Badge className="text-[10px] px-1.5 py-0 border-0" style={{ backgroundColor: outcome.color, color: '#fff' }}>
        {outcome.name}
      </Badge>
    );
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

  const timeSlots = Array.from({ length: 12 }, (_, i) => i + 7);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarIcon className="h-5 w-5" />
                Appointment Calendar
              </CardTitle>
              <CardDescription>
                {format(weekStart, 'MMMM d')} - {format(weekEnd, 'MMMM d, yyyy')}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Team member picker */}
              <Popover open={showTeamPicker} onOpenChange={setShowTeamPicker}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1">
                    <Users className="h-4 w-4" />
                    {selectedReps.length > 0 ? `${selectedReps.length} reps` : 'All Team'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64" align="end">
                  <div className="space-y-2">
                    <div className="font-medium text-sm">Filter by Team Member</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start text-xs"
                      onClick={() => setSelectedReps([])}
                    >
                      Show All
                    </Button>
                    <ScrollArea className="max-h-48">
                      {teamMembers.map(member => (
                        <label key={member.id} className="flex items-center gap-2 py-1.5 px-2 hover:bg-muted/50 rounded cursor-pointer">
                          <Checkbox
                            checked={selectedReps.includes(member.id)}
                            onCheckedChange={() => toggleRep(member.id)}
                          />
                          <span className="text-sm">{member.first_name} {member.last_name}</span>
                        </label>
                      ))}
                    </ScrollArea>
                  </div>
                </PopoverContent>
              </Popover>

              <div className="flex items-center gap-2">
                <Switch id="show-weather" checked={showWeather} onCheckedChange={setShowWeather} />
                <Label htmlFor="show-weather" className="text-sm flex items-center gap-1 cursor-pointer">
                  <Cloud className="h-4 w-4" />
                  Weather
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setSelectedDate(addDays(selectedDate, -7))}>Previous</Button>
                <Button variant="outline" size="sm" onClick={() => setSelectedDate(new Date())}>Today</Button>
                <Button variant="outline" size="sm" onClick={() => setSelectedDate(addDays(selectedDate, 7))}>Next</Button>
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
                              className={cn(
                                'p-2 rounded text-xs cursor-pointer border-l-4 bg-muted/50 hover:bg-muted transition-colors relative group',
                                getAppointmentTypeColor(apt.appointment_type)
                              )}
                            >
                              <div onClick={() => onSelectAppointment?.(apt)}>
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
                                {getOutcomeBadge(apt.outcome_type_id)}
                              </div>
                              {/* Action buttons on hover */}
                              <div className="hidden group-hover:flex gap-1 mt-1">
                                <button
                                  className="text-[10px] text-muted-foreground hover:text-foreground"
                                  onClick={(e) => { e.stopPropagation(); setSelectedAppointmentForOutcome(apt.id); }}
                                >
                                  <Target className="h-3 w-3" />
                                </button>
                                <button
                                  className="text-[10px] text-muted-foreground hover:text-foreground"
                                  onClick={(e) => { e.stopPropagation(); setHistoryAppointmentId(apt.id); }}
                                >
                                  <History className="h-3 w-3" />
                                </button>
                              </div>
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
                                {getOutcomeBadge(apt.outcome_type_id)}
                                {apt.ai_suggested && (
                                  <Badge variant="secondary">AI {apt.ai_score}%</Badge>
                                )}
                                <button
                                  className="text-muted-foreground hover:text-foreground"
                                  onClick={(e) => { e.stopPropagation(); setSelectedAppointmentForOutcome(apt.id); }}
                                >
                                  <Target className="h-4 w-4" />
                                </button>
                                <button
                                  className="text-muted-foreground hover:text-foreground"
                                  onClick={(e) => { e.stopPropagation(); setHistoryAppointmentId(apt.id); }}
                                >
                                  <History className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                        {slotAppointments.length === 0 && <div className="h-8" />}
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

      {/* Outcome selector popover */}
      {selectedAppointmentForOutcome && outcomeTypes.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4" /> Set Outcome
            </h4>
            <Button variant="ghost" size="sm" onClick={() => setSelectedAppointmentForOutcome(null)}>
              Close
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {outcomeTypes.map(o => (
              <Button
                key={o.id}
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setOutcome(selectedAppointmentForOutcome, o.id)}
              >
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: o.color }} />
                {o.name}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {/* Appointment history panel */}
      {historyAppointmentId && (
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 z-10"
            onClick={() => setHistoryAppointmentId(null)}
          >
            Close
          </Button>
          <AppointmentHistory appointmentId={historyAppointmentId} />
        </div>
      )}
    </div>
  );
};

export default AppointmentCalendar;
