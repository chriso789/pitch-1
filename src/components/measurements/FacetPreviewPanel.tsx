import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { SplitFacet } from '@/utils/polygonSplitting';

interface FacetPreviewPanelProps {
  facets: SplitFacet[];
  selectedFacetId: string | null;
  onSelectFacet: (facetId: string) => void;
}

export function FacetPreviewPanel({ facets, selectedFacetId, onSelectFacet }: FacetPreviewPanelProps) {
  const totalArea = facets.reduce((sum, f) => sum + f.area, 0);
  const totalSquares = totalArea / 100;
  
  const pitchRange = facets
    .map(f => f.pitch)
    .filter(Boolean)
    .sort();
  const pitchRangeText = pitchRange.length > 0 
    ? `${pitchRange[0]} to ${pitchRange[pitchRange.length - 1]}`
    : 'Not set';

  const directionCounts = facets.reduce((acc, f) => {
    if (f.direction) {
      acc[f.direction] = (acc[f.direction] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  // Estimate materials (simplified)
  const estimatedRidgeCap = totalArea * 0.15; // Rough estimate
  const estimatedValleys = totalArea * 0.08; // Rough estimate

  return (
    <Card className="p-4 space-y-4">
      <h3 className="text-sm font-semibold">Facet Preview</h3>

      {/* Summary Statistics */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Total Facets</div>
          <div className="font-semibold">{facets.length}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Total Area</div>
          <div className="font-semibold">{totalArea.toLocaleString()} sq ft</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Pitch Range</div>
          <div className="font-semibold">{pitchRangeText}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Directions</div>
          <div className="font-semibold text-xs">
            {Object.entries(directionCounts).map(([dir, count]) => `${dir} (${count})`).join(', ') || 'Not set'}
          </div>
        </div>
      </div>

      {/* Material Preview */}
      <div className="border-t pt-3 space-y-2">
        <div className="text-xs font-semibold text-muted-foreground">Estimated Materials</div>
        <div className="grid gap-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Shingles:</span>
            <span className="font-medium">{totalSquares.toFixed(1)} squares</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Ridge Cap:</span>
            <span className="font-medium">{estimatedRidgeCap.toFixed(0)} ft</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Valleys:</span>
            <span className="font-medium">{estimatedValleys.toFixed(0)} ft</span>
          </div>
        </div>
      </div>

      {/* Facet List */}
      <div className="border-t pt-3">
        <div className="text-xs font-semibold text-muted-foreground mb-2">Facet List</div>
        <ScrollArea className="h-[200px]">
          <div className="space-y-2">
            {facets.map((facet, index) => (
              <button
                key={facet.id}
                onClick={() => onSelectFacet(facet.id)}
                className={`w-full text-left p-2 rounded-md border transition-colors hover:bg-accent ${
                  selectedFacetId === facet.id ? 'bg-accent border-primary' : 'border-border'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div 
                    className="w-4 h-4 rounded border flex-shrink-0"
                    style={{ backgroundColor: facet.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">Facet #{index + 1}</div>
                    <div className="text-xs text-muted-foreground">
                      {facet.area.toLocaleString()} sq ft
                      {facet.pitch && ` • ${facet.pitch}`}
                      {facet.direction && ` • ${facet.direction}`}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
    </Card>
  );
}
