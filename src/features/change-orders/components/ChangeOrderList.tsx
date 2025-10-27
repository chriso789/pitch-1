import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { FileText, DollarSign, Calendar } from 'lucide-react';

interface ChangeOrderListProps {
  status?: string;
}

export function ChangeOrderList({ status }: ChangeOrderListProps) {
  const { data: changeOrders, isLoading } = useQuery({
    queryKey: ['change-orders', status],
    queryFn: async () => {
      let query = (supabase as any)
        .from('change_orders')
        .select(`
          *,
          projects(name, project_number),
          profiles!change_orders_requested_by_fkey(first_name, last_name)
        `)
        .order('requested_date', { ascending: false });

      if (status && status !== 'all') {
        query = query.eq('status', status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return <div>Loading change orders...</div>;
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      draft: 'outline',
      pending_approval: 'secondary',
      approved: 'default',
      rejected: 'destructive',
      completed: 'default',
    };
    return <Badge variant={variants[status] || 'outline'}>{status.replace('_', ' ')}</Badge>;
  };

  return (
    <div className="space-y-4">
      {changeOrders?.map((co: any) => (
        <Card key={co.id}>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  {co.co_number}: {co.title}
                </CardTitle>
                <CardDescription>
                  {co.projects?.name} ({co.projects?.project_number})
                </CardDescription>
              </div>
              {getStatusBadge(co.status)}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm text-muted-foreground">Cost Impact</div>
                    <div className="font-semibold">
                      ${Number(co.cost_impact).toFixed(2)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm text-muted-foreground">Time Impact</div>
                    <div className="font-semibold">
                      {co.time_impact_days} days
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Requested By</div>
                  <div className="font-semibold">
                    {co.profiles?.first_name} {co.profiles?.last_name}
                  </div>
                </div>
              </div>

              {co.reason && (
                <div>
                  <div className="text-sm font-medium mb-1">Reason</div>
                  <div className="text-sm text-muted-foreground">{co.reason}</div>
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                Requested on {format(new Date(co.requested_date), 'MMM d, yyyy')}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      {!changeOrders?.length && (
        <Card>
          <CardContent className="text-center py-8 text-muted-foreground">
            No change orders found
          </CardContent>
        </Card>
      )}
    </div>
  );
}
