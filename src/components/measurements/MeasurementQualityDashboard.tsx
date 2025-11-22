import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useMeasurementHealthMetrics } from "@/hooks/useMeasurementHealthMetrics";
import { LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Download, RefreshCw, AlertTriangle, CheckCircle2, TrendingUp, Eye, Zap, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";

export function MeasurementQualityDashboard() {
  const navigate = useNavigate();
  const [isAutoFixing, setIsAutoFixing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [coordinateSyncHealth, setCoordinateSyncHealth] = useState<{ total: number; synced: number } | null>(null);
  
  const {
    metrics,
    accuracyTrend,
    qualityDistribution,
    problemMeasurements,
    isLoading,
    refetchMetrics,
    refetchProblems,
    exportMetrics,
  } = useMeasurementHealthMetrics();

  // Load coordinate sync health on mount
  useEffect(() => {
    loadCoordinateSyncHealth();
  }, []);

  const loadCoordinateSyncHealth = async () => {
    try {
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select(`
          id,
          metadata,
          contacts!inner(verified_address, latitude, longitude)
        `);

      if (error) throw error;

      let total = 0;
      let synced = 0;

      for (const entry of data || []) {
        const contact = (entry as any)?.contacts;
        if (!contact?.verified_address?.lat || !contact?.verified_address?.lng) continue;

        total++;

        const metadata = entry.metadata as any;
        const currentLat = metadata?.verified_address?.geometry?.location?.lat || metadata?.verified_address?.lat;
        const currentLng = metadata?.verified_address?.geometry?.location?.lng || metadata?.verified_address?.lng;

        if (currentLat && currentLng) {
          const latDiff = Math.abs(contact.verified_address.lat - currentLat);
          const lngDiff = Math.abs(contact.verified_address.lng - currentLng);
          const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111000;

          if (distance < 10) {
            synced++;
          }
        }
      }

      setCoordinateSyncHealth({ total, synced });
    } catch (error: any) {
      console.error('Failed to load coordinate sync health:', error);
    }
  };

  const handleSyncAllCoordinates = async () => {
    setIsSyncing(true);
    const toastId = 'coordinate-sync';
    
    toast.loading('Syncing all mismatched coordinates...', { id: toastId, duration: Infinity });

    try {
      const { data, error } = await supabase.functions.invoke('sync-verified-coordinates', {
        body: { batchMode: true }
      });

      if (error) throw error;

      toast.success(
        `Successfully synced ${data.syncedCount} coordinates${data.errorCount > 0 ? `, ${data.errorCount} errors` : ''}`,
        { id: toastId }
      );

      // Refresh health metrics
      await loadCoordinateSyncHealth();
      refetchMetrics();
    } catch (error: any) {
      toast.error(`Failed to sync coordinates: ${error.message}`, { id: toastId });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRegenerateMeasurement = async (measurementId: string, propertyId: string) => {
    try {
      toast.loading("Regenerating measurement...", { id: measurementId });

      const { data, error } = await supabase.functions.invoke('generate-measurement-visualization', {
        body: { measurementId, propertyId }
      });

      if (error) throw error;

      toast.success("Measurement regenerated successfully", { id: measurementId });
      refetchProblems();
      refetchMetrics();
    } catch (error: any) {
      toast.error(`Failed to regenerate: ${error.message}`, { id: measurementId });
    }
  };

  const handleAutoFixAllProblems = async () => {
    if (!problemMeasurements) return;

    // Filter for critical measurements with >50m coordinate mismatch
    const criticalMeasurements = problemMeasurements.filter(
      m => m.coordinate_mismatch_distance > 50
    );

    if (criticalMeasurements.length === 0) {
      toast.info("No critical problems to fix (all offsets are under 50m)");
      return;
    }

    setIsAutoFixing(true);
    const toastId = `auto-fix-${Date.now()}`;
    
    toast.loading(`Auto-fixing ${criticalMeasurements.length} critical measurements...`, { 
      id: toastId,
      duration: Infinity 
    });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < criticalMeasurements.length; i++) {
      const measurement = criticalMeasurements[i];
      
      try {
        const { error } = await supabase.functions.invoke('generate-measurement-visualization', {
          body: { 
            measurementId: measurement.id, 
            propertyId: measurement.property_id 
          }
        });

        if (error) throw error;
        successCount++;
        
        toast.loading(
          `Processing ${i + 1}/${criticalMeasurements.length} (${successCount} fixed)`, 
          { id: toastId }
        );
      } catch (error: any) {
        failCount++;
        console.error(`Failed to regenerate ${measurement.id}:`, error);
      }

      // Small delay to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    setIsAutoFixing(false);
    
    if (failCount === 0) {
      toast.success(`Successfully fixed all ${successCount} critical measurements!`, { id: toastId });
    } else {
      toast.warning(`Fixed ${successCount} measurements, ${failCount} failed`, { id: toastId });
    }

    // Refresh dashboard data
    refetchProblems();
    refetchMetrics();
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-5">
          {[1, 2, 3, 4, 5].map(i => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Measurement Quality Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Real-time monitoring of measurement system health and coordinate accuracy
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={handleAutoFixAllProblems}
            disabled={isAutoFixing || !problemMeasurements || problemMeasurements.filter(m => m.coordinate_mismatch_distance > 50).length === 0}
          >
            <Zap className="h-4 w-4 mr-2" />
            {isAutoFixing ? 'Fixing...' : 'Auto-Fix All Problems'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchMetrics();
              refetchProblems();
              toast.success("Dashboard refreshed");
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportMetrics('csv')}
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportMetrics('json')}
          >
            <Download className="h-4 w-4 mr-2" />
            Export JSON
          </Button>
        </div>
      </div>

      {/* Quality Metrics Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Measurements</p>
              <h3 className="text-2xl font-bold mt-2">{metrics?.totalMeasurements || 0}</h3>
            </div>
            <Eye className="h-8 w-8 text-muted-foreground" />
          </div>
        </Card>
        
        <Card className="p-6">
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Coordinate Sync</p>
              <RotateCcw className="h-8 w-8 text-muted-foreground" />
            </div>
            {coordinateSyncHealth ? (
              <>
                <h3 className="text-2xl font-bold">
                  {coordinateSyncHealth.synced} / {coordinateSyncHealth.total}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {Math.round((coordinateSyncHealth.synced / coordinateSyncHealth.total) * 100)}% in sync
                </p>
                {coordinateSyncHealth.synced < coordinateSyncHealth.total && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={handleSyncAllCoordinates}
                    disabled={isSyncing}
                  >
                    {isSyncing ? 'Syncing...' : 'Sync All'}
                  </Button>
                )}
              </>
            ) : (
              <Skeleton className="h-8 w-24 mt-2" />
            )}
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Avg Accuracy</p>
              <div className="flex items-baseline gap-2 mt-2">
                <h3 className="text-2xl font-bold">
                  {metrics?.avgCoordinateAccuracy?.toFixed(1) || 0}m
                </h3>
                {metrics && metrics.avgCoordinateAccuracy < 30 && (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                )}
                {metrics && metrics.avgCoordinateAccuracy >= 30 && (
                  <AlertTriangle className="h-5 w-5 text-orange-500" />
                )}
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Visual Success</p>
              <h3 className="text-2xl font-bold mt-2">
                {metrics?.visualizationSuccessRate?.toFixed(1) || 0}%
              </h3>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Manual Regen</p>
              <h3 className="text-2xl font-bold mt-2">{metrics?.manualRegenerationCount || 0}</h3>
            </div>
          </div>
        </Card>
      </div>

      {/* Charts Section */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Accuracy Trend Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Coordinate Accuracy Trend
            </CardTitle>
            <CardDescription>Daily average coordinate offset over 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={accuracyTrend || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="date" 
                  stroke="hsl(var(--muted-foreground))"
                  style={{ fontSize: '12px' }}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))"
                  style={{ fontSize: '12px' }}
                  label={{ value: 'Offset (m)', angle: -90, position: 'insideLeft' }}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--background))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }}
                  formatter={(value: number) => [`${value.toFixed(2)}m`, 'Avg Offset']}
                />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="avgOffset" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  name="Avg Offset"
                  dot={{ fill: 'hsl(var(--primary))' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Quality Distribution Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Quality Distribution</CardTitle>
            <CardDescription>Breakdown by coordinate accuracy tier</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={qualityDistribution || []}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => `${entry.name}: ${entry.value}`}
                  outerRadius={80}
                  fill="hsl(var(--primary))"
                  dataKey="value"
                >
                  {qualityDistribution?.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--background))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Problem Measurements Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Recent Problem Measurements
          </CardTitle>
          <CardDescription>
            Measurements with coordinate offset greater than 30 meters
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            <div className="space-y-2">
              {problemMeasurements && problemMeasurements.length > 0 ? (
                problemMeasurements.map((measurement) => (
                  <div
                    key={measurement.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex-1">
                      <div className="font-medium">{measurement.address}</div>
                      <div className="text-sm text-muted-foreground">{measurement.city}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge 
                          variant={measurement.coordinate_mismatch_distance > 50 ? "destructive" : "secondary"}
                        >
                          {measurement.coordinate_mismatch_distance.toFixed(1)}m offset
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(measurement.created_at), 'MMM d, yyyy')}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/lead/${measurement.property_id}`)}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        View
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleRegenerateMeasurement(measurement.id, measurement.property_id)}
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Regenerate
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-green-500" />
                  <p>No problem measurements found!</p>
                  <p className="text-sm">All measurements have acceptable coordinate accuracy.</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
