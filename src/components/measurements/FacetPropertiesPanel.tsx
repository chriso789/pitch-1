import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Compass, Copy, CopyCheck } from 'lucide-react';
import type { SplitFacet } from '@/utils/polygonSplitting';
import { toast } from 'sonner';

interface FacetPropertiesPanelProps {
  facet: SplitFacet;
  onUpdateFacet: (facetId: string, updates: Partial<SplitFacet>) => void;
  onCopyToAdjacent?: () => void;
  onCopyToAll?: () => void;
}

const PITCH_OPTIONS = ['2/12', '3/12', '4/12', '5/12', '6/12', '7/12', '8/12', '9/12', '10/12', '11/12', '12/12'];
const DIRECTION_OPTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function FacetPropertiesPanel({ 
  facet, 
  onUpdateFacet, 
  onCopyToAdjacent, 
  onCopyToAll 
}: FacetPropertiesPanelProps) {
  const handlePitchChange = (value: string) => {
    onUpdateFacet(facet.id, { pitch: value });
    toast.success(`Pitch updated to ${value}`);
  };

  const handleDirectionChange = (value: string) => {
    onUpdateFacet(facet.id, { direction: value });
    toast.success(`Direction updated to ${value}`);
  };

  return (
    <div className="bg-card border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Facet Properties</h3>
        <div 
          className="w-6 h-6 rounded border-2"
          style={{ backgroundColor: facet.color }}
        />
      </div>

      <div className="grid gap-4">
        {/* Facet Info */}
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Facet ID</div>
          <div className="text-sm font-mono">{facet.id}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Area</div>
          <div className="text-sm font-semibold">{facet.area.toLocaleString()} sq ft</div>
        </div>

        {/* Pitch Selector */}
        <div className="space-y-2">
          <Label htmlFor="pitch">Pitch</Label>
          <Select value={facet.pitch || ''} onValueChange={handlePitchChange}>
            <SelectTrigger id="pitch">
              <SelectValue placeholder="Select pitch..." />
            </SelectTrigger>
            <SelectContent>
              {PITCH_OPTIONS.map(pitch => (
                <SelectItem key={pitch} value={pitch}>{pitch}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Direction Selector */}
        <div className="space-y-2">
          <Label htmlFor="direction">
            <div className="flex items-center gap-1">
              <Compass className="w-4 h-4" />
              Direction
            </div>
          </Label>
          <Select value={facet.direction || ''} onValueChange={handleDirectionChange}>
            <SelectTrigger id="direction">
              <SelectValue placeholder="Select direction..." />
            </SelectTrigger>
            <SelectContent>
              {DIRECTION_OPTIONS.map(dir => (
                <SelectItem key={dir} value={dir}>{dir}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Copy Actions */}
        {(facet.pitch || facet.direction) && (
          <div className="space-y-2 pt-2 border-t">
            <Label>Copy Properties</Label>
            {onCopyToAdjacent && (
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full"
                onClick={onCopyToAdjacent}
              >
                <Copy className="w-4 h-4 mr-2" />
                Copy to Adjacent Facets
              </Button>
            )}
            {onCopyToAll && (
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full"
                onClick={onCopyToAll}
              >
                <CopyCheck className="w-4 h-4 mr-2" />
                Apply to All Facets
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
