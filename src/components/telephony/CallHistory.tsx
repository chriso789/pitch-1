/**
 * Call History Component
 * Displays call history for a contact or overall
 */

import { useEffect, useState } from 'react';
import { Phone, PhoneIncoming, PhoneOutgoing, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDistanceToNow } from 'date-fns';

interface Call {
  id: string;
  direction: string;
  from_number: string;
  to_number: string;
  status: string;
  disposition: string | null;
  initiated_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  notes: string | null;
  created_at: string;
  contact_id: string | null;
}

interface CallHistoryProps {
  contactId?: string;
  limit?: number;
}

export const CallHistory = ({ contactId, limit = 10 }: CallHistoryProps) => {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCallHistory();
  }, [contactId]);

  const fetchCallHistory = async () => {
    try {
      let query = supabase
        .from('calls')
        .select('*')
        .order('initiated_at', { ascending: false })
        .limit(limit);

      if (contactId) {
        query = query.eq('contact_id', contactId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setCalls((data as any) || []);
    } catch (error) {
      console.error('Error fetching call history:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds: number | null): string => {
    if (!seconds) return 'N/A';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      completed: 'default',
      answered: 'default',
      'no-answer': 'secondary',
      busy: 'secondary',
      failed: 'destructive',
      cancelled: 'outline',
    };

    return (
      <Badge variant={variants[status] || 'outline'}>
        {status}
      </Badge>
    );
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading call history...</div>;
  }

  if (calls.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-sm text-muted-foreground">
            No call history available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Phone className="h-4 w-4" />
          Call History
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px]">
          <div className="space-y-3">
            {calls.map((call) => (
              <div
                key={call.id}
                className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
              >
                <div className="mt-0.5">
                  {call.direction === 'inbound' ? (
                    <PhoneIncoming className="h-4 w-4 text-primary" />
                  ) : (
                    <PhoneOutgoing className="h-4 w-4 text-primary" />
                  )}
                </div>
                
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">
                      {call.direction === 'inbound' ? call.from_number : call.to_number}
                    </span>
                    {getStatusBadge(call.status)}
                  </div>
                  
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(call.initiated_at), { addSuffix: true })}
                    </span>
                    {call.duration_seconds && (
                      <span>Duration: {formatDuration(call.duration_seconds)}</span>
                    )}
                  </div>

                  {call.disposition && (
                    <Badge variant="outline" className="text-xs">
                      {call.disposition}
                    </Badge>
                  )}

                  {call.notes && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {call.notes}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
