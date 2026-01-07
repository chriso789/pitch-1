import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Compass } from 'lucide-react';

interface FacetData {
  id: number;
  areaSqft: number;
  pitch?: string;
  direction?: string;
  color?: string;
}

interface LinearMeasurements {
  ridges: number;
  hips: number;
  valleys: number;
  eaves: number;
  rakes: number;
}

interface RoofrStyleDiagramProps {
  totalArea: number;
  facetCount: number;
  pitch: string;
  linear: LinearMeasurements;
  facets?: FacetData[];
  address?: string;
  source?: 'ai' | 'pdf' | 'manual';
  className?: string;
}

// Professional color palette matching Roofr reports
const FACET_COLORS = [
  'hsl(210, 85%, 75%)', // Light blue
  'hsl(210, 75%, 70%)',
  'hsl(210, 65%, 75%)',
  'hsl(200, 80%, 72%)',
  'hsl(200, 70%, 68%)',
  'hsl(220, 75%, 75%)',
  'hsl(215, 80%, 70%)',
  'hsl(205, 75%, 73%)',
  'hsl(195, 80%, 70%)',
  'hsl(210, 70%, 65%)',
  'hsl(220, 65%, 72%)',
  'hsl(200, 85%, 75%)',
  'hsl(210, 75%, 68%)',
  'hsl(215, 70%, 74%)',
];

const EDGE_COLORS = {
  ridge: '#16a34a',  // Green
  hip: '#7c3aed',    // Purple  
  valley: '#dc2626', // Red
  eave: '#0891b2',   // Cyan
  rake: '#ea580c',   // Orange
};

