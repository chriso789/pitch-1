import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, Shield, Eye, RefreshCw, CheckCircle2, XCircle, Camera, History } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Obstruction {
  type: string;
  confidence: number;
  description: string;
  area_sqft_estimated?: number;
  location?: string;
}

interface DetectionResult {
  obstructions_detected: boolean;
  obstructions: Obstruction[];
  measurement_impacted: boolean;
  recommended_action: string;
  analysis_summary: string;
}

interface TarpDetectionBadgeProps {
  imageUrl: string;
  lat?: number;
  lng?: number;
  measurementId?: string;
  pipelineEntryId?: string;
  existingAnalysis?: DetectionResult | null;
  onAnalysisComplete?: (result: DetectionResult) => void;
  compact?: boolean;
}

const obstructionTypeLabels: Record<string, string> = {
  blue_tarp: 'Blue Tarp',
  gray_tarp: 'Gray/Silver Tarp',
  debris: 'Debris',
  missing_shingles: 'Missing Shingles',
  tree_damage: 'Tree Damage',
  construction_materials: 'Construction Materials',
  standing_water: 'Standing Water',
  solar_panels: 'Solar Panels',
  skylights: 'Skylights',
  other: 'Other Obstruction'
};

const obstructionTypeColors: Record<string, string> = {
  blue_tarp: 'bg-blue-500',
  gray_tarp: 'bg-gray-500',
  debris: 'bg-amber-500',
  missing_shingles: 'bg-red-500',
  tree_damage: 'bg-green-600',
  construction_materials: 'bg-orange-500',
  standing_water: 'bg-cyan-500',
  solar_panels: 'bg-purple-500',
  skylights: 'bg-indigo-400',
  other: 'bg-gray-400'
};

