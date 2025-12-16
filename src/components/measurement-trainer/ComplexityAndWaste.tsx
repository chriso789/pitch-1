import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { AlertTriangle, Percent, Activity } from 'lucide-react';
import { 
  ComplexityCounts, 
  WasteBand, 
  WasteRecommendation,
  recommendWaste,
  parsePitch 
} from '@/lib/measurements/roofWorksheetCalculations';

interface ComplexityAndWasteProps {
  complexity: ComplexityCounts;
  onComplexityChange: (complexity: ComplexityCounts) => void;
  wastePercent: number;
  onWasteChange: (percent: number) => void;
  material: string;
  onMaterialChange: (material: string) => void;
  avgPitch: string;
  complexityNotes: string;
  onComplexityNotesChange: (notes: string) => void;
}

export const ComplexityAndWaste: React.FC<ComplexityAndWasteProps> = ({
  complexity,
  onComplexityChange,
  wastePercent,
  onWasteChange,
  material,
  onMaterialChange,
  avgPitch,
  complexityNotes,
  onComplexityNotesChange,
}) => {
  const recommendation = recommendWaste(complexity, parsePitch(avgPitch));
  
  const getBandColor = (band: WasteBand) => {
    switch (band) {
      case 'simple': return 'bg-green-100 text-green-800 border-green-300';
      case 'moderate': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'cut_up': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'extreme': return 'bg-red-100 text-red-800 border-red-300';
    }
  };
  
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Complexity Counts */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5" />
            5. Complexity Counts
          </CardTitle>
          <CardDescription>
            Count features that increase cutting waste and labor difficulty.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="planes">Facets / Planes</Label>
              <Input
                id="planes"
                type="number"
                min={1}
                value={complexity.planesCount || ''}
                onChange={(e) => onComplexityChange({ 
                  ...complexity, 
                  planesCount: parseInt(e.target.value) || 0 
                })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="valleys">Valleys</Label>
              <Input
                id="valleys"
                type="number"
                min={0}
                value={complexity.valleysCount || ''}
                onChange={(e) => onComplexityChange({ 
                  ...complexity, 
                  valleysCount: parseInt(e.target.value) || 0 
                })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dormers">Dormers</Label>
              <Input
                id="dormers"
                type="number"
                min={0}
                value={complexity.dormersCount || ''}
                onChange={(e) => onComplexityChange({ 
                  ...complexity, 
                  dormersCount: parseInt(e.target.value) || 0 
                })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="penetrations">Penetrations</Label>
              <Input
                id="penetrations"
                type="number"
                min={0}
                value={complexity.penetrationsCount || ''}
                onChange={(e) => onComplexityChange({ 
                  ...complexity, 
                  penetrationsCount: parseInt(e.target.value) || 0 
                })}
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="complexityNotes">Complexity Notes</Label>
            <Textarea
              id="complexityNotes"
              placeholder="Note any unusual features: multiple levels, difficult access, etc."
              value={complexityNotes}
              onChange={(e) => onComplexityNotesChange(e.target.value)}
              rows={2}
            />
          </div>
        </CardContent>
      </Card>
      
      {/* Waste & Order Calc */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Percent className="h-5 w-5" />
            6. Waste & Order Calculation
          </CardTitle>
          <CardDescription>
            Select waste percentage based on complexity. System recommends based on your counts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Material Selection */}
          <div className="space-y-2">
            <Label>Material</Label>
            <RadioGroup
              value={material}
              onValueChange={onMaterialChange}
              className="flex flex-wrap gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="asphalt" id="asphalt" />
                <Label htmlFor="asphalt" className="font-normal">Asphalt</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="metal" id="metal" />
                <Label htmlFor="metal" className="font-normal">Metal</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="tile" id="tile" />
                <Label htmlFor="tile" className="font-normal">Tile</Label>
              </div>
            </RadioGroup>
          </div>
          
          {/* Recommendation */}
          <div className={`p-3 rounded-lg border ${getBandColor(recommendation.band)}`}>
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-semibold">Recommended: {recommendation.totalPercent}%</span>
              <Badge variant="outline" className="capitalize">{recommendation.band}</Badge>
            </div>
            <p className="text-xs">{recommendation.justification}</p>
          </div>
          
          {/* Waste Slider */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label>Chosen Waste %</Label>
              <span className="text-2xl font-bold text-primary">{wastePercent}%</span>
            </div>
            <Slider
              value={[wastePercent]}
              onValueChange={([value]) => onWasteChange(value)}
              min={8}
              max={25}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>8% Simple</span>
              <span>15% Cut-up</span>
              <span>25% Extreme</span>
            </div>
          </div>
          
          {/* Waste Band Selection */}
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`p-2 rounded text-xs border transition-colors ${wastePercent <= 10 ? 'bg-green-100 border-green-400' : 'hover:bg-muted'}`}
              onClick={() => onWasteChange(10)}
            >
              10% Simple Gable
            </button>
            <button
              className={`p-2 rounded text-xs border transition-colors ${wastePercent > 10 && wastePercent <= 14 ? 'bg-yellow-100 border-yellow-400' : 'hover:bg-muted'}`}
              onClick={() => onWasteChange(12)}
            >
              12% Moderate
            </button>
            <button
              className={`p-2 rounded text-xs border transition-colors ${wastePercent > 14 && wastePercent <= 18 ? 'bg-orange-100 border-orange-400' : 'hover:bg-muted'}`}
              onClick={() => onWasteChange(15)}
            >
              15% Cut-up
            </button>
            <button
              className={`p-2 rounded text-xs border transition-colors ${wastePercent > 18 ? 'bg-red-100 border-red-400' : 'hover:bg-muted'}`}
              onClick={() => onWasteChange(20)}
            >
              20% Extreme
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
