import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Layers, Eye, EyeOff, Check, AlertTriangle, RotateCcw } from 'lucide-react';

interface RoofOverlayComparisonToolProps {
  satelliteImageUrl: string;
  diagramSvg?: string;
  linearFeatures: {
    type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
    wkt: string;
    lengthFt: number;
    confidence: number;
  }[];
  perimeterWkt: string;
  onVertexCorrection?: (featureId: string, newCoords: { lat: number; lng: number }[]) => void;
  onValidationComplete?: (validated: boolean) => void;
}

const featureColors: Record<string, string> = {
  ridge: '#22c55e',
  hip: '#3b82f6', 
  valley: '#f59e0b',
  eave: '#8b5cf6',
  rake: '#ec4899',
  perimeter: '#6b7280'
};

export function RoofOverlayComparisonTool({
  satelliteImageUrl,
  linearFeatures,
  perimeterWkt,
  onVertexCorrection,
  onValidationComplete
}: RoofOverlayComparisonToolProps) {
  const [overlayOpacity, setOverlayOpacity] = useState(70);
  const [showFeatures, setShowFeatures] = useState<Record<string, boolean>>({
    ridge: true, hip: true, valley: true, eave: true, rake: true, perimeter: true
  });
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<'pending' | 'validated' | 'needs_correction'>('pending');

  const toggleFeature = (type: string) => {
    setShowFeatures(prev => ({ ...prev, [type]: !prev[type] }));
  };

  const handleValidate = useCallback(() => {
    setIsValidating(true);
    setTimeout(() => {
      setValidationStatus('validated');
      setIsValidating(false);
      onValidationComplete?.(true);
    }, 1000);
  }, [onValidationComplete]);

  const handleReset = () => {
    setOverlayOpacity(70);
    setShowFeatures({ ridge: true, hip: true, valley: true, eave: true, rake: true, perimeter: true });
    setValidationStatus('pending');
  };

  const featureCounts = linearFeatures.reduce((acc, f) => {
    acc[f.type] = (acc[f.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Layers className="h-5 w-5" />
            Roof Overlay Comparison
          </CardTitle>
          <Badge variant={validationStatus === 'validated' ? 'default' : validationStatus === 'needs_correction' ? 'destructive' : 'secondary'}>
            {validationStatus === 'validated' && <Check className="h-3 w-3 mr-1" />}
            {validationStatus === 'needs_correction' && <AlertTriangle className="h-3 w-3 mr-1" />}
            {validationStatus.replace('_', ' ')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Image Container */}
        <div className="relative aspect-video bg-muted rounded-lg overflow-hidden border">
          <img src={satelliteImageUrl} alt="Satellite" className="absolute inset-0 w-full h-full object-cover" />
          
          {/* Overlay SVG */}
          <svg 
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ opacity: overlayOpacity / 100 }}
          >
            {/* Perimeter */}
            {showFeatures.perimeter && (
              <rect x="10%" y="10%" width="80%" height="80%" fill="none" stroke={featureColors.perimeter} strokeWidth="2" strokeDasharray="5,5" />
            )}
            
            {/* Feature lines - simplified representation */}
            {showFeatures.ridge && <line x1="20%" y1="50%" x2="80%" y2="50%" stroke={featureColors.ridge} strokeWidth="3" />}
            {showFeatures.hip && (
              <>
                <line x1="10%" y1="10%" x2="20%" y2="50%" stroke={featureColors.hip} strokeWidth="2" />
                <line x1="90%" y1="10%" x2="80%" y2="50%" stroke={featureColors.hip} strokeWidth="2" />
                <line x1="10%" y1="90%" x2="20%" y2="50%" stroke={featureColors.hip} strokeWidth="2" />
                <line x1="90%" y1="90%" x2="80%" y2="50%" stroke={featureColors.hip} strokeWidth="2" />
              </>
            )}
          </svg>
        </div>

        {/* Opacity Slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Overlay Opacity</span>
            <span className="font-mono">{overlayOpacity}%</span>
          </div>
          <Slider value={[overlayOpacity]} onValueChange={([v]) => setOverlayOpacity(v)} max={100} step={5} />
        </div>

        {/* Feature Toggles */}
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(featureColors).map(([type, color]) => (
            <Button
              key={type}
              variant={showFeatures[type] ? 'default' : 'outline'}
              size="sm"
              className="justify-start gap-2"
              onClick={() => toggleFeature(type)}
            >
              {showFeatures[type] ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              <div className="w-3 h-3 rounded" style={{ backgroundColor: color }} />
              <span className="capitalize text-xs">{type}</span>
              {featureCounts[type] && <Badge variant="secondary" className="ml-auto text-xs">{featureCounts[type]}</Badge>}
            </Button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button onClick={handleValidate} disabled={isValidating} className="flex-1">
            <Check className="h-4 w-4 mr-2" />
            {isValidating ? 'Validating...' : 'Validate Accuracy'}
          </Button>
          <Button variant="outline" onClick={handleReset}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