export function TarpDetectionBadge({
  imageUrl,
  lat,
  lng,
  measurementId,
  pipelineEntryId,
  existingAnalysis,
  onAnalysisComplete,
  compact = false
}: TarpDetectionBadgeProps) {
  const { toast } = useToast();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<DetectionResult | null>(existingAnalysis || null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const runAnalysis = async () => {
    if (!imageUrl) {
      toast({
        title: 'No Image',
        description: 'No satellite image available for analysis',
        variant: 'destructive'
      });
      return;
    }

    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('detect-roof-obstruction', {
        body: {
          image_url: imageUrl,
          lat,
          lng,
          measurement_id: measurementId,
          pipeline_entry_id: pipelineEntryId
        }
      });

      if (error || !data?.ok) {
        throw new Error(error?.message || data?.error || 'Analysis failed');
      }

      setAnalysis(data.data);
      onAnalysisComplete?.(data.data);

      if (data.data.obstructions_detected) {
        toast({
          title: '⚠️ Obstructions Detected',
          description: data.data.analysis_summary,
          variant: 'destructive'
        });
      } else {
        toast({
          title: '✅ Roof Clear',
          description: 'No obstructions detected on the roof'
        });
      }
    } catch (error) {
      console.error('Tarp detection error:', error);
      toast({
        title: 'Analysis Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getRecommendationText = (action: string) => {
    switch (action) {
      case 'proceed':
        return 'Safe to proceed with measurement';
      case 'manual_verification_required':
        return 'Manual verification recommended';
      case 'request_current_photos':
        return 'Request current site photos';
      case 'wait_for_repairs':
        return 'Wait for repairs before measuring';
      default:
        return action;
    }
  };

  // Compact mode: just show a badge/button
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {analysis ? (
          <Badge 
            variant={analysis.obstructions_detected ? 'destructive' : 'default'}
            className="cursor-pointer"
            onClick={() => setDetailsOpen(true)}
          >
            {analysis.obstructions_detected ? (
              <>
                <AlertTriangle className="h-3 w-3 mr-1" />
                {analysis.obstructions.length} Obstruction{analysis.obstructions.length > 1 ? 's' : ''}
              </>
            ) : (
              <>
                <Shield className="h-3 w-3 mr-1" />
                Clear
              </>
            )}
          </Badge>
        ) : (
          <Button 
            variant="outline" 
            size="sm" 
            onClick={runAnalysis}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? (
              <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Eye className="h-3 w-3 mr-1" />
            )}
            Scan for Tarps
          </Button>
        )}

        {/* Details Dialog */}
        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {analysis?.obstructions_detected ? (
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                ) : (
                  <Shield className="h-5 w-5 text-green-500" />
                )}
                Obstruction Analysis
              </DialogTitle>
              <DialogDescription>
                AI-powered roof obstruction detection results
              </DialogDescription>
            </DialogHeader>
            
            {analysis && (
              <div className="space-y-4">
                <Alert variant={analysis.obstructions_detected ? 'destructive' : 'default'}>
                  <AlertTitle>
                    {analysis.obstructions_detected ? 'Obstructions Detected' : 'Roof Clear'}
                  </AlertTitle>
                  <AlertDescription>{analysis.analysis_summary}</AlertDescription>
                </Alert>

                {analysis.obstructions.length > 0 && (
                  <ScrollArea className="h-[200px]">
                    <div className="space-y-2">
                      {analysis.obstructions.map((obs, idx) => (
                        <Card key={idx}>
                          <CardHeader className="py-3">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-sm flex items-center gap-2">
                                <span className={`w-3 h-3 rounded-full ${obstructionTypeColors[obs.type] || 'bg-gray-400'}`} />
                                {obstructionTypeLabels[obs.type] || obs.type}
                              </CardTitle>
                              <Badge variant="outline">{obs.confidence}% confidence</Badge>
                            </div>
                          </CardHeader>
                          <CardContent className="py-2">
                            <p className="text-sm text-muted-foreground">{obs.description}</p>
                            {obs.location && (
                              <p className="text-xs text-muted-foreground mt-1">📍 {obs.location}</p>
                            )}
                            {obs.area_sqft_estimated && (
                              <p className="text-xs text-muted-foreground">~{obs.area_sqft_estimated} sq ft</p>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                )}

                <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
                  <span className="text-sm font-medium">Recommendation:</span>
                  <Badge variant="secondary">
                    {getRecommendationText(analysis.recommended_action)}
                  </Badge>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={runAnalysis} disabled={isAnalyzing}>
                    <RefreshCw className={`h-4 w-4 mr-1 ${isAnalyzing ? 'animate-spin' : ''}`} />
                    Re-analyze
                  </Button>
                  <Button variant="outline" size="sm">
                    <Camera className="h-4 w-4 mr-1" />
                    Request Photos
                  </Button>
                  <Button variant="outline" size="sm">
                    <History className="h-4 w-4 mr-1" />
                    Historical View
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Full mode: show analysis card
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Eye className="h-4 w-4" />
            AI Obstruction Detection
          </CardTitle>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={runAnalysis}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                Analyzing...
              </>
            ) : analysis ? (
              <>
                <RefreshCw className="h-3 w-3 mr-1" />
                Re-scan
              </>
            ) : (
              <>
                <Eye className="h-3 w-3 mr-1" />
                Scan Roof
              </>
            )}
          </Button>
        </div>
        <CardDescription>
          Detect tarps, debris, or damage using AI vision
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isAnalyzing && (
          <div className="space-y-2">
            <Progress value={undefined} className="animate-pulse" />
            <p className="text-xs text-center text-muted-foreground">
              Analyzing satellite image for obstructions...
            </p>
          </div>
        )}

        {!isAnalyzing && analysis && (
          <div className="space-y-3">
            <Alert variant={analysis.obstructions_detected ? 'destructive' : 'default'}>
              {analysis.obstructions_detected ? (
                <AlertTriangle className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              <AlertTitle>
                {analysis.obstructions_detected 
                  ? `${analysis.obstructions.length} Obstruction${analysis.obstructions.length > 1 ? 's' : ''} Found`
                  : 'Roof Clear'
                }
              </AlertTitle>
              <AlertDescription>{analysis.analysis_summary}</AlertDescription>
            </Alert>

            {analysis.obstructions.length > 0 && (
              <div className="space-y-2">
                {analysis.obstructions.map((obs, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 rounded-lg border">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${obstructionTypeColors[obs.type] || 'bg-gray-400'}`} />
                      <span className="text-sm">{obstructionTypeLabels[obs.type] || obs.type}</span>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {obs.confidence}%
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              Recommendation: {getRecommendationText(analysis.recommended_action)}
            </div>
          </div>
        )}

        {!isAnalyzing && !analysis && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Click "Scan Roof" to analyze for tarps, debris, or damage
          </p>
        )}
      </CardContent>
    </Card>
  );
}