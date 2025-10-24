import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Plus, FileText, DollarSign, Clock } from 'lucide-react';
import { ChangeOrderForm } from './ChangeOrderForm';
import { ChangeOrderList } from './ChangeOrderList';
import { format } from 'date-fns';

export default function ChangeOrdersDashboard() {
  const [showForm, setShowForm] = useState(false);
  const [selectedTab, setSelectedTab] = useState('all');

  const { data: stats } = useQuery({
    queryKey: ['change-order-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('change_orders')
        .select('status, cost_impact');

      if (error) throw error;

      const pending = data?.filter((co) => co.status === 'pending_approval').length || 0;
      const approved = data?.filter((co) => co.status === 'approved').length || 0;
      const totalImpact = data
        ?.filter((co) => co.status === 'approved')
        .reduce((sum, co) => sum + Number(co.cost_impact || 0), 0) || 0;

      return { pending, approved, totalImpact, total: data?.length || 0 };
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Change Orders</h1>
          <p className="text-muted-foreground">
            Manage project change orders and track cost impacts
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Change Order
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total COs</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total || 0}</div>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.pending || 0}</div>
            <p className="text-xs text-muted-foreground">Awaiting approval</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Approved</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.approved || 0}</div>
            <p className="text-xs text-muted-foreground">This year</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Impact</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${stats?.totalImpact.toFixed(2) || 0}
            </div>
            <p className="text-xs text-muted-foreground">Approved changes</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
        </TabsList>

        <TabsContent value={selectedTab}>
          <ChangeOrderList status={selectedTab === 'all' ? undefined : selectedTab} />
        </TabsContent>
      </Tabs>

      {showForm && (
        <ChangeOrderForm
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
          }}
        />
      )}
    </div>
  );
}
