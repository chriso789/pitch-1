import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Compass, X } from 'lucide-react';
import { toast } from 'sonner';

interface EnhancedFacetPropertiesPanelProps {
  facet: any;
  facetIndex: number;
  onUpdateFacet: (facetIndex: number, updates: Partial<any>) => void;
  onClose: () => void;
}

const PITCH_OPTIONS = ['2/12', '3/12', '4/12', '5/12', '6/12', '7/12', '8/12', '9/12', '10/12', '11/12', '12/12'];
const DIRECTION_OPTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function EnhancedFacetPropertiesPanel({ 
  facet, 
  facetIndex,
  onUpdateFacet,
  onClose
}: EnhancedFacetPropertiesPanelProps) {
  const handlePitchChange = (value: string) => {
    onUpdateFacet(facetIndex, { pitch: value });
    toast.success(`Pitch updated to ${value}`);
  };

  const handleDirectionChange = (value: string) => {
    onUpdateFacet(facetIndex, { direction: value });
    toast.success(`Direction updated to ${value}`);
  };

  const handleLabelChange = (value: string) => {
    onUpdateFacet(facetIndex, { label: value });
  };

  return (
    <div className="absolute right-4 top-4 w-80 bg-card border rounded-lg p-4 space-y-4 shadow-lg z-10">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Facet {facetIndex + 1} Properties</h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-4">
        {/* Facet Label */}
        <div className="space-y-2">
          <Label htmlFor="facet-label">Label</Label>
          <Input
            id="facet-label"
            value={facet.label || `Facet ${facetIndex + 1}`}
            onChange={(e) => handleLabelChange(e.target.value)}
            placeholder="Enter facet name..."
          />
        </div>

        {/* Area Display (Read-only) */}
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Area</div>
          <div className="text-lg font-semibold">{Math.round(facet.area || 0).toLocaleString()} sq ft</div>
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

        {/* Additional Info */}
        {facet.boundary && (
          <div className="space-y-1 pt-2 border-t">
            <div className="text-xs text-muted-foreground">Corner Points</div>
            <div className="text-sm">{facet.boundary.length} corners</div>
          </div>
        )}
      </div>
    </div>
  );
}
