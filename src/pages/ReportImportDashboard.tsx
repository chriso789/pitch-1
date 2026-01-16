import React, { useState, useEffect } from 'react';
import { FileText, MapPin, CheckCircle2, AlertCircle, TrendingUp, Loader2, RefreshCw, BarChart3, Target } from 'lucide-react';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { BulkReportImporter } from '@/components/measurements/BulkReportImporter';

interface ReportStats {
  totalReports: number;
  uniqueReports: number;
  geocodedReports: number;
  trainingSessions: number;
  vendorVerifiedSessions: number;
  sessionsWithAiData: number;
  byProvider: Record<string, number>;
}

interface CorrectionFactor {
  feature_type: string;
  correction_multiplier: number;
  sample_count: number;
  confidence: number;
  avg_variance_pct: number;
  total_ai_ft: number;
  total_manual_ft: number;
}

interface VendorReport {
  id: string;
  provider: string;
  address: string | null;
  total_area_sqft: number | null;
  created_at: string;
  geocoded: boolean;
  has_training_session: boolean;
}

export default function ReportImportDashboard() {
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [corrections, setCorrections] = useState<CorrectionFactor[]>([]);
  const [recentReports, setRecentReports] = useState<VendorReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isHydrating, setIsHydrating] = useState(false);
  const { toast } = useToast();

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch vendor reports count by provider
      const { data: reports, error: reportsError } = await supabase
        .from('roof_vendor_reports')
        .select('id, provider, address, created_at, parsed, file_hash');

      if (reportsError) throw reportsError;

      // Fetch measurements truth for geocode status
      const { data: truthData } = await supabase
        .from('roof_measurements_truth')
        .select('report_id, latitude, longitude, total_area_sqft');

      // Fetch training sessions with ai_totals to check which have AI data
      const { data: sessions } = await supabase
        .from('roof_training_sessions')
        .select('id, ground_truth_source, vendor_report_id, ai_totals');

      const geocodedSet = new Set(
        truthData?.filter(t => t.latitude && t.longitude).map(t => t.report_id) || []
      );

      const vendorVerifiedSet = new Set(
        sessions?.filter(s => s.ground_truth_source === 'vendor_report').map(s => s.vendor_report_id) || []
      );

      // Count sessions with actual AI data (not empty objects)
      const sessionsWithAiData = sessions?.filter(s => {
        const ai = s.ai_totals as Record<string, number> | null;
        return ai && Object.keys(ai).length > 0 && 
          (ai.ridge > 0 || ai.hip > 0 || ai.valley > 0 || ai.eave > 0 || ai.rake > 0);
      }).length || 0;

      // Calculate unique reports by file_hash
      const uniqueHashes = new Set(reports?.filter(r => r.file_hash).map(r => r.file_hash));
      const uniqueReports = uniqueHashes.size || reports?.length || 0;

      // Calculate stats
      const byProvider: Record<string, number> = {};
      reports?.forEach(r => {
        byProvider[r.provider] = (byProvider[r.provider] || 0) + 1;
      });

      setStats({
        totalReports: reports?.length || 0,
        uniqueReports,
        geocodedReports: geocodedSet.size,
        trainingSessions: sessions?.length || 0,
        vendorVerifiedSessions: sessions?.filter(s => s.ground_truth_source === 'vendor_report').length || 0,
        sessionsWithAiData,
        byProvider,
      });

      // Build recent reports list
      const recentList: VendorReport[] = (reports || [])
        .slice(0, 50)
        .map(r => {
          const parsed = r.parsed as any;
          const truth = truthData?.find(t => t.report_id === r.id);
          return {
            id: r.id,
            provider: r.provider,
            address: r.address || parsed?.address,
            total_area_sqft: truth?.total_area_sqft || parsed?.total_area_sqft,
            created_at: r.created_at,
            geocoded: geocodedSet.has(r.id),
            has_training_session: vendorVerifiedSet.has(r.id),
          };
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setRecentReports(recentList);

      // Fetch correction factors
      const { data: correctionsData } = await supabase
        .from('measurement_correction_factors')
        .select('*')
        .order('feature_type');

      setCorrections(correctionsData || []);

    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      toast({
        title: 'Error',
        description: 'Failed to load dashboard data',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const recalculateCorrections = async () => {
    setIsCalculating(true);
    try {
      const { data, error } = await supabase.functions.invoke('calculate-measurement-corrections');
      
      if (error) throw error;

      toast({
        title: 'Corrections Calculated',
        description: `Analyzed ${data.sessions_analyzed} training sessions`,
      });

      // Refresh data
      await fetchData();
    } catch (err) {
      console.error('Error calculating corrections:', err);
      toast({
        title: 'Error',
        description: 'Failed to calculate corrections',
        variant: 'destructive',
      });
    } finally {
      setIsCalculating(false);
    }
  };

  const learnFromVendorReports = async () => {
    setIsCalculating(true);
    try {
      const { data, error } = await supabase.functions.invoke('measure', {
        body: { action: 'learn-from-vendor-reports' }
      });
      
      if (error) throw error;

      toast({
        title: 'Learning Complete',
        description: data.message || 'Vendor report corrections applied',
      });

      // Refresh data
      await fetchData();
    } catch (err) {
      console.error('Error learning from vendor reports:', err);
      toast({
        title: 'Error',
        description: 'Failed to learn from vendor reports',
        variant: 'destructive',
      });
    } finally {
      setIsCalculating(false);
    }
  };

  const hydrateVendorSessions = async () => {
    setIsHydrating(true);
    try {
      const { data, error } = await supabase.functions.invoke('measure', {
        body: { action: 'hydrate-vendor-sessions', limit: 10 }
      });
      
      if (error) throw error;

      toast({
        title: 'Hydration Complete',
        description: `${data.hydrated || 0} sessions hydrated with AI measurements`,
      });

      // Refresh data
      await fetchData();
    } catch (err) {
      console.error('Error hydrating sessions:', err);
      toast({
        title: 'Error',
        description: 'Failed to hydrate vendor sessions',
        variant: 'destructive',
      });
    } finally {
      setIsHydrating(false);
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-600';
    if (confidence >= 0.5) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.8) return 'High';
    if (confidence >= 0.5) return 'Medium';
    return 'Low';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <GlobalLayout>
      <div className="container mx-auto py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Report Import & Training Dashboard</h1>
            <p className="text-muted-foreground">
              Manage professional measurement reports and AI learning
            </p>
          </div>
          <div className="flex gap-2">
            <BulkReportImporter onComplete={() => fetchData()} />
            <Button variant="outline" onClick={fetchData}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Reports</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalReports || 0}</div>
              <p className="text-xs text-muted-foreground">
                Imported professional reports
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Geocoded</CardTitle>
              <MapPin className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.geocodedReports || 0}</div>
              <Progress 
                value={stats ? (stats.geocodedReports / Math.max(stats.totalReports, 1)) * 100 : 0} 
                className="mt-2"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Training Sessions</CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.trainingSessions || 0}</div>
              <p className="text-xs text-muted-foreground">
                {stats?.vendorVerifiedSessions || 0} from vendor reports
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Confidence Level</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {corrections.length > 0 
                  ? `${Math.round((corrections.reduce((sum, c) => sum + c.confidence, 0) / corrections.length) * 100)}%`
                  : '0%'
                }
              </div>
              <p className="text-xs text-muted-foreground">
                Average correction confidence
              </p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="corrections" className="space-y-4">
          <TabsList>
            <TabsTrigger value="corrections">Correction Factors</TabsTrigger>
            <TabsTrigger value="reports">Recent Reports</TabsTrigger>
            <TabsTrigger value="providers">By Provider</TabsTrigger>
          </TabsList>

          <TabsContent value="corrections" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>AI Correction Factors</CardTitle>
                    <CardDescription>
                      Multipliers learned from professional reports to calibrate AI measurements
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      onClick={learnFromVendorReports}
                      disabled={isCalculating}
                    >
                      {isCalculating ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <BarChart3 className="h-4 w-4 mr-2" />
                      )}
                      Learn from Vendor Reports
                    </Button>
                    <Button 
                      onClick={recalculateCorrections}
                      disabled={isCalculating}
                    >
                      {isCalculating ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      Recalculate All
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {corrections.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No correction factors calculated yet.</p>
                    <p className="text-sm">Import professional reports and click "Learn from Vendor Reports"</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Feature</TableHead>
                        <TableHead className="text-right">Multiplier</TableHead>
                        <TableHead className="text-right">Variance</TableHead>
                        <TableHead className="text-right">Samples</TableHead>
                        <TableHead className="text-right">AI Total (ft)</TableHead>
                        <TableHead className="text-right">Vendor Total (ft)</TableHead>
                        <TableHead>Confidence</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {corrections.map((c) => (
                        <TableRow key={c.feature_type}>
                          <TableCell className="font-medium capitalize">{c.feature_type}</TableCell>
                          <TableCell className="text-right font-mono">
                            {c.correction_multiplier.toFixed(4)}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={c.avg_variance_pct > 10 ? 'text-red-600' : c.avg_variance_pct > 5 ? 'text-yellow-600' : 'text-green-600'}>
                              {c.avg_variance_pct > 0 ? '+' : ''}{c.avg_variance_pct.toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell className="text-right">{c.sample_count}</TableCell>
                          <TableCell className="text-right">{Math.round(c.total_ai_ft).toLocaleString()}</TableCell>
                          <TableCell className="text-right">{Math.round(c.total_manual_ft).toLocaleString()}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={getConfidenceColor(c.confidence)}>
                              {getConfidenceLabel(c.confidence)} ({Math.round(c.confidence * 100)}%)
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Recommendations */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recommendations</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  {(stats?.vendorVerifiedSessions || 0) < 5 && (
                    <div className="flex items-center gap-2 p-2 bg-yellow-500/10 rounded">
                      <AlertCircle className="h-4 w-4 text-yellow-600" />
                      <span>Import at least 5 professional reports for basic correction factors</span>
                    </div>
                  )}
                  {(stats?.vendorVerifiedSessions || 0) >= 5 && (stats?.vendorVerifiedSessions || 0) < 10 && (
                    <div className="flex items-center gap-2 p-2 bg-blue-500/10 rounded">
                      <TrendingUp className="h-4 w-4 text-blue-600" />
                      <span>Good start! Import 10+ reports for high-confidence corrections</span>
                    </div>
                  )}
                  {(stats?.vendorVerifiedSessions || 0) >= 10 && (
                    <div className="flex items-center gap-2 p-2 bg-green-500/10 rounded">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span>Excellent! You have high-confidence correction factors</span>
                    </div>
                  )}
                  {corrections.some(c => c.confidence < 0.5) && (
                    <div className="flex items-center gap-2 p-2 bg-orange-500/10 rounded">
                      <AlertCircle className="h-4 w-4 text-orange-600" />
                      <span>Some features have low confidence - import more reports with these features</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reports">
            <Card>
              <CardHeader>
                <CardTitle>Recent Imported Reports</CardTitle>
                <CardDescription>
                  Last 50 imported professional measurement reports
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Provider</TableHead>
                        <TableHead>Address</TableHead>
                        <TableHead className="text-right">Area (sqft)</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Imported</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentReports.map((report) => (
                        <TableRow key={report.id}>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {report.provider}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[250px] truncate">
                            {report.address || 'No address'}
                          </TableCell>
                          <TableCell className="text-right">
                            {report.total_area_sqft?.toLocaleString() || '-'}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {report.geocoded && (
                                <Badge variant="outline" className="text-green-600">
                                  <MapPin className="h-3 w-3 mr-1" />
                                  Geocoded
                                </Badge>
                              )}
                              {report.has_training_session && (
                                <Badge variant="outline" className="text-blue-600">
                                  <Target className="h-3 w-3 mr-1" />
                                  Training
                                </Badge>
                              )}
                              {!report.geocoded && !report.has_training_session && (
                                <Badge variant="outline" className="text-muted-foreground">
                                  Pending
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {new Date(report.created_at).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="providers">
            <Card>
              <CardHeader>
                <CardTitle>Reports by Provider</CardTitle>
                <CardDescription>
                  Distribution of imported reports by measurement provider
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(stats?.byProvider || {})
                    .sort(([, a], [, b]) => b - a)
                    .map(([provider, count]) => (
                      <div key={provider} className="flex items-center gap-4">
                        <div className="w-32 font-medium capitalize">{provider}</div>
                        <Progress 
                          value={(count / Math.max(stats?.totalReports || 1, 1)) * 100} 
                          className="flex-1"
                        />
                        <div className="w-16 text-right text-muted-foreground">{count}</div>
                      </div>
                    ))
                  }
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </GlobalLayout>
  );
}
