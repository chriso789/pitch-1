import React from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { 
  Ruler, Home, ArrowUpRight, Package
} from 'lucide-react';
import type { RoofMeasurements } from './RoofMeasurementTool';

interface MeasurementResultsProps {
  measurements: RoofMeasurements;
  onPitchChange: (pitch: string) => void;
  onWasteChange: (waste: number) => void;
}

const PITCH_OPTIONS = [
  { value: 'flat', label: 'Flat', factor: '1.00x' },
  { value: '2/12', label: '2/12 (Low)', factor: '1.01x' },
  { value: '3/12', label: '3/12', factor: '1.03x' },
  { value: '4/12', label: '4/12', factor: '1.05x' },
  { value: '5/12', label: '5/12', factor: '1.08x' },
  { value: '6/12', label: '6/12 (Standard)', factor: '1.12x' },
  { value: '7/12', label: '7/12', factor: '1.16x' },
  { value: '8/12', label: '8/12', factor: '1.20x' },
  { value: '9/12', label: '9/12', factor: '1.25x' },
  { value: '10/12', label: '10/12', factor: '1.30x' },
  { value: '12/12', label: '12/12 (Steep)', factor: '1.41x' },
];

const WASTE_OPTIONS = [
  { value: 8, label: '8% (Simple)' },
  { value: 10, label: '10% (Standard)' },
  { value: 12, label: '12%' },
  { value: 15, label: '15% (Complex)' },
  { value: 20, label: '20% (Very Complex)' },
];

export function MeasurementResults({
  measurements,
  onPitchChange,
  onWasteChange,
}: MeasurementResultsProps) {
  const adjustedArea = measurements.roofArea * (1 + measurements.wasteFactor / 100);
  const adjustedSquares = adjustedArea / 100;

  // Material estimates
  const shingleBundles = Math.ceil(adjustedSquares * 3);
  const ridgeCapBundles = Math.ceil((measurements.ridge + measurements.hip) / 33);
  const starterStrip = Math.ceil((measurements.eave + measurements.rake) / 120);

  return (
    <div className="space-y-4">
      {/* Settings */}
      <div className="space-y-3">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Roof Pitch</Label>
          <Select value={measurements.pitch} onValueChange={onPitchChange}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PITCH_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="flex items-center justify-between w-full">
                    <span>{opt.label}</span>
                    <span className="text-muted-foreground ml-2">{opt.factor}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Waste Factor</Label>
          <Select 
            value={measurements.wasteFactor.toString()} 
            onValueChange={(v) => onWasteChange(parseInt(v))}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WASTE_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value.toString()}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Separator />

      {/* Area Measurements */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Home className="h-4 w-4" />
          Area
        </h4>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-muted/50 rounded-lg p-2">
            <div className="text-xs text-muted-foreground">Plan Area</div>
            <div className="font-semibold">{measurements.planArea.toLocaleString()} sq ft</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-2">
            <div className="text-xs text-muted-foreground">Roof Area</div>
            <div className="font-semibold">{measurements.roofArea.toLocaleString()} sq ft</div>
          </div>
        </div>
        <div className="bg-primary/10 rounded-lg p-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">Total Squares (with {measurements.wasteFactor}% waste)</div>
          <div className="text-2xl font-bold text-primary">{adjustedSquares.toFixed(1)}</div>
          <div className="text-xs text-muted-foreground">{adjustedArea.toLocaleString()} sq ft</div>
        </div>
      </div>

      <Separator />

      {/* Linear Measurements */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Ruler className="h-4 w-4" />
          Linear Features
        </h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <LinearItem label="Ridge" value={measurements.ridge} color="bg-green-500" />
          <LinearItem label="Hip" value={measurements.hip} color="bg-purple-500" />
          <LinearItem label="Valley" value={measurements.valley} color="bg-red-500" />
          <LinearItem label="Perimeter" value={measurements.perimeter} color="bg-blue-500" />
        </div>
      </div>

      <Separator />

      {/* Material Estimates */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Package className="h-4 w-4" />
          Material Estimates
        </h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Shingle Bundles</span>
            <Badge variant="secondary">{shingleBundles}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Ridge Cap</span>
            <Badge variant="secondary">{ridgeCapBundles}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Starter Strip</span>
            <Badge variant="secondary">{starterStrip}</Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

function LinearItem({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 bg-muted/30 rounded px-2 py-1.5">
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="ml-auto font-medium">{Math.round(value)} ft</span>
    </div>
  );
}
