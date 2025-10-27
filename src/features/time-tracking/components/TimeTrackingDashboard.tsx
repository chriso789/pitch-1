import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TimeClockWidget } from './TimeClockWidget';
import { TimeSheetView } from './TimeSheetView';
import { LaborCostDashboard } from './LaborCostDashboard';
import { Clock, DollarSign, Users } from 'lucide-react';
import { format } from 'date-fns';

export default function TimeTrackingDashboard() {
  const [selectedTab, setSelectedTab] = useState('clock');

  const { data: weekStats } = useQuery({
    queryKey: ['time-entries-week-stats'],
    queryFn: async () => {
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      
      const { data, error } = await (supabase as any)
        .from('time_entries')
        .select('total_hours, total_cost, status')
        .gte('entry_date', format(startOfWeek, 'yyyy-MM-dd'))
        .eq('status', 'approved');

      if (error) throw error;

      const totalHours = data?.reduce((sum, entry) => sum + (Number(entry.total_hours) || 0), 0) || 0;
      const totalCost = data?.reduce((sum, entry) => sum + (Number(entry.total_cost) || 0), 0) || 0;
      const entries = data?.length || 0;

      return { totalHours, totalCost, entries };
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Time Tracking</h1>
        <p className="text-muted-foreground">
          Track time, manage timesheets, and monitor labor costs
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Week</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {weekStats?.totalHours.toFixed(1) || 0} hrs
            </div>
            <p className="text-xs text-muted-foreground">
              {weekStats?.entries || 0} time entries
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Labor Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${weekStats?.totalCost.toFixed(2) || 0}
            </div>
            <p className="text-xs text-muted-foreground">This week</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Rate</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              $
              {weekStats?.totalHours && weekStats?.totalCost
                ? (weekStats.totalCost / weekStats.totalHours).toFixed(2)
                : '0.00'}
              /hr
            </div>
            <p className="text-xs text-muted-foreground">Across all entries</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList>
          <TabsTrigger value="clock">Time Clock</TabsTrigger>
          <TabsTrigger value="timesheet">Timesheets</TabsTrigger>
          <TabsTrigger value="costs">Labor Costs</TabsTrigger>
        </TabsList>

        <TabsContent value="clock" className="space-y-4">
          <div className="max-w-md mx-auto">
            <TimeClockWidget />
          </div>
        </TabsContent>

        <TabsContent value="timesheet">
          <TimeSheetView />
        </TabsContent>

        <TabsContent value="costs">
          <LaborCostDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
