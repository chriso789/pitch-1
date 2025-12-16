import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Layers, Plus, Trash2 } from 'lucide-react';
import { 
  PlaneCalculation, 
  PlaneShape, 
  calculatePlanArea, 
  calculateSurfaceArea,
  parsePitch,
  PITCH_REFERENCE_TABLE,
  PitchInfo 
} from '@/lib/measurements/roofWorksheetCalculations';

interface PlaneWorksheetProps {
  planes: PlaneCalculation[];
  customPitches: PitchInfo[];
  onPlanesChange: (planes: PlaneCalculation[]) => void;
}

export const PlaneWorksheet: React.FC<PlaneWorksheetProps> = ({
  planes,
  customPitches,
  onPlanesChange,
}) => {
  const allPitches = [...PITCH_REFERENCE_TABLE, ...customPitches];
  
  const addPlane = () => {
    const newId = String.fromCharCode(65 + planes.length); // A, B, C...
    const newPlane: PlaneCalculation = {
      id: newId,
      shape: 'rect',
      dimensions: { shape: 'rect', L: 0, W: 0 },
      formula: 'L × W',
      substitution: '',
      planAreaSqft: 0,
      pitch: '6/12',
      pitchInfo: parsePitch('6/12'),
      surfaceAreaSqft: 0,
      surfaceFormula: '',
      include: true,
      notes: '',
    };
    onPlanesChange([...planes, newPlane]);
  };
  
  const updatePlane = (index: number, updates: Partial<PlaneCalculation>) => {
    const updated = [...planes];
    let plane = { ...updated[index], ...updates };
    
    // Recalculate if dimensions changed
    if (updates.dimensions || updates.shape) {
      const dims = updates.dimensions || plane.dimensions;
      const calc = calculatePlanArea(dims);
      plane.planAreaSqft = calc.area;
      plane.formula = calc.formula;
      plane.substitution = calc.substitution;
    }
    
    // Recalculate surface area if plan area or pitch changed
    if (updates.dimensions || updates.shape || updates.pitch) {
      const pitchInfo = updates.pitch ? parsePitch(updates.pitch) : plane.pitchInfo;
      plane.pitchInfo = pitchInfo;
      const surface = calculateSurfaceArea(plane.planAreaSqft, pitchInfo);
      plane.surfaceAreaSqft = surface.area;
      plane.surfaceFormula = surface.formula;
    }
    
    updated[index] = plane;
    onPlanesChange(updated);
  };
  
  const removePlane = (index: number) => {
    onPlanesChange(planes.filter((_, i) => i !== index));
  };
  
  const totalPlanArea = planes.filter(p => p.include).reduce((sum, p) => sum + p.planAreaSqft, 0);
  const totalSurfaceArea = planes.filter(p => p.include).reduce((sum, p) => sum + p.surfaceAreaSqft, 0);
  const totalSquares = totalSurfaceArea / 100;
  
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Layers className="h-5 w-5" />
          3. Roof Plane Worksheet (PLAN vs SURFACE)
        </CardTitle>
        <CardDescription>
          Break the roof into simple shapes. Enter dimensions, select pitch, and calculations are automatic.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">ID</TableHead>
                <TableHead className="w-[80px]">Shape</TableHead>
                <TableHead className="w-[200px]">Dimensions (ft)</TableHead>
                <TableHead className="w-[120px]">PLAN Area</TableHead>
                <TableHead className="w-[100px]">Pitch</TableHead>
                <TableHead className="w-[80px]">Factor</TableHead>
                <TableHead className="w-[120px]">SURFACE Area</TableHead>
                <TableHead className="w-[60px]">Include</TableHead>
                <TableHead className="w-[40px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {planes.map((plane, idx) => (
                <TableRow key={plane.id}>
                  <TableCell className="font-bold">{plane.id}</TableCell>
                  <TableCell>
                    <Select
                      value={plane.shape}
                      onValueChange={(value: PlaneShape) => {
                        const newDims = { shape: value } as any;
                        if (value === 'rect') { newDims.L = 0; newDims.W = 0; }
                        else if (value === 'tri') { newDims.base = 0; newDims.height = 0; }
                        else if (value === 'trap') { newDims.a = 0; newDims.b = 0; newDims.h = 0; }
                        else if (value === 'custom') { newDims.customArea = 0; }
                        updatePlane(idx, { shape: value, dimensions: newDims });
                      }}
                    >
                      <SelectTrigger className="w-[80px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rect">Rect</SelectItem>
                        <SelectItem value="tri">Tri</SelectItem>
                        <SelectItem value="trap">Trap</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <DimensionInputs
                      shape={plane.shape}
                      dimensions={plane.dimensions}
                      onChange={(dims) => updatePlane(idx, { dimensions: dims })}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-mono text-sm">
                      {plane.planAreaSqft.toFixed(0)} sq ft
                    </div>
                    <div className="text-xs text-muted-foreground">{plane.formula}</div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={plane.pitch}
                      onValueChange={(value) => updatePlane(idx, { pitch: value })}
                    >
                      <SelectTrigger className="w-[90px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {allPitches.map((p) => (
                          <SelectItem key={p.pitch} value={p.pitch}>
                            {p.pitch}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {plane.pitchInfo.slopeFactor.toFixed(4)}
                  </TableCell>
                  <TableCell>
                    <div className="font-mono font-semibold">
                      {plane.surfaceAreaSqft.toFixed(0)} sq ft
                    </div>
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      checked={plane.include}
                      onCheckedChange={(checked) => updatePlane(idx, { include: !!checked })}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => removePlane(idx)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        
        <Button variant="outline" onClick={addPlane}>
          <Plus className="h-4 w-4 mr-2" />
          Add Plane
        </Button>
        
        {/* Totals */}
        <div className="grid grid-cols-3 gap-4 pt-4 border-t">
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total PLAN Area</p>
            <p className="text-xl font-bold font-mono">{totalPlanArea.toFixed(0)} sq ft</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total SURFACE Area</p>
            <p className="text-xl font-bold font-mono">{totalSurfaceArea.toFixed(0)} sq ft</p>
          </div>
          <div className="bg-primary/10 rounded-lg p-3">
            <p className="text-xs text-primary uppercase tracking-wide">Total Squares</p>
            <p className="text-xl font-bold font-mono text-primary">{totalSquares.toFixed(2)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// Dimension input component based on shape
const DimensionInputs: React.FC<{
  shape: PlaneShape;
  dimensions: any;
  onChange: (dims: any) => void;
}> = ({ shape, dimensions, onChange }) => {
  switch (shape) {
    case 'rect':
      return (
        <div className="flex gap-1 items-center">
          <Input
            type="number"
            placeholder="L"
            className="w-16 h-8"
            value={dimensions.L || ''}
            onChange={(e) => onChange({ ...dimensions, L: parseFloat(e.target.value) || 0 })}
          />
          <span className="text-muted-foreground">×</span>
          <Input
            type="number"
            placeholder="W"
            className="w-16 h-8"
            value={dimensions.W || ''}
            onChange={(e) => onChange({ ...dimensions, W: parseFloat(e.target.value) || 0 })}
          />
        </div>
      );
    case 'tri':
      return (
        <div className="flex gap-1 items-center">
          <Input
            type="number"
            placeholder="base"
            className="w-16 h-8"
            value={dimensions.base || ''}
            onChange={(e) => onChange({ ...dimensions, base: parseFloat(e.target.value) || 0 })}
          />
          <span className="text-muted-foreground">h:</span>
          <Input
            type="number"
            placeholder="height"
            className="w-16 h-8"
            value={dimensions.height || ''}
            onChange={(e) => onChange({ ...dimensions, height: parseFloat(e.target.value) || 0 })}
          />
        </div>
      );
    case 'trap':
      return (
        <div className="flex gap-1 items-center flex-wrap">
          <Input
            type="number"
            placeholder="a"
            className="w-14 h-8"
            value={dimensions.a || ''}
            onChange={(e) => onChange({ ...dimensions, a: parseFloat(e.target.value) || 0 })}
          />
          <Input
            type="number"
            placeholder="b"
            className="w-14 h-8"
            value={dimensions.b || ''}
            onChange={(e) => onChange({ ...dimensions, b: parseFloat(e.target.value) || 0 })}
          />
          <span className="text-muted-foreground">h:</span>
          <Input
            type="number"
            placeholder="h"
            className="w-14 h-8"
            value={dimensions.h || ''}
            onChange={(e) => onChange({ ...dimensions, h: parseFloat(e.target.value) || 0 })}
          />
        </div>
      );
    case 'custom':
      return (
        <Input
          type="number"
          placeholder="Direct area"
          className="w-24 h-8"
          value={dimensions.customArea || ''}
          onChange={(e) => onChange({ ...dimensions, customArea: parseFloat(e.target.value) || 0 })}
        />
      );
    default:
      return null;
  }
};
