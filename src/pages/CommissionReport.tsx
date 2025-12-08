import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { CommissionSummaryCards } from '@/components/commission/CommissionSummaryCards';
import { CommissionReportTable } from '@/components/commission/CommissionReportTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, Filter, RefreshCw } from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';

interface UserRole {
  role: string;
}

interface CurrentUserProfile {
  id: string;
  tenant_id: string;
  user_roles: UserRole[];
}

export default function CommissionReport() {
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
  });
  const [selectedRep, setSelectedRep] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Get current user and tenant
  const { data: currentUser } = useQuery({
    queryKey: ['current-user-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile) return null;

      // Get user roles separately
      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);

      return {
        ...profile,
        user_roles: roles || []
      } as CurrentUserProfile;
    },
  });

  // Get reps for filter (managers only)
  const { data: reps = [] } = useQuery({
    queryKey: ['commission-reps', currentUser?.tenant_id],
    queryFn: async () => {
      if (!currentUser?.tenant_id) return [];

      const { data } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .eq('tenant_id', currentUser.tenant_id)
        .order('first_name');

      return data || [];
    },
    enabled: !!currentUser?.tenant_id,
  });

  // Get commission earnings
  const { data: earnings = [], isLoading, refetch } = useQuery({
    queryKey: ['commission-earnings', currentUser?.tenant_id, dateRange, selectedRep, statusFilter],
    queryFn: async () => {
      if (!currentUser?.tenant_id) return [];

      let query = supabase
        .from('commission_earnings')
        .select('*')
        .eq('tenant_id', currentUser.tenant_id)
        .gte('closed_date', dateRange.start)
        .lte('closed_date', dateRange.end)
        .order('closed_date', { ascending: false });

      if (selectedRep !== 'all') {
        query = query.eq('user_id', selectedRep);
      }

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      // Fetch profile names separately for each earning
      const earningsWithProfiles = await Promise.all(
        (data || []).map(async (earning) => {
          const { data: profile } = await supabase
            .from('profiles')
            .select('first_name, last_name')
            .eq('id', earning.user_id)
            .single();
          return { ...earning, profiles: profile };
        })
      );
      
      return earningsWithProfiles;
    },
    enabled: !!currentUser?.tenant_id,
  });

  // Check if user is manager
  const isManager = currentUser?.user_roles?.some(
    (r: UserRole) =>
      ['master', 'corporate', 'office_admin', 'regional_manager', 'sales_manager'].includes(r.role)
  );

  // Calculate summary stats
  const totalJobs = earnings.length;
  const totalRevenue = earnings.reduce((sum, e) => sum + Number(e.contract_value), 0);
  const totalCommissions = earnings.reduce((sum, e) => sum + Number(e.commission_amount), 0);
  const pendingCommissions = earnings
    .filter((e) => e.status === 'pending')
    .reduce((sum, e) => sum + Number(e.commission_amount), 0);
  const paidCommissions = earnings
    .filter((e) => e.status === 'paid')
    .reduce((sum, e) => sum + Number(e.commission_amount), 0);

  const handleExportCSV = () => {
    const headers = [
      'Job Number',
      'Customer',
      'Address',
      'Closed Date',
      'Contract Value',
      'Materials',
      'Labor',
      'Adjustments',
      'Gross Profit',
      'Rep Overhead',
      'Net Profit',
      'Commission Type',
      'Commission Rate',
      'Commission Amount',
      'Status',
    ];

    const rows = earnings.map((e) => [
      e.job_number || '',
      e.customer_name || '',
      e.job_address || '',
      e.closed_date || '',
      e.contract_value,
      e.actual_material_cost,
      e.actual_labor_cost,
      e.total_adjustments,
      e.gross_profit,
      e.rep_overhead_amount,
      e.net_profit,
      e.commission_type,
      e.commission_rate,
      e.commission_amount,
      e.status,
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `commission-report-${dateRange.start}-to-${dateRange.end}.csv`;
    link.click();
  };

  return (
    <GlobalLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Commission Report</h1>
            <p className="text-muted-foreground">
              View detailed commission breakdowns for closed jobs
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button onClick={handleExportCSV}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) =>
                    setDateRange((prev) => ({ ...prev, start: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) =>
                    setDateRange((prev) => ({ ...prev, end: e.target.value }))
                  }
                />
              </div>

              {isManager && (
                <div className="space-y-2">
                  <Label>Sales Rep</Label>
                  <Select value={selectedRep} onValueChange={setSelectedRep}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Reps" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Reps</SelectItem>
                      {reps.map((rep) => (
                        <SelectItem key={rep.id} value={rep.id}>
                          {rep.first_name} {rep.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <CommissionSummaryCards
          totalJobs={totalJobs}
          totalRevenue={totalRevenue}
          totalCommissions={totalCommissions}
          pendingCommissions={pendingCommissions}
          paidCommissions={paidCommissions}
        />

        {/* Commission Table */}
        <Card>
          <CardHeader>
            <CardTitle>Commission Details</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading commission data...
              </div>
            ) : (
              <CommissionReportTable
                earnings={earnings}
                showRep={isManager && selectedRep === 'all'}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </GlobalLayout>
  );
}
