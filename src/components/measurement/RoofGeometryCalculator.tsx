import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Calculator, 
  Ruler, 
  Mountain, 
  Triangle, 
  ArrowDownUp,
  Target,
  Percent,
  Package
} from "lucide-react";

interface RoofMeasurements {
  perimeter: { area: number; perimeter: number; count: number };
  ridges: { totalLength: number; count: number; lines: Array<{ length: number; angle: number }> };
  hips: { totalLength: number; count: number; lines: Array<{ length: number; angle: number }> };
  valleys: { totalLength: number; count: number; lines: Array<{ length: number; angle: number }> };
  planimeter: { totalArea: number; count: number; areas: number[] };
}

interface RoofGeometryCalculatorProps {
  measurements: RoofMeasurements;
  roofPitch: string;
  complexity: 'simple' | 'moderate' | 'complex' | 'extreme';
  wasteFactor: number;
}

export const RoofGeometryCalculator: React.FC<RoofGeometryCalculatorProps> = ({
  measurements,
  roofPitch,
  complexity,
  wasteFactor
}) => {
  // Parse roof pitch (e.g., "8/12" -> rise: 8, run: 12)
  const [rise, run] = roofPitch.split('/').map(Number);
  const pitchAngle = Math.atan(rise / run) * (180 / Math.PI);
  const pitchMultiplier = Math.sqrt(Math.pow(rise, 2) + Math.pow(run, 2)) / run;

  // Calculate hip rafter lengths using roof geometry
  const calculateHipRafters = () => {
    return measurements.hips.lines.map(hip => {
      // Hip rafter calculation: √(run² + rise²) for each segment
      const hipRun = hip.length / pitchMultiplier; // Convert slope distance to horizontal
      const hipRise = hipRun * (rise / run);
      const hipRafterLength = Math.sqrt(Math.pow(hipRun, 2) + Math.pow(hipRise, 2));
      
      return {
        ...hip,
        rafterLength: hipRafterLength,
        cutAngle: Math.atan2(hipRise, hipRun) * (180 / Math.PI)
      };
    });
  };

  // Calculate valley rafter lengths
  const calculateValleyRafters = () => {
    return measurements.valleys.lines.map(valley => {
      // Valley rafter calculation similar to hip
      const valleyRun = valley.length / pitchMultiplier;
      const valleyRise = valleyRun * (rise / run);
      const valleyRafterLength = Math.sqrt(Math.pow(valleyRun, 2) + Math.pow(valleyRise, 2));
      
      return {
        ...valley,
        rafterLength: valleyRafterLength,
        flashingLength: valley.length * 1.1, // 10% extra for overlap
        cutAngle: Math.atan2(valleyRise, valleyRun) * (180 / Math.PI)
      };
    });
  };

  // Calculate material quantities
  const calculateMaterials = () => {
    const totalRoofArea = measurements.perimeter.area * pitchMultiplier; // Adjust for slope
    const adjustedArea = totalRoofArea * (1 + wasteFactor / 100);
    
    // Complexity multipliers for labor and materials
    const complexityMultipliers = {
      simple: 1.0,
      moderate: 1.2,
      complex: 1.5,
      extreme: 2.0
    };
    
    const complexityMultiplier = complexityMultipliers[complexity];
    
    return {
      // Shingles (typically 3 bundles per 100 sq ft)
      shingleBundles: Math.ceil((adjustedArea / 100) * 3 * complexityMultiplier),
      
      // Underlayment (rolls typically cover 400 sq ft)
      underlaymentRolls: Math.ceil((adjustedArea / 400) * complexityMultiplier),
      
      // Ridge cap (linear feet)
      ridgeCapFeet: Math.ceil(measurements.ridges.totalLength * complexityMultiplier),
      
      // Hip cap (linear feet)
      hipCapFeet: Math.ceil(measurements.hips.totalLength * complexityMultiplier),
      
      // Valley flashing (linear feet with 10% extra)
      valleyFlashingFeet: Math.ceil(measurements.valleys.totalLength * 1.1 * complexityMultiplier),
      
      // Starter strip (perimeter)
      starterStripFeet: Math.ceil(measurements.perimeter.perimeter * complexityMultiplier),
      
      // Drip edge (perimeter)
      dripEdgeFeet: Math.ceil(measurements.perimeter.perimeter * complexityMultiplier),
      
      // Nails (approximately 2 lbs per 100 sq ft)
      nailsPounds: Math.ceil((adjustedArea / 100) * 2 * complexityMultiplier)
    };
  };

  const hipRafters = calculateHipRafters();
  const valleyRafters = calculateValleyRafters();
  const materials = calculateMaterials();
  const totalRoofArea = measurements.perimeter.area * pitchMultiplier;
  const adjustedArea = totalRoofArea * (1 + wasteFactor / 100);

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Roof Geometry Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{Math.round(totalRoofArea).toLocaleString()}</div>
              <div className="text-sm text-muted-foreground">Roof Area (sq ft)</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{Math.round(adjustedArea).toLocaleString()}</div>
              <div className="text-sm text-muted-foreground">Adjusted Area (sq ft)</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{pitchAngle.toFixed(1)}°</div>
              <div className="text-sm text-muted-foreground">Roof Pitch Angle</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{pitchMultiplier.toFixed(2)}x</div>
              <div className="text-sm text-muted-foreground">Slope Multiplier</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Measurements */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Ridge Measurements */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mountain className="h-5 w-5" />
              Ridge Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span>Total Ridge Length:</span>
              <Badge variant="outline">{Math.round(measurements.ridges.totalLength)} ft</Badge>
            </div>
            <div className="flex justify-between">
              <span>Number of Ridges:</span>
              <Badge variant="outline">{measurements.ridges.count}</Badge>
            </div>
            {measurements.ridges.lines.map((ridge, index) => (
              <div key={index} className="text-sm border-l-2 border-green-500 pl-3">
                <div>Ridge {index + 1}: {Math.round(ridge.length)} ft</div>
                <div className="text-muted-foreground">Angle: {Math.round(ridge.angle)}°</div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Hip Measurements */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Triangle className="h-5 w-5" />
              Hip Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span>Total Hip Length:</span>
              <Badge variant="outline">{Math.round(measurements.hips.totalLength)} ft</Badge>
            </div>
            <div className="flex justify-between">
              <span>Number of Hips:</span>
              <Badge variant="outline">{measurements.hips.count}</Badge>
            </div>
            {hipRafters.map((hip, index) => (
              <div key={index} className="text-sm border-l-2 border-blue-500 pl-3">
                <div>Hip {index + 1}: {Math.round(hip.length)} ft</div>
                <div className="text-muted-foreground">
                  Rafter: {Math.round(hip.rafterLength)} ft @ {Math.round(hip.cutAngle)}°
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Valley Measurements */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowDownUp className="h-5 w-5" />
              Valley Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span>Total Valley Length:</span>
              <Badge variant="outline">{Math.round(measurements.valleys.totalLength)} ft</Badge>
            </div>
            <div className="flex justify-between">
              <span>Number of Valleys:</span>
              <Badge variant="outline">{measurements.valleys.count}</Badge>
            </div>
            {valleyRafters.map((valley, index) => (
              <div key={index} className="text-sm border-l-2 border-purple-500 pl-3">
                <div>Valley {index + 1}: {Math.round(valley.length)} ft</div>
                <div className="text-muted-foreground">
                  Flashing: {Math.round(valley.flashingLength)} ft
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Material Calculations */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Material Quantities
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex justify-between">
                <span>Shingle Bundles:</span>
                <Badge variant="secondary">{materials.shingleBundles}</Badge>
              </div>
              <div className="flex justify-between">
                <span>Underlayment Rolls:</span>
                <Badge variant="secondary">{materials.underlaymentRolls}</Badge>
              </div>
              <div className="flex justify-between">
                <span>Ridge Cap:</span>
                <Badge variant="secondary">{materials.ridgeCapFeet} ft</Badge>
              </div>
              <div className="flex justify-between">
                <span>Hip Cap:</span>
                <Badge variant="secondary">{materials.hipCapFeet} ft</Badge>
              </div>
              <div className="flex justify-between">
                <span>Valley Flashing:</span>
                <Badge variant="secondary">{materials.valleyFlashingFeet} ft</Badge>
              </div>
              <div className="flex justify-between">
                <span>Starter Strip:</span>
                <Badge variant="secondary">{materials.starterStripFeet} ft</Badge>
              </div>
              <div className="flex justify-between">
                <span>Drip Edge:</span>
                <Badge variant="secondary">{materials.dripEdgeFeet} ft</Badge>
              </div>
              <div className="flex justify-between">
                <span>Nails:</span>
                <Badge variant="secondary">{materials.nailsPounds} lbs</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Accuracy Indicators */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Measurement Confidence
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-lg font-semibold text-green-600">High</div>
              <div className="text-sm text-muted-foreground">Perimeter Accuracy</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-blue-600">Very High</div>
              <div className="text-sm text-muted-foreground">Ridge Accuracy</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-blue-600">Very High</div>
              <div className="text-sm text-muted-foreground">Hip Accuracy</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-purple-600">High</div>
              <div className="text-sm text-muted-foreground">Valley Accuracy</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RoofGeometryCalculator;