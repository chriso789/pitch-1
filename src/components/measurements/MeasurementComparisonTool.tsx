import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowRight, ArrowUp, ArrowDown, Minus, Clock, Layers, BarChart3, GitCompare } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { ComparisonOverlay } from './ComparisonOverlay';

interface MeasurementRecord {
  id: string;
  created_at: string;
  summary?: {
    total_area_sqft?: number;
    plan_area_sqft?: number;
    roof_area_sqft?: number;
    ridge_ft?: number;
    hip_ft?: number;
    valley_ft?: number;
    eave_ft?: number;
    rake_ft?: number;
    perimeter_ft?: number;
  };
  perimeter_wkt?: string;
  predominant_pitch?: string;
  confidence_score?: number;
  selected_image_source?: string;
  quality_assessment?: {
    shadow_risk?: string;
    image_quality_score?: number;
  };
}

interface MeasurementComparisonToolProps {
  measurements: MeasurementRecord[];
  satelliteImageUrl?: string;
  centerLat: number;
  centerLng: number;
  address?: string;
}

interface ComparisonMetric {
  label: string;
  key: string;
  unit: string;
  getValue: (m: MeasurementRecord) => number | undefined;
}

const COMPARISON_METRICS: ComparisonMetric[] = [
  { label: 'Total Area', key: 'total_area', unit: 'sqft', getValue: (m) => m.summary?.total_area_sqft },
  { label: 'Roof Area', key: 'roof_area', unit: 'sqft', getValue: (m) => m.summary?.roof_area_sqft },
  { label: 'Plan Area', key: 'plan_area', unit: 'sqft', getValue: (m) => m.summary?.plan_area_sqft },
  { label: 'Perimeter', key: 'perimeter', unit: 'ft', getValue: (m) => m.summary?.perimeter_ft },
  { label: 'Ridge', key: 'ridge', unit: 'ft', getValue: (m) => m.summary?.ridge_ft },
  { label: 'Hip', key: 'hip', unit: 'ft', getValue: (m) => m.summary?.hip_ft },
  { label: 'Valley', key: 'valley', unit: 'ft', getValue: (m) => m.summary?.valley_ft },
  { label: 'Eave', key: 'eave', unit: 'ft', getValue: (m) => m.summary?.eave_ft },
  { label: 'Rake', key: 'rake', unit: 'ft', getValue: (m) => m.summary?.rake_ft },
];

