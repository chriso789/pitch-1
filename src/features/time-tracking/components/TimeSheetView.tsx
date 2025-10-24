import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { Clock, CheckCircle, XCircle } from 'lucide-react';

export function TimeSheetView() {
  const { data: timeEntries, isLoading } = useQuery({
    queryKey: ['time-entries'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_entries')
        .select(`
          *,
          profiles!time_entries_user_id_fkey(first_name, last_name),
          projects(name)
        `)
        .order('entry_date', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return <div>Loading timesheets...</div>;
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      draft: 'outline',
      submitted: 'secondary',
      approved: 'default',
      rejected: 'destructive',
    };
    return <Badge variant={variants[status] || 'outline'}>{status}</Badge>;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Recent Time Entries</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {timeEntries?.map((entry: any) => (
              <div
                key={entry.id}
                className="flex items-center justify-between p-4 border rounded-lg"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">
                      {entry.profiles?.first_name} {entry.profiles?.last_name}
                    </span>
                    {getStatusBadge(entry.status)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {format(new Date(entry.entry_date), 'EEEE, MMM d, yyyy')}
                  </div>
                  {entry.projects && (
                    <div className="text-sm text-muted-foreground">
                      Project: {entry.projects.name}
                    </div>
                  )}
                </div>

                <div className="text-right space-y-1">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">
                      {Number(entry.total_hours).toFixed(2)} hrs
                    </span>
                  </div>
                  {entry.clock_in && entry.clock_out && (
                    <div className="text-sm text-muted-foreground">
                      {format(new Date(entry.clock_in), 'h:mm a')} -{' '}
                      {format(new Date(entry.clock_out), 'h:mm a')}
                    </div>
                  )}
                  {entry.total_cost && (
                    <div className="text-sm font-medium">
                      ${Number(entry.total_cost).toFixed(2)}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {!timeEntries?.length && (
              <div className="text-center py-8 text-muted-foreground">
                No time entries found
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
