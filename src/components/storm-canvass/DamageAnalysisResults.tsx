import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  DollarSign,
  FileText,
  Camera,
  Lightbulb,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface DamageType {
  type: string;
  confidence: number;
  severity: 'minor' | 'moderate' | 'severe';
  location?: { x: number; y: number; width: number; height: number };
  description: string;
  estimatedCost: { min: number; max: number };
}

interface DamageAnalysis {
  damageDetected: boolean;
  damageTypes: DamageType[];
  overallSeverity: 'minor' | 'moderate' | 'severe' | 'none';
  estimatedCostMin: number;
  estimatedCostMax: number;
  confidence: number;
  recommendations: string[];
  analysisNotes: string;
}

interface DamageAnalysisResultsProps {
  analysis: DamageAnalysis;
  imageUrl?: string;
  onGenerateReport?: () => void;
  onEditAnnotations?: () => void;
  className?: string;
}

const damageTypeLabels: Record<string, string> = {
  hail_damage: 'Hail Damage',
  wind_damage: 'Wind Damage',
  missing_shingles: 'Missing Shingles',
  granule_loss: 'Granule Loss',
  ridge_damage: 'Ridge Damage',
  flashing_damage: 'Flashing Damage',
  siding_crack: 'Siding Crack',
  siding_hole: 'Siding Hole',
  siding_warp: 'Siding Warp',
  gutter_dent: 'Gutter Dent',
  gutter_separation: 'Gutter Separation',
  water_damage: 'Water Damage',
  moss_algae: 'Moss/Algae',
  wear_aging: 'Wear & Aging',
  impact_damage: 'Impact Damage',
  other: 'Other Damage',
};

const severityConfig = {
  none: {
    label: 'No Damage',
    color: 'bg-green-500/10 text-green-600 border-green-500/20',
    icon: CheckCircle,
  },
  minor: {
    label: 'Minor',
    color: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
    icon: AlertTriangle,
  },
  moderate: {
    label: 'Moderate',
    color: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
    icon: AlertTriangle,
  },
  severe: {
    label: 'Severe',
    color: 'bg-red-500/10 text-red-600 border-red-500/20',
    icon: XCircle,
  },
};

export const DamageAnalysisResults: React.FC<DamageAnalysisResultsProps> = ({
  analysis,
  imageUrl,
  onGenerateReport,
  onEditAnnotations,
  className,
}) => {
  const severityInfo = severityConfig[analysis.overallSeverity];
  const SeverityIcon = severityInfo.icon;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">AI Damage Analysis</CardTitle>
          <Badge className={severityInfo.color}>
            <SeverityIcon className="h-3 w-3 mr-1" />
            {severityInfo.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Image with Damage Overlay */}
        {imageUrl && analysis.damageTypes.some(d => d.location) && (
          <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
            <img
              src={imageUrl}
              alt="Analyzed property"
              className="w-full h-full object-cover"
            />
            {/* Damage location overlays */}
            {analysis.damageTypes
              .filter(d => d.location)
              .map((damage, index) => (
                <div
                  key={index}
                  className={cn(
                    'absolute border-2 rounded',
                    damage.severity === 'severe'
                      ? 'border-red-500 bg-red-500/20'
                      : damage.severity === 'moderate'
                      ? 'border-orange-500 bg-orange-500/20'
                      : 'border-yellow-500 bg-yellow-500/20'
                  )}
                  style={{
                    left: `${damage.location!.x}%`,
                    top: `${damage.location!.y}%`,
                    width: `${damage.location!.width}%`,
                    height: `${damage.location!.height}%`,
                  }}
                >
                  <span className="absolute -top-5 left-0 text-xs bg-background/90 px-1 rounded">
                    {damageTypeLabels[damage.type] || damage.type}
                  </span>
                </div>
              ))}
          </div>
        )}

        {/* Confidence Score */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Analysis Confidence</span>
            <span className="font-medium">{analysis.confidence}%</span>
          </div>
          <Progress value={analysis.confidence} className="h-2" />
        </div>

        {/* Cost Estimate */}
        <div className="p-4 rounded-lg bg-muted/50">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="h-5 w-5 text-primary" />
            <span className="font-semibold">Estimated Repair Cost</span>
          </div>
          <div className="text-2xl font-bold text-primary">
            {formatCurrency(analysis.estimatedCostMin)} - {formatCurrency(analysis.estimatedCostMax)}
          </div>
        </div>

        {/* Damage Types */}
        {analysis.damageTypes.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="font-medium text-sm">Detected Damage ({analysis.damageTypes.length})</h4>
              <ScrollArea className="h-[180px]">
                <div className="space-y-2">
                  {analysis.damageTypes.map((damage, index) => (
                    <div
                      key={index}
                      className="p-3 rounded-lg border bg-card"
                    >
                      <div className="flex items-start justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={severityConfig[damage.severity].color}
                          >
                            {damage.severity}
                          </Badge>
                          <span className="font-medium text-sm">
                            {damageTypeLabels[damage.type] || damage.type}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {damage.confidence}% confident
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">
                        {damage.description}
                      </p>
                      <div className="text-sm font-medium text-primary">
                        {formatCurrency(damage.estimatedCost.min)} - {formatCurrency(damage.estimatedCost.max)}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </>
        )}

        {/* Recommendations */}
        {analysis.recommendations.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-yellow-500" />
                <h4 className="font-medium text-sm">Recommendations</h4>
              </div>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {analysis.recommendations.map((rec, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        {/* Analysis Notes */}
        {analysis.analysisNotes && (
          <div className="p-3 rounded-lg bg-muted/30 text-sm text-muted-foreground">
            <p>{analysis.analysisNotes}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          {onGenerateReport && (
            <Button onClick={onGenerateReport} className="flex-1">
              <FileText className="h-4 w-4 mr-2" />
              Generate Report
            </Button>
          )}
          {onEditAnnotations && (
            <Button variant="outline" onClick={onEditAnnotations}>
              <Camera className="h-4 w-4 mr-2" />
              Edit Annotations
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