export function RoofrStyleDiagram({
  totalArea,
  facetCount,
  pitch,
  linear,
  facets = [],
  address,
  source = 'ai',
  className = '',
}: RoofrStyleDiagramProps) {
  const squares = (totalArea / 100).toFixed(1);
  const hipsRidges = linear.hips + linear.ridges;
  const eavesRakes = linear.eaves + linear.rakes;

  // Generate placeholder facets if not provided
  const displayFacets = facets.length > 0 ? facets : 
    Array.from({ length: facetCount }, (_, i) => ({
      id: i + 1,
      areaSqft: Math.round(totalArea / facetCount),
      pitch,
      direction: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][i % 8],
      color: FACET_COLORS[i % FACET_COLORS.length],
    }));

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Roof Diagram</h3>
          {address && <p className="text-sm text-muted-foreground">{address}</p>}
        </div>
        <Badge 
          variant="outline" 
          className={
            source === 'pdf' 
              ? 'bg-green-50 text-green-700 border-green-200' 
              : source === 'ai'
              ? 'bg-blue-50 text-blue-700 border-blue-200'
              : 'bg-gray-50 text-gray-700 border-gray-200'
          }
        >
          {source === 'pdf' ? '✓ PDF Verified' : source === 'ai' ? 'AI Generated' : 'Manual'}
        </Badge>
      </div>

      {/* Main Diagram Area */}
      <Card className="p-6 bg-gray-50">
        <div className="relative bg-white rounded-lg border-2 border-gray-200 aspect-square max-w-[500px] mx-auto overflow-hidden">
          {/* Compass Rose */}
          <div className="absolute top-3 right-3 flex flex-col items-center z-10">
            <Compass className="h-5 w-5 text-gray-600" />
            <span className="text-xs font-semibold text-gray-700">N</span>
          </div>

          {/* Schematic Roof Visualization */}
          <svg viewBox="0 0 400 400" className="w-full h-full">
            {/* Background grid */}
            <defs>
              <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#f0f0f0" strokeWidth="0.5"/>
              </pattern>
            </defs>
            <rect width="400" height="400" fill="url(#grid)" />

            {/* Example roof layout - this would be dynamically generated */}
            {/* Main hip roof shape */}
            <g transform="translate(50, 50)">
              {/* Facet 1 - Front left */}
              <polygon 
                points="0,200 100,100 150,100 150,200" 
                fill={FACET_COLORS[0]} 
                stroke="#6b7280" 
                strokeWidth="1.5"
              />
              <text x="75" y="160" textAnchor="middle" className="text-xs font-bold" fill="#374151">1</text>
              
              {/* Facet 2 - Front center */}
              <polygon 
                points="150,100 150,200 250,200 250,100" 
                fill={FACET_COLORS[1]} 
                stroke="#6b7280" 
                strokeWidth="1.5"
              />
              <text x="200" y="160" textAnchor="middle" className="text-xs font-bold" fill="#374151">2</text>
              
              {/* Facet 3 - Front right */}
              <polygon 
                points="250,100 300,100 300,200 250,200" 
                fill={FACET_COLORS[2]} 
                stroke="#6b7280" 
                strokeWidth="1.5"
              />
              <text x="275" y="160" textAnchor="middle" className="text-xs font-bold" fill="#374151">3</text>
              
              {/* Facet 4 - Top left */}
              <polygon 
                points="0,0 100,100 0,200" 
                fill={FACET_COLORS[3]} 
                stroke="#6b7280" 
                strokeWidth="1.5"
              />
              <text x="35" y="100" textAnchor="middle" className="text-xs font-bold" fill="#374151">4</text>
              
              {/* Facet 5 - Top center */}
              <polygon 
                points="100,0 100,100 200,100 200,0" 
                fill={FACET_COLORS[4]} 
                stroke="#6b7280" 
                strokeWidth="1.5"
              />
              <text x="150" y="60" textAnchor="middle" className="text-xs font-bold" fill="#374151">5</text>
              
              {/* Facet 6 - Top right */}
              <polygon 
                points="200,100 200,0 300,0 300,200" 
                fill={FACET_COLORS[5]} 
                stroke="#6b7280" 
                strokeWidth="1.5"
              />
              <text x="265" y="60" textAnchor="middle" className="text-xs font-bold" fill="#374151">6</text>

              {/* Ridge lines (green) */}
              <line x1="100" y1="100" x2="200" y2="100" stroke={EDGE_COLORS.ridge} strokeWidth="3" />
              <line x1="100" y1="0" x2="200" y2="0" stroke={EDGE_COLORS.ridge} strokeWidth="3" />
              
              {/* Hip lines (purple) */}
              <line x1="0" y1="0" x2="100" y2="100" stroke={EDGE_COLORS.hip} strokeWidth="2.5" />
              <line x1="0" y1="200" x2="100" y2="100" stroke={EDGE_COLORS.hip} strokeWidth="2.5" />
              <line x1="200" y1="100" x2="300" y2="0" stroke={EDGE_COLORS.hip} strokeWidth="2.5" />
              <line x1="200" y1="100" x2="300" y2="200" stroke={EDGE_COLORS.hip} strokeWidth="2.5" />
              
              {/* Valley lines (red) - example */}
              <line x1="150" y1="100" x2="150" y2="200" stroke={EDGE_COLORS.valley} strokeWidth="2" strokeDasharray="4,2" />
            </g>

            {/* Measurement labels */}
            <text x="200" y="385" textAnchor="middle" fontSize="11" fill="#6b7280">
              Total: {totalArea.toLocaleString()} sq ft ({squares} squares)
            </text>
          </svg>
        </div>
      </Card>

      {/* Measurements Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-1 rounded" style={{ backgroundColor: EDGE_COLORS.ridge }} />
            <span className="text-xs text-muted-foreground">Ridges</span>
          </div>
          <div className="text-lg font-bold">{linear.ridges.toFixed(0)} ft</div>
        </Card>
        
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-1 rounded" style={{ backgroundColor: EDGE_COLORS.hip }} />
            <span className="text-xs text-muted-foreground">Hips</span>
          </div>
          <div className="text-lg font-bold">{linear.hips.toFixed(0)} ft</div>
        </Card>
        
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-1 rounded" style={{ backgroundColor: EDGE_COLORS.valley }} />
            <span className="text-xs text-muted-foreground">Valleys</span>
          </div>
          <div className="text-lg font-bold">{linear.valleys.toFixed(0)} ft</div>
        </Card>
        
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-1 rounded" style={{ backgroundColor: EDGE_COLORS.eave }} />
            <span className="text-xs text-muted-foreground">Eaves</span>
          </div>
          <div className="text-lg font-bold">{linear.eaves.toFixed(0)} ft</div>
        </Card>
      </div>

      {/* Combined Totals */}
      <Card className="p-4 bg-muted/30">
        <div className="grid grid-cols-2 gap-4 text-center">
          <div>
            <div className="text-sm text-muted-foreground">Hips + Ridges</div>
            <div className="text-xl font-bold text-purple-600">{hipsRidges.toFixed(0)} ft</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Eaves + Rakes</div>
            <div className="text-xl font-bold text-cyan-600">{eavesRakes.toFixed(0)} ft</div>
          </div>
        </div>
      </Card>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground justify-center">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-1" style={{ backgroundColor: EDGE_COLORS.ridge }} />
          <span>Ridge</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-1" style={{ backgroundColor: EDGE_COLORS.hip }} />
          <span>Hip</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-1 border-t-2 border-dashed" style={{ borderColor: EDGE_COLORS.valley }} />
          <span>Valley</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-1" style={{ backgroundColor: EDGE_COLORS.eave }} />
          <span>Eave</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-1" style={{ backgroundColor: EDGE_COLORS.rake }} />
          <span>Rake</span>
        </div>
      </div>
    </div>
  );
}

export default RoofrStyleDiagram;
