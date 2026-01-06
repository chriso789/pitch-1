import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown,
  DollarSign,
  Target,
  CheckCircle,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export const BudgetPerformanceReport: React.FC = () => {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['budget-performance-stats'],
    queryFn: async () => {
      // Fetch all reconciliation records
      const { data, error } = await supabase
        .from('project_cost_reconciliation')
        .select('*')
        .eq('status', 'completed');

      if (error) throw error;

      const records = data || [];
      
      // Calculate stats
      const underBudget = records.filter(r => (r.total_variance || 0) <= 0).length;
      const overBudget = records.filter(r => (r.total_variance || 0) > 0).length;
      const onBudget = records.filter(r => r.total_variance === 0).length;
      
      const totalOriginalProfit = records.reduce((sum, r) => sum + (r.original_profit || 0), 0);
      const totalFinalProfit = records.reduce((sum, r) => sum + (r.final_profit || 0), 0);
      
      const materialVarianceTotal = records.reduce((sum, r) => sum + (r.material_variance || 0), 0);
      const laborVarianceTotal = records.reduce((sum, r) => sum + (r.labor_variance || 0), 0);
      
      const avgMaterialVariance = records.length > 0 
        ? materialVarianceTotal / records.length 
        : 0;
      const avgLaborVariance = records.length > 0 
        ? laborVarianceTotal / records.length 
        : 0;

      return {
        totalProjects: records.length,
        underBudget,
        overBudget,
        onBudget,
        totalOriginalProfit,
        totalFinalProfit,
        profitImpact: totalFinalProfit - totalOriginalProfit,
        materialVarianceTotal,
        laborVarianceTotal,
        avgMaterialVariance,
        avgLaborVariance,
        // For charts
        budgetDistribution: [
          { name: 'Under Budget', value: underBudget, color: '#22c55e' },
          { name: 'On Budget', value: onBudget, color: '#3b82f6' },
          { name: 'Over Budget', value: overBudget, color: '#ef4444' }
        ],
        varianceByCategory: [
          { name: 'Materials', variance: avgMaterialVariance },
          { name: 'Labor', variance: avgLaborVariance }
        ]
      };
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

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!stats) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No data available
        </CardContent>
      </Card>
    );
  }

  const successRate = stats.totalProjects > 0 
    ? ((stats.underBudget + stats.onBudget) / stats.totalProjects * 100).toFixed(1) 
    : 0;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Projects Analyzed</p>
                <p className="text-2xl font-bold">{stats.totalProjects}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-success" />
              <div>
                <p className="text-sm text-muted-foreground">Budget Success Rate</p>
                <p className="text-2xl font-bold text-success">{successRate}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <DollarSign className={`h-5 w-5 ${stats.profitImpact >= 0 ? 'text-success' : 'text-destructive'}`} />
              <div>
                <p className="text-sm text-muted-foreground">Profit Impact</p>
                <p className={`text-2xl font-bold ${stats.profitImpact >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {stats.profitImpact >= 0 ? '+' : ''}{formatCurrency(stats.profitImpact)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              {stats.materialVarianceTotal + stats.laborVarianceTotal <= 0 ? (
                <TrendingDown className="h-5 w-5 text-success" />
              ) : (
                <TrendingUp className="h-5 w-5 text-destructive" />
              )}
              <div>
                <p className="text-sm text-muted-foreground">Total Cost Variance</p>
                <p className={`text-2xl font-bold ${stats.materialVarianceTotal + stats.laborVarianceTotal <= 0 ? 'text-success' : 'text-destructive'}`}>
                  {formatCurrency(stats.materialVarianceTotal + stats.laborVarianceTotal)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Budget Distribution Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Budget Performance Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.budgetDistribution.filter(d => d.value > 0)}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {stats.budgetDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Variance by Category */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Average Variance by Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.varianceByCategory}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={(value) => `$${value.toLocaleString()}`} />
                  <Tooltip 
                    formatter={(value: number) => [formatCurrency(value), 'Avg Variance']}
                  />
                  <Bar 
                    dataKey="variance" 
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Detailed Performance Metrics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-sm text-muted-foreground">Projects Under Budget</p>
              <p className="text-xl font-bold text-success">{stats.underBudget}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Projects Over Budget</p>
              <p className="text-xl font-bold text-destructive">{stats.overBudget}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Original Profit</p>
              <p className="text-xl font-bold">{formatCurrency(stats.totalOriginalProfit)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Final Profit</p>
              <p className={`text-xl font-bold ${stats.totalFinalProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatCurrency(stats.totalFinalProfit)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Avg Material Variance</p>
              <p className={`text-xl font-bold ${stats.avgMaterialVariance <= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatCurrency(stats.avgMaterialVariance)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Avg Labor Variance</p>
              <p className={`text-xl font-bold ${stats.avgLaborVariance <= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatCurrency(stats.avgLaborVariance)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Material Variance</p>
              <p className={`text-xl font-bold ${stats.materialVarianceTotal <= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatCurrency(stats.materialVarianceTotal)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Labor Variance</p>
              <p className={`text-xl font-bold ${stats.laborVarianceTotal <= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatCurrency(stats.laborVarianceTotal)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
