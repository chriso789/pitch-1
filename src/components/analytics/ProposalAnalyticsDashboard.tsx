import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  BarChart3, 
  Eye, 
  FileCheck, 
  TrendingUp, 
  Clock,
  Users,
  DollarSign,
  PieChart,
  Loader2
} from 'lucide-react';
import { PieChart as RechartsPie, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { cn } from '@/lib/utils';

interface ProposalAnalyticsProps {
  tenantId: string;
}

export function ProposalAnalyticsDashboard({ tenantId }: ProposalAnalyticsProps) {
  const [dateRange, setDateRange] = useState<string>('30');

  // Fetch overall analytics
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['proposal-analytics', tenantId, dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_proposal_analytics', {
          p_tenant_id: tenantId,
          p_days: parseInt(dateRange)
        });
      
      if (error) throw error;
      return data?.[0] || null;
    },
    enabled: !!tenantId
  });

  // Fetch rep performance
  const { data: repPerformance, isLoading: repLoading } = useQuery({
    queryKey: ['proposal-rep-performance', tenantId, dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_proposal_rep_performance', {
          p_tenant_id: tenantId,
          p_days: parseInt(dateRange)
        });
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId
  });

  const formatCurrency = (amount: number) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);

  const formatPercent = (value: number) => `${value}%`;

  // Tier distribution data for pie chart
  const tierData = analytics ? [
    { name: 'Good', value: Number(analytics.good_tier_count) || 0, color: '#3b82f6' },
    { name: 'Better', value: Number(analytics.better_tier_count) || 0, color: '#f59e0b' },
    { name: 'Best', value: Number(analytics.best_tier_count) || 0, color: '#10b981' }
  ].filter(d => d.value > 0) : [];

  const isLoading = analyticsLoading || repLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with date filter */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Proposal Analytics</h2>
          <p className="text-muted-foreground">
            Track proposal performance and conversion rates
          </p>
        </div>
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Select range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="60">Last 60 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Proposals Sent</CardTitle>
            <FileCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics?.total_sent || 0}</div>
            <p className="text-xs text-muted-foreground">
              In the last {dateRange} days
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">View Rate</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatPercent(Number(analytics?.view_rate) || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              {analytics?.total_viewed || 0} of {analytics?.total_sent || 0} viewed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conversion Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatPercent(Number(analytics?.conversion_rate) || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              {analytics?.total_signed || 0} signed agreements
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Time to Sign</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Number(analytics?.avg_time_to_sign_hours) > 24 
                ? `${Math.round(Number(analytics?.avg_time_to_sign_hours) / 24)} days`
                : `${Math.round(Number(analytics?.avg_time_to_sign_hours) || 0)} hrs`
              }
            </div>
            <p className="text-xs text-muted-foreground">
              From sent to signed
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Section */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Tier Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="h-5 w-5" />
              Tier Selection Distribution
            </CardTitle>
            <CardDescription>
              Which tiers customers are choosing
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tierData.length > 0 ? (
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsPie>
                    <Pie
                      data={tierData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {tierData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </RechartsPie>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[250px] text-muted-foreground">
                No signed proposals yet
              </div>
            )}
          </CardContent>
        </Card>

        {/* Conversion Funnel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Proposal Funnel
            </CardTitle>
            <CardDescription>
              From sent to signed
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[
                    { stage: 'Sent', count: Number(analytics?.total_sent) || 0 },
                    { stage: 'Viewed', count: Number(analytics?.total_viewed) || 0 },
                    { stage: 'Signed', count: Number(analytics?.total_signed) || 0 }
                  ]}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <XAxis type="number" />
                  <YAxis dataKey="stage" type="category" width={80} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rep Performance Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Rep Performance
          </CardTitle>
          <CardDescription>
            Proposal performance by sales representative
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rep Name</TableHead>
                <TableHead className="text-center">Sent</TableHead>
                <TableHead className="text-center">Viewed</TableHead>
                <TableHead className="text-center">Signed</TableHead>
                <TableHead className="text-center">Conversion</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {repPerformance && repPerformance.length > 0 ? (
                repPerformance.map((rep: any) => (
                  <TableRow key={rep.user_id}>
                    <TableCell className="font-medium">{rep.full_name}</TableCell>
                    <TableCell className="text-center">{rep.proposals_sent}</TableCell>
                    <TableCell className="text-center">{rep.proposals_viewed}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={rep.proposals_signed > 0 ? 'default' : 'secondary'}>
                        {rep.proposals_signed}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={cn(
                        'font-medium',
                        Number(rep.conversion_rate) >= 30 ? 'text-green-600' :
                        Number(rep.conversion_rate) >= 15 ? 'text-yellow-600' : 'text-muted-foreground'
                      )}>
                        {formatPercent(Number(rep.conversion_rate))}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(Number(rep.total_revenue) || 0)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No proposal data for this period
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
