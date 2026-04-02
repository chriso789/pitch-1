import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { History, User, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format, parseISO } from 'date-fns';

interface HistoryEntry {
  id: string;
  change_type: string;
  old_values: any;
  new_values: any;
  created_at: string;
  changed_by_profile?: {
    first_name: string;
    last_name: string;
  };
}

interface AppointmentHistoryProps {
  appointmentId: string;
}

const changeTypeLabels: Record<string, { label: string; color: string }> = {
  created: { label: 'Created', color: 'bg-green-500' },
  updated: { label: 'Updated', color: 'bg-blue-500' },
  rescheduled: { label: 'Rescheduled', color: 'bg-orange-500' },
  cancelled: { label: 'Cancelled', color: 'bg-red-500' },
  attendee_changed: { label: 'Attendee Changed', color: 'bg-purple-500' },
  outcome_set: { label: 'Outcome Set', color: 'bg-emerald-500' },
};

export const AppointmentHistory: React.FC<AppointmentHistoryProps> = ({ appointmentId }) => {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory();
  }, [appointmentId]);

  const fetchHistory = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('appointment_history')
      .select(`
        *,
        changed_by_profile:profiles!appointment_history_changed_by_fkey(first_name, last_name)
      `)
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: false });

    if (!error) setHistory(data || []);
    setLoading(false);
  };

  const formatFieldChange = (key: string, oldVal: any, newVal: any) => {
    if (key === 'scheduled_start' || key === 'scheduled_end') {
      const oldStr = oldVal ? format(parseISO(oldVal), 'MMM d, h:mm a') : '—';
      const newStr = newVal ? format(parseISO(newVal), 'MMM d, h:mm a') : '—';
      return { key: key.replace('scheduled_', ''), old: oldStr, new: newStr };
    }
    return { key, old: String(oldVal ?? '—'), new: String(newVal ?? '—') };
  };

  const getKeyChanges = (entry: HistoryEntry) => {
    if (entry.change_type === 'created') return [];
    const important = ['title', 'scheduled_start', 'scheduled_end', 'status', 'assigned_to', 'address', 'notes', 'outcome_type_id'];
    const changes: { key: string; old: string; new: string }[] = [];

    for (const key of important) {
      const oldVal = entry.old_values?.[key];
      const newVal = entry.new_values?.[key];
      if (oldVal !== newVal && (oldVal || newVal)) {
        changes.push(formatFieldChange(key, oldVal, newVal));
      }
    }
    return changes;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="h-4 w-4" />
          Appointment History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-4 text-muted-foreground text-sm">Loading...</div>
        ) : history.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground text-sm">No history recorded.</div>
        ) : (
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-3">
              {history.map(entry => {
                const typeInfo = changeTypeLabels[entry.change_type] || { label: entry.change_type, color: 'bg-muted-foreground' };
                const changes = getKeyChanges(entry);

                return (
                  <div key={entry.id} className="flex gap-3 text-sm">
                    <div className="flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full mt-1.5 ${typeInfo.color}`} />
                      <div className="w-px flex-1 bg-border mt-1" />
                    </div>
                    <div className="flex-1 pb-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] px-1.5">{typeInfo.label}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(parseISO(entry.created_at), 'MMM d, yyyy h:mm a')}
                        </span>
                      </div>
                      {entry.changed_by_profile && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                          <User className="h-3 w-3" />
                          {entry.changed_by_profile.first_name} {entry.changed_by_profile.last_name}
                        </div>
                      )}
                      {changes.length > 0 && (
                        <div className="mt-1.5 space-y-1">
                          {changes.map((c, i) => (
                            <div key={i} className="text-xs flex items-center gap-1">
                              <span className="font-medium capitalize">{c.key.replace(/_/g, ' ')}:</span>
                              <span className="text-muted-foreground line-through">{c.old}</span>
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                              <span>{c.new}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};