export function MeasurementComparisonTool({
  measurements,
  satelliteImageUrl,
  centerLat,
  centerLng,
  address
}: MeasurementComparisonToolProps) {
  const [beforeId, setBeforeId] = useState<string>(measurements[1]?.id || '');
  const [afterId, setAfterId] = useState<string>(measurements[0]?.id || '');
  const [showOverlay, setShowOverlay] = useState(true);
  const [activeTab, setActiveTab] = useState<'metrics' | 'timeline' | 'overlay'>('metrics');

  const sortedMeasurements = useMemo(() => 
    [...measurements].sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ), [measurements]
  );

  const beforeMeasurement = useMemo(() => 
    sortedMeasurements.find(m => m.id === beforeId), [sortedMeasurements, beforeId]
  );
  
  const afterMeasurement = useMemo(() => 
    sortedMeasurements.find(m => m.id === afterId), [sortedMeasurements, afterId]
  );

  const getVariance = (before: number | undefined, after: number | undefined) => {
    if (!before || !after || before === 0) return null;
    return ((after - before) / before) * 100;
  };

  const getVarianceClass = (variance: number | null) => {
    if (variance === null) return 'text-muted-foreground';
    if (Math.abs(variance) < 3) return 'text-muted-foreground';
    if (Math.abs(variance) < 10) return 'text-amber-600';
    return 'text-destructive';
  };

  const getVarianceIcon = (variance: number | null) => {
    if (variance === null) return <Minus className="h-3 w-3" />;
    if (Math.abs(variance) < 0.5) return <Minus className="h-3 w-3" />;
    if (variance > 0) return <ArrowUp className="h-3 w-3" />;
    return <ArrowDown className="h-3 w-3" />;
  };

  if (measurements.length < 2) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <GitCompare className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>At least 2 measurements are needed for comparison</p>
          <p className="text-sm mt-2">Run another measurement to enable comparison</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <GitCompare className="h-4 w-4" />
          Measurement Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Selector Row */}
        <div className="grid grid-cols-[1fr,auto,1fr] gap-3 items-center">
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Before</Label>
            <Select value={beforeId} onValueChange={setBeforeId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select measurement" />
              </SelectTrigger>
              <SelectContent>
                {sortedMeasurements.map(m => (
                  <SelectItem key={m.id} value={m.id} disabled={m.id === afterId}>
                    {format(new Date(m.created_at), 'MMM d, yyyy h:mm a')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <ArrowRight className="h-5 w-5 text-muted-foreground mt-5" />
          
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">After</Label>
            <Select value={afterId} onValueChange={setAfterId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select measurement" />
              </SelectTrigger>
              <SelectContent>
                {sortedMeasurements.map(m => (
                  <SelectItem key={m.id} value={m.id} disabled={m.id === beforeId}>
                    {format(new Date(m.created_at), 'MMM d, yyyy h:mm a')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="metrics" className="text-xs gap-1">
              <BarChart3 className="h-3 w-3" />
              Metrics
            </TabsTrigger>
            <TabsTrigger value="overlay" className="text-xs gap-1">
              <Layers className="h-3 w-3" />
              Overlay
            </TabsTrigger>
            <TabsTrigger value="timeline" className="text-xs gap-1">
              <Clock className="h-3 w-3" />
              Timeline
            </TabsTrigger>
          </TabsList>

          {/* Metrics Comparison Tab */}
          <TabsContent value="metrics" className="mt-3">
            {beforeMeasurement && afterMeasurement && (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Metric</th>
                      <th className="text-right px-3 py-2 font-medium">Before</th>
                      <th className="text-right px-3 py-2 font-medium">After</th>
                      <th className="text-right px-3 py-2 font-medium">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARISON_METRICS.map(metric => {
                      const beforeVal = metric.getValue(beforeMeasurement);
                      const afterVal = metric.getValue(afterMeasurement);
                      const variance = getVariance(beforeVal, afterVal);
                      
                      // Skip rows where both values are missing
                      if (!beforeVal && !afterVal) return null;
                      
                      return (
                        <tr key={metric.key} className="border-t">
                          <td className="px-3 py-2 font-medium">{metric.label}</td>
                          <td className="text-right px-3 py-2 tabular-nums text-muted-foreground">
                            {beforeVal ? `${beforeVal.toLocaleString()} ${metric.unit}` : '—'}
                          </td>
                          <td className="text-right px-3 py-2 tabular-nums">
                            {afterVal ? `${afterVal.toLocaleString()} ${metric.unit}` : '—'}
                          </td>
                          <td className={cn('text-right px-3 py-2 tabular-nums', getVarianceClass(variance))}>
                            <span className="inline-flex items-center gap-1">
                              {getVarianceIcon(variance)}
                              {variance !== null ? `${variance > 0 ? '+' : ''}${variance.toFixed(1)}%` : '—'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            
            {/* Summary badges */}
            {beforeMeasurement && afterMeasurement && (
              <div className="flex flex-wrap gap-2 mt-3">
                {beforeMeasurement.predominant_pitch && (
                  <Badge variant="secondary" className="text-xs">
                    Before Pitch: {beforeMeasurement.predominant_pitch}
                  </Badge>
                )}
                {afterMeasurement.predominant_pitch && (
                  <Badge variant="secondary" className="text-xs">
                    After Pitch: {afterMeasurement.predominant_pitch}
                  </Badge>
                )}
                {beforeMeasurement.confidence_score && (
                  <Badge variant="outline" className="text-xs">
                    Before Confidence: {beforeMeasurement.confidence_score}%
                  </Badge>
                )}
                {afterMeasurement.confidence_score && (
                  <Badge variant="outline" className="text-xs">
                    After Confidence: {afterMeasurement.confidence_score}%
                  </Badge>
                )}
              </div>
            )}
          </TabsContent>

          {/* Visual Overlay Tab */}
          <TabsContent value="overlay" className="mt-3">
            {satelliteImageUrl && beforeMeasurement && afterMeasurement ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Switch
                    id="show-overlay"
                    checked={showOverlay}
                    onCheckedChange={setShowOverlay}
                  />
                  <Label htmlFor="show-overlay" className="text-sm">
                    Show both outlines overlaid
                  </Label>
                </div>
                
                <ComparisonOverlay
                  beforeWkt={beforeMeasurement.perimeter_wkt}
                  afterWkt={afterMeasurement.perimeter_wkt}
                  satelliteImageUrl={satelliteImageUrl}
                  centerLat={centerLat}
                  centerLng={centerLng}
                  showOverlay={showOverlay}
                />
                
                <div className="flex gap-4 text-xs text-muted-foreground justify-center">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-0.5 bg-red-500"></span>
                    Before
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-0.5 bg-green-500"></span>
                    After
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground text-sm">
                Satellite imagery or perimeter data not available for overlay
              </div>
            )}
          </TabsContent>

          {/* Timeline Tab */}
          <TabsContent value="timeline" className="mt-3">
            <ScrollArea className="h-[200px]">
              <div className="space-y-2">
                {sortedMeasurements.map((m, index) => (
                  <div 
                    key={m.id}
                    className={cn(
                      'flex items-center gap-3 p-2 rounded-lg border',
                      m.id === beforeId && 'border-red-500/50 bg-red-500/5',
                      m.id === afterId && 'border-green-500/50 bg-green-500/5'
                    )}
                  >
                    <div className="flex-shrink-0 w-2 h-2 rounded-full bg-primary" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {format(new Date(m.created_at), 'MMM d, yyyy h:mm a')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {m.summary?.total_area_sqft?.toLocaleString() || '—'} sqft
                        {m.selected_image_source && ` • ${m.selected_image_source}`}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {m.id === beforeId && (
                        <Badge variant="outline" className="text-xs bg-red-500/10 text-red-600">Before</Badge>
                      )}
                      {m.id === afterId && (
                        <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600">After</Badge>
                      )}
                      {index === 0 && (
                        <Badge variant="secondary" className="text-xs">Latest</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
