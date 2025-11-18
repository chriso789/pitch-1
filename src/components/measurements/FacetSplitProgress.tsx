import { CheckCircle2, AlertCircle, Circle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import type { SplitFacet } from '@/utils/polygonSplitting';

interface FacetSplitProgressProps {
  facets: SplitFacet[];
}

export function FacetSplitProgress({ facets }: FacetSplitProgressProps) {
  const facetCount = facets.length;
  const hasPitch = facets.every(f => f.pitch);
  const hasDirection = facets.every(f => f.direction);

  // Calculate progress
  let progress = 0;
  if (facetCount >= 2) progress = 33;
  if (facetCount >= 2 && hasPitch) progress = 66;
  if (facetCount >= 2 && hasPitch && hasDirection) progress = 100;

  const steps = [
    {
      id: 'split',
      label: 'Split Facets',
      complete: facetCount >= 2,
      description: `${facetCount} facet${facetCount !== 1 ? 's' : ''} created`,
    },
    {
      id: 'pitch',
      label: 'Assign Pitch',
      complete: hasPitch && facetCount >= 2,
      description: hasPitch ? 'All facets have pitch' : 'Some facets missing pitch',
    },
    {
      id: 'direction',
      label: 'Assign Direction',
      complete: hasDirection && facetCount >= 2,
      description: hasDirection ? 'All facets have direction' : 'Some facets missing direction',
    },
  ];

  const getStatusBadge = () => {
    if (progress === 100) {
      return <Badge variant="default" className="bg-green-600"><CheckCircle2 className="w-3 h-3 mr-1" />Complete</Badge>;
    }
    if (progress >= 33) {
      return <Badge variant="secondary"><AlertCircle className="w-3 h-3 mr-1" />In Progress</Badge>;
    }
    return <Badge variant="outline">Not Started</Badge>;
  };

  return (
    <div className="bg-card border rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Facet Splitting Progress</h3>
          {getStatusBadge()}
        </div>
        <span className="text-sm text-muted-foreground">{progress}%</span>
      </div>

      <Progress value={progress} className="h-2 mb-4" />

      <div className="space-y-2">
        {steps.map((step) => (
          <div key={step.id} className="flex items-start gap-2">
            {step.complete ? (
              <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
            ) : (
              <Circle className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{step.label}</div>
              <div className="text-xs text-muted-foreground">{step.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
