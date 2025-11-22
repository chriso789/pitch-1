import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Split, 
  GitBranch, 
  Scissors,
  Target,
  Sparkles,
  Info
} from 'lucide-react';
import { detectRoofPattern, detectSymmetricalSplits } from '@/utils/roofPatternDetection';
import type { SplitLine } from '@/utils/polygonSplitting';
import { toast } from 'sonner';

interface FacetSplittingToolsProps {
  buildingPolygon: [number, number][];
  linearFeatures?: any;
  onApplySplit: (splitLine: SplitLine) => void;
  disabled?: boolean;
}

export function FacetSplittingTools({
  buildingPolygon,
  linearFeatures,
  onApplySplit,
  disabled = false,
}: FacetSplittingToolsProps) {
  
  const handleSmartSplit = () => {
    if (buildingPolygon.length < 3) {
      toast.error('Need a building outline to split');
      return;
    }

    const detection = detectRoofPattern(buildingPolygon, linearFeatures);
    
    if (detection.suggestedSplits.length === 0) {
      toast.warning(
        `${detection.pattern.toUpperCase()} roof detected (${Math.round(detection.confidence * 100)}% confidence) - ${detection.description}`
      );
      return;
    }

    // Apply first suggested split
    onApplySplit(detection.suggestedSplits[0]);
    toast.success(
      `${detection.pattern.toUpperCase()} roof detected - Split line applied!`,
      { description: detection.description }
    );
  };

  const handleSymmetrySplit = () => {
    if (buildingPolygon.length < 3) {
      toast.error('Need a building outline to split');
      return;
    }

    const splits = detectSymmetricalSplits(buildingPolygon);
    
    if (splits.length === 0) {
      toast.warning('No symmetrical split detected - building is not symmetric enough');
      return;
    }

    onApplySplit(splits[0]);
    toast.success('Symmetrical split line applied!');
  };

  const handleRidgeSplit = () => {
    if (!linearFeatures?.ridges || linearFeatures.ridges.length === 0) {
      toast.error('No ridge lines detected in building outline');
      return;
    }

    const ridge = linearFeatures.ridges[0];
    const ridgePoints = ridge.points || [];
    
    if (ridgePoints.length < 2) {
      toast.error('Ridge line data incomplete');
      return;
    }

    onApplySplit({
      start: ridgePoints[0],
      end: ridgePoints[ridgePoints.length - 1],
    });
    
    toast.success('Split along ridge line!');
  };

  const detection = buildingPolygon.length >= 3 
    ? detectRoofPattern(buildingPolygon, linearFeatures)
    : null;

  return (
    <Card className="p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scissors className="w-5 h-5 text-primary" />
            <h3 className="font-semibold">Facet Splitting Helpers</h3>
          </div>
          
          {detection && (
            <Badge variant={detection.confidence > 0.8 ? 'default' : 'secondary'}>
              {detection.pattern.toUpperCase()} - {Math.round(detection.confidence * 100)}%
            </Badge>
          )}
        </div>

        {detection && (
          <div className="p-3 bg-muted rounded-lg text-sm">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
              <p className="text-muted-foreground">{detection.description}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSmartSplit}
            disabled={disabled || !buildingPolygon.length}
            className="justify-start"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Smart Split
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleSymmetrySplit}
            disabled={disabled || !buildingPolygon.length}
            className="justify-start"
          >
            <Split className="w-4 h-4 mr-2" />
            Symmetry Split
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleRidgeSplit}
            disabled={disabled || !linearFeatures?.ridges?.length}
            className="justify-start"
          >
            <GitBranch className="w-4 h-4 mr-2" />
            Ridge Split
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled
            className="justify-start"
            title="Click two points on canvas to manually split"
          >
            <Target className="w-4 h-4 mr-2" />
            Manual Split
          </Button>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>• <strong>Smart Split:</strong> AI detects roof type and suggests optimal split</p>
          <p>• <strong>Symmetry Split:</strong> Splits along building's axis of symmetry</p>
          <p>• <strong>Ridge Split:</strong> Splits along detected ridge line</p>
          <p>• <strong>Manual Split:</strong> Click two points to draw custom split line</p>
        </div>
      </div>
    </Card>
  );
}
