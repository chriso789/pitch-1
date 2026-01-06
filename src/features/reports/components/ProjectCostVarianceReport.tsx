import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  TrendingUp, 
  TrendingDown, 
  FileText, 
  Download,
  Filter,
  Search,
  Loader2,
  CheckCircle,
  AlertTriangle
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const ProjectCostVarianceReport: React.FC = () => {
  const [filters, setFilters] = useState({
    search: '',
    status: 'all',
    dateRange: '30'
  });

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['cost-variance-report', filters],
    queryFn: async () => {
      // Get date range
      const daysAgo = parseInt(filters.dateRange);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysAgo);

      // Fetch projects with reconciliation data
      let query = supabase
        .from('project_cost_reconciliation')
        .select(`
          *,
          projects(
            id,
            name,
            project_number,
            pipeline_entries(
              contacts(first_name, last_name),
              profiles:assigned_to(first_name, last_name)
            )
          )
        `)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false });

      if (filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Filter by search term
      let filtered = data || [];
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        filtered = filtered.filter((item: any) => {
          const project = item.projects;
          if (!project) return false;
          const customerName = `${project.pipeline_entries?.contacts?.first_name || ''} ${project.pipeline_entries?.contacts?.last_name || ''}`.toLowerCase();
          return (
            project.name?.toLowerCase().includes(searchLower) ||
            project.project_number?.toLowerCase().includes(searchLower) ||
            customerName.includes(searchLower)
          );
        });
      }

      return filtered;
    }
  });

  const formatCurrency = (amount: number | null) => {
    if (amount === null || amount === undefined) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const getVarianceColor = (variance: number | null) => {
    if (!variance) return 'text-muted-foreground';
    return variance <= 0 ? 'text-success' : 'text-destructive';
  };

  const getVariancePercent = (variance: number | null, original: number | null) => {
    if (!variance || !original || original === 0) return '0%';
    const percent = (variance / original) * 100;
    return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
  };

  // Calculate totals
  const totals = projects.reduce((acc: any, item: any) => ({
    originalMaterial: acc.originalMaterial + (item.original_material_cost || 0),
    actualMaterial: acc.actualMaterial + (item.actual_material_cost || 0),
    originalLabor: acc.originalLabor + (item.original_labor_cost || 0),
    actualLabor: acc.actualLabor + (item.actual_labor_cost || 0),
    originalProfit: acc.originalProfit + (item.original_profit || 0),
    finalProfit: acc.finalProfit + (item.final_profit || 0)
  }), {
    originalMaterial: 0,
    actualMaterial: 0,
    originalLabor: 0,
    actualLabor: 0,
    originalProfit: 0,
    finalProfit: 0
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Project Cost Variance Report
          </CardTitle>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              className="pl-9"
              value={filters.search}
              onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
            />
          </div>
          <Select
            value={filters.status}
            onValueChange={(value) => setFilters(prev => ({ ...prev, status: value }))}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filters.dateRange}
            onValueChange={(value) => setFilters(prev => ({ ...prev, dateRange: value }))}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Date Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">Last year</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Est. Material</TableHead>
                  <TableHead className="text-right">Act. Material</TableHead>
                  <TableHead className="text-right">Var.</TableHead>
                  <TableHead className="text-right">Est. Labor</TableHead>
                  <TableHead className="text-right">Act. Labor</TableHead>
                  <TableHead className="text-right">Var.</TableHead>
                  <TableHead className="text-right">Est. Profit</TableHead>
                  <TableHead className="text-right">Act. Profit</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((item: any) => {
                  const project = item.projects;
                  if (!project) return null;
                  
                  const contact = project.pipeline_entries?.contacts;
                  const customerName = contact 
                    ? `${contact.first_name} ${contact.last_name}` 
                    : 'Unknown';
                  
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {project.project_number || project.name}
                      </TableCell>
                      <TableCell>{customerName}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(item.original_material_cost)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(item.actual_material_cost)}
                      </TableCell>
                      <TableCell className={`text-right ${getVarianceColor(item.material_variance)}`}>
                        <div className="flex items-center justify-end gap-1">
                          {item.material_variance && item.material_variance !== 0 && (
                            item.material_variance < 0 
                              ? <TrendingDown className="h-3 w-3" />
                              : <TrendingUp className="h-3 w-3" />
                          )}
                          {getVariancePercent(item.material_variance, item.original_material_cost)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(item.original_labor_cost)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(item.actual_labor_cost)}
                      </TableCell>
                      <TableCell className={`text-right ${getVarianceColor(item.labor_variance)}`}>
                        <div className="flex items-center justify-end gap-1">
                          {item.labor_variance && item.labor_variance !== 0 && (
                            item.labor_variance < 0 
                              ? <TrendingDown className="h-3 w-3" />
                              : <TrendingUp className="h-3 w-3" />
                          )}
                          {getVariancePercent(item.labor_variance, item.original_labor_cost)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(item.original_profit)}
                      </TableCell>
                      <TableCell className={`text-right font-semibold ${item.final_profit >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {formatCurrency(item.final_profit)}
                      </TableCell>
                      <TableCell className="text-center">
                        {item.status === 'completed' ? (
                          <Badge variant="default" className="bg-success">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Verified
                          </Badge>
                        ) : item.status === 'in_progress' ? (
                          <Badge variant="secondary">In Progress</Badge>
                        ) : (
                          <Badge variant="outline">Pending</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {projects.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                      No projects found matching your criteria
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              {projects.length > 0 && (
                <tfoot className="bg-muted/50 font-semibold">
                  <TableRow>
                    <TableCell colSpan={2}>Totals</TableCell>
                    <TableCell className="text-right">{formatCurrency(totals.originalMaterial)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(totals.actualMaterial)}</TableCell>
                    <TableCell className={`text-right ${getVarianceColor(totals.actualMaterial - totals.originalMaterial)}`}>
                      {getVariancePercent(totals.actualMaterial - totals.originalMaterial, totals.originalMaterial)}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(totals.originalLabor)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(totals.actualLabor)}</TableCell>
                    <TableCell className={`text-right ${getVarianceColor(totals.actualLabor - totals.originalLabor)}`}>
                      {getVariancePercent(totals.actualLabor - totals.originalLabor, totals.originalLabor)}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(totals.originalProfit)}</TableCell>
                    <TableCell className={`text-right ${totals.finalProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {formatCurrency(totals.finalProfit)}
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </tfoot>
              )}
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
