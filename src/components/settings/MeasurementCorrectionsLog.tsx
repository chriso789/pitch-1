import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { RefreshCw, Download, Ruler, AlertCircle, CheckCircle, TrendingUp } from "lucide-react";

interface MeasurementCorrection {
  id: string;
  measurement_id: string | null;
  facet_id: string | null;
  field_name: string;
  original_value: number | string | null;
  corrected_value: number | string | null;
  correction_reason: string | null;
  correction_notes: string | null;
  correction_type: string | null;
  correction_method: string | null;
  corrected_by: string | null;
  verified_by: string | null;
  verified_at: string | null;
  tags: string[] | null;
  created_at: string;
}

export const MeasurementCorrectionsLog = () => {
  const [fieldFilter, setFieldFilter] = useState<string>("all");

  const { data: corrections, isLoading, refetch } = useQuery({
    queryKey: ['measurement-corrections', fieldFilter],
    queryFn: async () => {
      let query = supabase
        .from('roof_measurement_corrections')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (fieldFilter && fieldFilter !== 'all') {
        query = query.eq('field_name', fieldFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as MeasurementCorrection[];
    },
  });

  // Calculate accuracy improvement stats
  const stats = corrections?.reduce((acc, c) => {
    const origVal = typeof c.original_value === 'number' ? c.original_value : parseFloat(String(c.original_value)) || 0;
    const corrVal = typeof c.corrected_value === 'number' ? c.corrected_value : parseFloat(String(c.corrected_value)) || 0;
    const diff = Math.abs(corrVal - origVal);
    const percentChange = origVal > 0 ? (diff / origVal) * 100 : 0;
    acc.totalCorrections++;
    acc.avgPercentChange += percentChange;
    if (!acc.byField[c.field_name]) {
      acc.byField[c.field_name] = { count: 0, totalDiff: 0 };
    }
    acc.byField[c.field_name].count++;
    acc.byField[c.field_name].totalDiff += diff;
    return acc;
  }, { totalCorrections: 0, avgPercentChange: 0, byField: {} as Record<string, { count: number; totalDiff: number }> });

  if (stats && stats.totalCorrections > 0) {
    stats.avgPercentChange /= stats.totalCorrections;
  }

  const exportToCSV = () => {
    if (!corrections?.length) return;
    
    const headers = ['Timestamp', 'Field', 'Original Value', 'Corrected Value', 'Change %', 'Reason', 'Notes', 'Method'];
    const rows = corrections.map(c => {
      const origVal = typeof c.original_value === 'number' ? c.original_value : parseFloat(String(c.original_value)) || 0;
      const corrVal = typeof c.corrected_value === 'number' ? c.corrected_value : parseFloat(String(c.corrected_value)) || 0;
      const percentChange = origVal > 0 
        ? (((corrVal - origVal) / origVal) * 100).toFixed(2)
        : 'N/A';
      return [
        format(new Date(c.created_at), 'yyyy-MM-dd HH:mm:ss'),
        c.field_name,
        String(c.original_value),
        String(c.corrected_value),
        percentChange,
        c.correction_reason || '',
        c.correction_notes || '',
        c.correction_method || ''
      ];
    });
    
    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `measurement-corrections-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getFieldIcon = (fieldName: string) => {
    if (fieldName.includes('area') || fieldName.includes('sqft')) {
      return <Ruler className="h-4 w-4 text-blue-500" />;
    }
    if (fieldName.includes('pitch')) {
      return <TrendingUp className="h-4 w-4 text-amber-500" />;
    }
    return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Corrections</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalCorrections || 0}</div>
            <p className="text-xs text-muted-foreground">Manual adjustments made</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Avg Change</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(stats?.avgPercentChange || 0).toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">Average correction magnitude</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Most Corrected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">
              {stats?.byField && Object.keys(stats.byField).length > 0
                ? Object.entries(stats.byField).sort((a, b) => b[1].count - a[1].count)[0]?.[0]?.replace(/_/g, ' ') || 'N/A'
                : 'N/A'}
            </div>
            <p className="text-xs text-muted-foreground">Field requiring most adjustments</p>
          </CardContent>
        </Card>
      </div>

      {/* Corrections Log */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Ruler className="h-5 w-5" />
                AI Measurement Corrections
              </CardTitle>
              <CardDescription>
                Track all manual corrections to AI-generated measurements
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={exportToCSV}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter */}
          <Select value={fieldFilter} onValueChange={setFieldFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by field" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Fields</SelectItem>
              <SelectItem value="total_area">Total Area</SelectItem>
              <SelectItem value="roof_area">Roof Area</SelectItem>
              <SelectItem value="pitch">Pitch</SelectItem>
              <SelectItem value="ridge_length">Ridge Length</SelectItem>
              <SelectItem value="valley_length">Valley Length</SelectItem>
              <SelectItem value="eave_length">Eave Length</SelectItem>
            </SelectContent>
          </Select>

          {/* Corrections List */}
          <ScrollArea className="h-[400px]">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : corrections?.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-3" />
                <p className="text-muted-foreground">No corrections recorded yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Corrections are logged when you manually adjust AI measurements
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {corrections?.map((correction) => {
                  const origVal = typeof correction.original_value === 'number' ? correction.original_value : parseFloat(String(correction.original_value)) || 0;
                  const corrVal = typeof correction.corrected_value === 'number' ? correction.corrected_value : parseFloat(String(correction.corrected_value)) || 0;
                  const percentChange = origVal > 0
                    ? (((corrVal - origVal) / origVal) * 100)
                    : 0;
                  const isIncrease = corrVal > origVal;
                  
                  return (
                    <div
                      key={correction.id}
                      className="p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        {getFieldIcon(correction.field_name)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-medium text-sm capitalize">
                              {correction.field_name.replace(/_/g, ' ')}
                            </span>
                            <Badge 
                              variant={isIncrease ? 'default' : 'secondary'}
                              className="text-xs"
                            >
                              {isIncrease ? '+' : ''}{percentChange.toFixed(1)}%
                            </Badge>
                            {correction.correction_type && (
                              <Badge variant="outline" className="text-xs">
                                {correction.correction_type}
                              </Badge>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-4 text-sm">
                            <div>
                              <span className="text-muted-foreground">AI Value: </span>
                              <span className="line-through text-destructive">{String(correction.original_value)}</span>
                            </div>
                            <span>→</span>
                            <div>
                              <span className="text-muted-foreground">Corrected: </span>
                              <span className="text-green-600 font-medium">{String(correction.corrected_value)}</span>
                            </div>
                          </div>
                          
                          {(correction.correction_reason || correction.correction_notes) && (
                            <div className="mt-2 text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                              {correction.correction_reason && (
                                <div><strong>Reason:</strong> {correction.correction_reason}</div>
                              )}
                              {correction.correction_notes && (
                                <div><strong>Notes:</strong> {correction.correction_notes}</div>
                              )}
                            </div>
                          )}
                          
                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                            <span>{format(new Date(correction.created_at), 'MMM d, yyyy h:mm a')}</span>
                            {correction.correction_method && (
                              <span>Method: {correction.correction_method}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};
