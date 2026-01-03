import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Minus } from 'lucide-react';

interface BudgetCategory {
  name: string;
  budgeted: number;
  actual: number;
  committed?: number;
}

interface ProjectBudgetTrackerProps {
  projectId: string;
  estimatedTotal: number;
  categories?: BudgetCategory[];
}

const DEFAULT_CATEGORIES: BudgetCategory[] = [
  { name: 'Materials', budgeted: 8500, actual: 7850, committed: 650 },
  { name: 'Labor', budgeted: 4500, actual: 3200, committed: 1200 },
  { name: 'Equipment', budgeted: 500, actual: 450, committed: 0 },
  { name: 'Permits & Fees', budgeted: 350, actual: 325, committed: 0 },
  { name: 'Overhead', budgeted: 800, actual: 600, committed: 200 },
  { name: 'Contingency', budgeted: 500, actual: 0, committed: 0 },
];

export const ProjectBudgetTracker: React.FC<ProjectBudgetTrackerProps> = ({
  projectId,
  estimatedTotal,
  categories = DEFAULT_CATEGORIES
}) => {
  const totalBudgeted = categories.reduce((sum, c) => sum + c.budgeted, 0);
  const totalActual = categories.reduce((sum, c) => sum + c.actual, 0);
  const totalCommitted = categories.reduce((sum, c) => sum + (c.committed || 0), 0);
  const totalRemaining = totalBudgeted - totalActual - totalCommitted;
  const budgetUsed = ((totalActual + totalCommitted) / totalBudgeted) * 100;
  const profitMargin = estimatedTotal - totalActual - totalCommitted;
  const profitMarginPct = (profitMargin / estimatedTotal) * 100;

  const getVarianceIndicator = (budgeted: number, actual: number, committed: number = 0) => {
    const total = actual + committed;
    const variance = ((total - budgeted) / budgeted) * 100;
    
    if (Math.abs(variance) < 5) {
      return { icon: <Minus className="h-4 w-4 text-muted-foreground" />, color: 'text-muted-foreground', label: 'On Track' };
    } else if (variance < 0) {
      return { icon: <TrendingDown className="h-4 w-4 text-green-500" />, color: 'text-green-500', label: 'Under Budget' };
    } else if (variance < 15) {
      return { icon: <TrendingUp className="h-4 w-4 text-yellow-500" />, color: 'text-yellow-500', label: 'Slightly Over' };
    } else {
      return { icon: <AlertTriangle className="h-4 w-4 text-destructive" />, color: 'text-destructive', label: 'Over Budget' };
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          Budget vs Actual
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Total Budget</p>
              <p className="text-2xl font-bold">{formatCurrency(totalBudgeted)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Actual Spent</p>
              <p className="text-2xl font-bold">{formatCurrency(totalActual)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Committed</p>
              <p className="text-2xl font-bold text-yellow-600">{formatCurrency(totalCommitted)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Remaining</p>
              <p className={`text-2xl font-bold ${totalRemaining < 0 ? 'text-destructive' : 'text-green-600'}`}>
                {formatCurrency(totalRemaining)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Overall Progress */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Budget Used</span>
            <span className="text-sm text-muted-foreground">{budgetUsed.toFixed(1)}%</span>
          </div>
          <div className="relative">
            <Progress value={Math.min(budgetUsed, 100)} className="h-4" />
            {budgetUsed > 90 && (
              <AlertTriangle className="absolute right-2 top-0 h-4 w-4 text-destructive" />
            )}
          </div>
          <div className="flex justify-between mt-1 text-xs text-muted-foreground">
            <span>Actual: {formatCurrency(totalActual)}</span>
            <span>Committed: {formatCurrency(totalCommitted)}</span>
          </div>
        </div>

        {/* Profit Margin */}
        <Card className={`${profitMarginPct >= 20 ? 'bg-green-50 dark:bg-green-950' : profitMarginPct >= 10 ? 'bg-yellow-50 dark:bg-yellow-950' : 'bg-red-50 dark:bg-red-950'}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Projected Profit Margin</p>
                <p className="text-sm text-muted-foreground">Based on current costs vs contract value</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold">{profitMarginPct.toFixed(1)}%</p>
                <p className="text-sm">{formatCurrency(profitMargin)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Category Breakdown */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Budgeted</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Committed</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((category) => {
              const variance = getVarianceIndicator(category.budgeted, category.actual, category.committed);
              const varianceAmount = (category.actual + (category.committed || 0)) - category.budgeted;
              
              return (
                <TableRow key={category.name}>
                  <TableCell className="font-medium">{category.name}</TableCell>
                  <TableCell className="text-right">{formatCurrency(category.budgeted)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(category.actual)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {category.committed ? formatCurrency(category.committed) : '-'}
                  </TableCell>
                  <TableCell className={`text-right ${variance.color}`}>
                    {varianceAmount >= 0 ? '+' : ''}{formatCurrency(varianceAmount)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {variance.icon}
                      <span className={`text-xs ${variance.color}`}>{variance.label}</span>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {/* Alerts */}
        {categories.some(c => ((c.actual + (c.committed || 0)) / c.budgeted) > 1.15) && (
          <Card className="border-destructive bg-destructive/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
                <div>
                  <p className="font-medium text-destructive">Budget Alert</p>
                  <p className="text-sm text-muted-foreground">
                    One or more categories are significantly over budget. Review costs and consider adjustments.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
};
