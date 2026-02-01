// ============================================================
// Scope Intelligence Dashboard Component
// Analytics dashboard with price distributions and dispute success rates
// ============================================================

import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend
} from 'recharts';
import { 
  TrendingUp, 
  DollarSign, 
  FileText, 
  Building2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  BarChart3,
  PieChartIcon
} from 'lucide-react';
import { useScopeDocuments, useCanonicalItems } from '@/hooks/useScopeIntelligence';
import { CARRIER_DISPLAY_NAMES, ITEM_CATEGORIES } from '@/lib/insurance/canonicalItems';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils';

interface ScopeIntelligenceDashboardProps {
  className?: string;
}

const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--secondary))',
  'hsl(220, 70%, 50%)',
  'hsl(280, 70%, 50%)',
  'hsl(340, 70%, 50%)',
  'hsl(160, 70%, 50%)',
  'hsl(40, 70%, 50%)',
];

export const ScopeIntelligenceDashboard: React.FC<ScopeIntelligenceDashboardProps> = ({
  className
}) => {
  const { data: documents } = useScopeDocuments();
  const { data: canonicalItems } = useCanonicalItems();

  // Compute stats
  const stats = useMemo(() => {
    if (!documents) return null;

    const completedDocs = documents.filter(d => d.parse_status === 'complete');
    const carrierCounts = new Map<string, number>();
    const typeCounts = new Map<string, number>();
    const monthlyDocs: Record<string, number> = {};

    for (const doc of documents) {
      // Carrier distribution
      const carrier = doc.carrier_normalized || 'unknown';
      carrierCounts.set(carrier, (carrierCounts.get(carrier) || 0) + 1);

      // Document type distribution
      typeCounts.set(doc.document_type, (typeCounts.get(doc.document_type) || 0) + 1);

      // Monthly trend
      const month = new Date(doc.created_at).toISOString().slice(0, 7);
      monthlyDocs[month] = (monthlyDocs[month] || 0) + 1;
    }

    // Sort monthly by date
    const monthlyTrend = Object.entries(monthlyDocs)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, count]) => ({
        month: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        count
      }));

    return {
      totalDocuments: documents.length,
      completedDocuments: completedDocs.length,
      failedDocuments: documents.filter(d => d.parse_status === 'failed').length,
      needsReview: documents.filter(d => d.parse_status === 'needs_review').length,
      parseRate: documents.length > 0 ? (completedDocs.length / documents.length) * 100 : 0,
      carrierDistribution: Array.from(carrierCounts.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 7)
        .map(([carrier, count]) => ({
          name: CARRIER_DISPLAY_NAMES[carrier] || carrier.replace(/_/g, ' '),
          value: count
        })),
      typeDistribution: Array.from(typeCounts.entries()).map(([type, count]) => ({
        name: type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        value: count
      })),
      monthlyTrend,
      uniqueCarriers: carrierCounts.size
    };
  }, [documents]);

  // Canonical item category stats
  const categoryStats = useMemo(() => {
    if (!canonicalItems) return [];
    
    const categoryCounts = new Map<string, number>();
    for (const item of canonicalItems) {
      categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + 1);
    }
    
    return Array.from(categoryCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([category, count]) => ({ category, count }));
  }, [canonicalItems]);

  if (!stats) {
    return (
      <Card className={cn("", className)}>
        <CardContent className="py-12 text-center">
          <BarChart3 className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <p className="text-muted-foreground">Loading dashboard data...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.totalDocuments}</p>
                <p className="text-xs text-muted-foreground">Total Scopes</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.completedDocuments}</p>
                <p className="text-xs text-muted-foreground">Successfully Parsed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <AlertCircle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.needsReview}</p>
                <p className="text-xs text-muted-foreground">Needs Review</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-muted rounded-lg">
                <Building2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.uniqueCarriers}</p>
                <p className="text-xs text-muted-foreground">Carriers Tracked</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Carrier Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChartIcon className="h-5 w-5" />
              Carrier Distribution
            </CardTitle>
            <CardDescription>
              Documents by insurance carrier
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stats.carrierDistribution.length > 0 ? (
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={stats.carrierDistribution}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      dataKey="value"
                      label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      labelLine={false}
                    >
                      {stats.carrierDistribution.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={CHART_COLORS[index % CHART_COLORS.length]} 
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                No carrier data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Monthly Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Document Volume Trend
            </CardTitle>
            <CardDescription>
              Scopes ingested over the last 6 months
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stats.monthlyTrend.length > 0 ? (
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis 
                      dataKey="month" 
                      tick={{ fontSize: 12 }}
                      className="text-muted-foreground"
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }}
                      className="text-muted-foreground"
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Bar 
                      dataKey="count" 
                      fill="hsl(var(--primary))"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                No trend data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Document Types & Canonical Categories */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Document Types */}
        <Card>
          <CardHeader>
            <CardTitle>Document Types</CardTitle>
            <CardDescription>
              Distribution by document classification
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats.typeDistribution.map(({ name, value }) => (
                <div key={name}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{name}</span>
                    <span className="text-sm text-muted-foreground">{value}</span>
                  </div>
                  <Progress 
                    value={(value / stats.totalDocuments) * 100} 
                    className="h-2"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Canonical Item Categories */}
        <Card>
          <CardHeader>
            <CardTitle>Canonical Item Taxonomy</CardTitle>
            <CardDescription>
              Items available for mapping by category
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {categoryStats.map(({ category, count }) => {
                const categoryInfo = ITEM_CATEGORIES.find(c => c.key === category);
                return (
                  <div key={category}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{category}</Badge>
                      </div>
                      <span className="text-sm text-muted-foreground">{count} items</span>
                    </div>
                    <Progress 
                      value={(count / (canonicalItems?.length || 1)) * 100} 
                      className="h-2"
                    />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Parse Success Rate */}
      <Card>
        <CardHeader>
          <CardTitle>Parse Success Rate</CardTitle>
          <CardDescription>
            Overall document parsing performance
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-8">
            <div className="flex-1">
              <Progress value={stats.parseRate} className="h-4" />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold">{stats.parseRate.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">
                {stats.completedDocuments} of {stats.totalDocuments} documents
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 mt-6">
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <CheckCircle2 className="h-6 w-6 text-green-600 mx-auto mb-2" />
              <p className="text-lg font-bold text-green-700">{stats.completedDocuments}</p>
              <p className="text-xs text-green-600">Completed</p>
            </div>
            <div className="text-center p-4 bg-amber-50 rounded-lg">
              <AlertCircle className="h-6 w-6 text-amber-600 mx-auto mb-2" />
              <p className="text-lg font-bold text-amber-700">{stats.needsReview}</p>
              <p className="text-xs text-amber-600">Needs Review</p>
            </div>
            <div className="text-center p-4 bg-red-50 rounded-lg">
              <XCircle className="h-6 w-6 text-red-600 mx-auto mb-2" />
              <p className="text-lg font-bold text-red-700">{stats.failedDocuments}</p>
              <p className="text-xs text-red-600">Failed</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ScopeIntelligenceDashboard;
