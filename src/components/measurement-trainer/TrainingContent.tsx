import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { BookOpen, Ruler, Calculator, Target, Layers, AlertTriangle } from 'lucide-react';

export const TrainingContent: React.FC = () => {
  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3 bg-primary/5">
        <CardTitle className="flex items-center gap-2 text-lg">
          <BookOpen className="h-5 w-5 text-primary" />
          Roof Measurement Training Guide
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <Accordion type="single" collapsible className="w-full">
          {/* Core Concepts */}
          <AccordionItem value="concepts">
            <AccordionTrigger className="text-sm font-semibold">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4" />
                Core Concepts: PLAN vs SURFACE Area
              </div>
            </AccordionTrigger>
            <AccordionContent className="text-sm space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                  <p className="font-semibold text-blue-800 mb-1">PLAN Area (Footprint)</p>
                  <p className="text-blue-700">
                    The horizontal projection of the roof — what you would see looking straight down from above. 
                    This is what blueprint dimensions give you.
                  </p>
                </div>
                <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                  <p className="font-semibold text-green-800 mb-1">SURFACE Area (Actual)</p>
                  <p className="text-green-700">
                    The true sloped area that shingles must cover. Always larger than plan area 
                    (unless flat). This is what you order materials for.
                  </p>
                </div>
              </div>
              <div className="bg-muted p-3 rounded-lg font-mono text-sm">
                <p><strong>Conversion Formula:</strong></p>
                <p>SURFACE area = PLAN area × slope_factor</p>
                <p className="text-muted-foreground mt-1">where slope_factor = √(1 + (pitch/12)²)</p>
              </div>
            </AccordionContent>
          </AccordionItem>
          
          {/* Pitch & Slope */}
          <AccordionItem value="pitch">
            <AccordionTrigger className="text-sm font-semibold">
              <div className="flex items-center gap-2">
                <Calculator className="h-4 w-4" />
                Understanding Pitch & Slope Factor
              </div>
            </AccordionTrigger>
            <AccordionContent className="text-sm space-y-3">
              <p>
                Roof pitch is expressed as <strong>rise/run</strong> (e.g., 6/12 means 6 inches rise 
                per 12 inches of horizontal run).
              </p>
              <div className="bg-muted p-3 rounded-lg font-mono text-sm">
                <p><strong>Step-by-step calculation:</strong></p>
                <p>1. p = rise ÷ run = X ÷ 12</p>
                <p>2. slope_factor = √(1 + p²)</p>
                <p className="mt-2 text-muted-foreground">Example for 6/12 pitch:</p>
                <p>p = 6/12 = 0.5</p>
                <p>slope_factor = √(1 + 0.5²) = √1.25 = 1.118</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">4/12 → 1.054</Badge>
                <Badge variant="outline">6/12 → 1.118</Badge>
                <Badge variant="outline">8/12 → 1.202</Badge>
                <Badge variant="outline">12/12 → 1.414</Badge>
              </div>
            </AccordionContent>
          </AccordionItem>
          
          {/* Linear Components */}
          <AccordionItem value="linear">
            <AccordionTrigger className="text-sm font-semibold">
              <div className="flex items-center gap-2">
                <Ruler className="h-4 w-4" />
                Linear Components: Ridge, Hip, Valley, Eave, Rake
              </div>
            </AccordionTrigger>
            <AccordionContent className="text-sm space-y-3">
              <div className="space-y-2">
                <div className="flex gap-2 items-start">
                  <Badge>Ridge</Badge>
                  <span>Highest horizontal line where two roof planes meet at the top</span>
                </div>
                <div className="flex gap-2 items-start">
                  <Badge>Hip</Badge>
                  <span>Outside sloping line where two planes meet and slope down (convex)</span>
                </div>
                <div className="flex gap-2 items-start">
                  <Badge>Valley</Badge>
                  <span>Inside sloping line where two planes meet creating a water channel (concave)</span>
                </div>
                <div className="flex gap-2 items-start">
                  <Badge>Eave</Badge>
                  <span>Lower horizontal edge where water sheds off into gutters</span>
                </div>
                <div className="flex gap-2 items-start">
                  <Badge>Rake</Badge>
                  <span>Sloped outer edge along a gable (no gutter)</span>
                </div>
              </div>
              <div className="bg-amber-50 p-3 rounded-lg border border-amber-200">
                <p className="font-semibold text-amber-800 mb-1">⚠️ True vs Plan Length</p>
                <p className="text-amber-700 text-xs">
                  Hips and valleys slope in 3D. If you only have plan (top-down) length, 
                  you must convert using: true_length ≈ plan_length × √(1 + p²/2) for 90° corners.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>
          
          {/* Plane Shapes */}
          <AccordionItem value="shapes">
            <AccordionTrigger className="text-sm font-semibold">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Calculating Plane Areas by Shape
              </div>
            </AccordionTrigger>
            <AccordionContent className="text-sm space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-muted p-3 rounded-lg">
                  <p className="font-semibold mb-1">Rectangle</p>
                  <p className="font-mono">A = L × W</p>
                </div>
                <div className="bg-muted p-3 rounded-lg">
                  <p className="font-semibold mb-1">Triangle</p>
                  <p className="font-mono">A = 0.5 × base × height</p>
                </div>
                <div className="bg-muted p-3 rounded-lg">
                  <p className="font-semibold mb-1">Trapezoid</p>
                  <p className="font-mono">A = ((a + b) / 2) × h</p>
                </div>
              </div>
              <p className="text-muted-foreground text-xs">
                For irregular shapes, break them into rectangles and triangles, calculate each, then sum.
              </p>
            </AccordionContent>
          </AccordionItem>
          
          {/* Waste Factor */}
          <AccordionItem value="waste">
            <AccordionTrigger className="text-sm font-semibold">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Waste Factor Selection
              </div>
            </AccordionTrigger>
            <AccordionContent className="text-sm space-y-3">
              <p>
                Waste accounts for cutting losses, starter courses, overlaps, and damaged material.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-green-50 p-2 rounded border border-green-200">
                  <p className="font-semibold text-green-800">10% Simple</p>
                  <p className="text-xs text-green-700">Basic gable, few penetrations</p>
                </div>
                <div className="bg-yellow-50 p-2 rounded border border-yellow-200">
                  <p className="font-semibold text-yellow-800">12-15% Moderate</p>
                  <p className="text-xs text-yellow-700">Some hips/valleys, few dormers</p>
                </div>
                <div className="bg-orange-50 p-2 rounded border border-orange-200">
                  <p className="font-semibold text-orange-800">15-20% Cut-up</p>
                  <p className="text-xs text-orange-700">Many facets, multiple valleys</p>
                </div>
                <div className="bg-red-50 p-2 rounded border border-red-200">
                  <p className="font-semibold text-red-800">20-25% Extreme</p>
                  <p className="text-xs text-red-700">Very complex, steep pitch</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Add 2-5% for steep pitch (≥8/12), 3-8% for many valleys/dormers.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
};
