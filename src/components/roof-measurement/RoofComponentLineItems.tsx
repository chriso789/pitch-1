import React, { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Plus, Minus, Package, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DetailedMeasurements {
  facets: { id: string; areaSqFt: number; points: { x: number; y: number }[] }[];
  ridges: { id: string; lengthFt: number; points: { x: number; y: number }[] }[];
  hips: { id: string; lengthFt: number; points: { x: number; y: number }[] }[];
  valleys: { id: string; lengthFt: number; points: { x: number; y: number }[] }[];
  eaves: { id: string; lengthFt: number; points: { x: number; y: number }[] }[];
  rakes: { id: string; lengthFt: number; points: { x: number; y: number }[] }[];
  stepFlashing: { id: string; lengthFt: number; points: { x: number; y: number }[] }[];
  dripEdge: { id: string; lengthFt: number; points: { x: number; y: number }[] }[];
  penetrations: { id: string; type: string; count: number }[];
}

interface LineItemOverride {
  wastePercent?: number;
  quantityOverride?: number;
}

interface RoofComponentLineItemsProps {
  measurements: DetailedMeasurements;
  overrides?: Record<string, LineItemOverride>;
  onOverrideChange?: (componentType: string, override: LineItemOverride) => void;
}

// Manufacturer spec defaults (can be replaced with database specs)
const MATERIAL_SPECS = {
  shingles: { coverage: 33.3, unit: 'bundle', unitCost: 45 }, // 33.3 sq ft per bundle
  starterStrip: { coverage: 105, unit: 'bundle', unitCost: 35 }, // 105 LF per bundle
  ridgeCap: { coverage: 33, unit: 'bundle', unitCost: 55 }, // 33 LF per bundle
  iceWaterShield: { coverage: 66.7, unit: 'roll', unitCost: 85 }, // 66.7 LF per roll
  dripEdge: { coverage: 10, unit: 'piece', unitCost: 8 }, // 10 ft per piece
  valleyMetal: { coverage: 10, unit: 'piece', unitCost: 25 }, // 10 ft per piece
  stepFlashing: { coverage: 1, unit: 'piece', unitCost: 2 }, // 1 per linear foot
  penetrationFlashing: { coverage: 1, unit: 'piece', unitCost: 35 }, // 1 per penetration
};

// Labor rates per unit
const LABOR_RATES = {
  shingles: { rate: 85, unit: 'square', description: 'Shingle installation' },
  starterStrip: { rate: 1.5, unit: 'LF', description: 'Starter strip install' },
  ridgeCap: { rate: 3, unit: 'LF', description: 'Ridge cap install' },
  iceWaterShield: { rate: 1.25, unit: 'LF', description: 'Ice & water install' },
  dripEdge: { rate: 1.5, unit: 'LF', description: 'Drip edge install' },
  valleyMetal: { rate: 2.5, unit: 'LF', description: 'Valley install' },
  stepFlashing: { rate: 4, unit: 'LF', description: 'Step flashing install' },
  penetration: { rate: 45, unit: 'each', description: 'Flashing per penetration' },
  tearOff: { rate: 45, unit: 'square', description: 'Tear-off labor' },
};

interface CalculatedLineItem {
  component: string;
  measured: number;
  measuredUnit: string;
  materialQty: number;
  materialUnit: string;
  materialUnitCost: number;
  materialTotal: number;
  laborQty: number;
  laborUnit: string;
  laborRate: number;
  laborTotal: number;
  color: string;
}

export function RoofComponentLineItems({
  measurements,
  overrides = {},
  onOverrideChange,
}: RoofComponentLineItemsProps) {
  const lineItems = useMemo(() => {
    const items: CalculatedLineItem[] = [];

    // Facets → Shingles
    const totalAreaSqFt = measurements.facets.reduce((sum, f) => sum + f.areaSqFt, 0);
    const totalSquares = totalAreaSqFt / 100;
    const wasteMultiplier = 1 + (overrides.shingles?.wastePercent || 10) / 100;
    const adjustedSquares = totalSquares * wasteMultiplier;

    if (totalAreaSqFt > 0) {
      items.push({
        component: 'Shingles',
        measured: Math.round(totalAreaSqFt),
        measuredUnit: 'sq ft',
        materialQty: Math.ceil(adjustedSquares * 3), // 3 bundles per square
        materialUnit: 'bundles',
        materialUnitCost: MATERIAL_SPECS.shingles.unitCost,
        materialTotal: Math.ceil(adjustedSquares * 3) * MATERIAL_SPECS.shingles.unitCost,
        laborQty: parseFloat(adjustedSquares.toFixed(1)),
        laborUnit: 'squares',
        laborRate: LABOR_RATES.shingles.rate,
        laborTotal: adjustedSquares * LABOR_RATES.shingles.rate,
        color: '#3b82f6',
      });

      // Tear-off labor
      items.push({
        component: 'Tear-Off',
        measured: Math.round(totalAreaSqFt),
        measuredUnit: 'sq ft',
        materialQty: 0,
        materialUnit: '-',
        materialUnitCost: 0,
        materialTotal: 0,
        laborQty: parseFloat(totalSquares.toFixed(1)),
        laborUnit: 'squares',
        laborRate: LABOR_RATES.tearOff.rate,
        laborTotal: totalSquares * LABOR_RATES.tearOff.rate,
        color: '#6b7280',
      });
    }

    // Ridge + Hip → Ridge Cap
    const totalRidge = measurements.ridges.reduce((sum, r) => sum + r.lengthFt, 0);
    const totalHip = measurements.hips.reduce((sum, h) => sum + h.lengthFt, 0);
    const totalRidgeHip = totalRidge + totalHip;
    if (totalRidgeHip > 0) {
      items.push({
        component: 'Ridge Cap',
        measured: Math.round(totalRidgeHip),
        measuredUnit: 'LF',
        materialQty: Math.ceil(totalRidgeHip / MATERIAL_SPECS.ridgeCap.coverage),
        materialUnit: 'bundles',
        materialUnitCost: MATERIAL_SPECS.ridgeCap.unitCost,
        materialTotal: Math.ceil(totalRidgeHip / MATERIAL_SPECS.ridgeCap.coverage) * MATERIAL_SPECS.ridgeCap.unitCost,
        laborQty: Math.round(totalRidgeHip),
        laborUnit: 'LF',
        laborRate: LABOR_RATES.ridgeCap.rate,
        laborTotal: totalRidgeHip * LABOR_RATES.ridgeCap.rate,
        color: '#22c55e',
      });
    }

    // Eaves + Rakes → Starter Strip
    const totalEave = measurements.eaves.reduce((sum, e) => sum + e.lengthFt, 0);
    const totalRake = measurements.rakes.reduce((sum, r) => sum + r.lengthFt, 0);
    const totalStarterLength = totalEave + totalRake;
    if (totalStarterLength > 0) {
      items.push({
        component: 'Starter Strip',
        measured: Math.round(totalStarterLength),
        measuredUnit: 'LF',
        materialQty: Math.ceil(totalStarterLength / MATERIAL_SPECS.starterStrip.coverage),
        materialUnit: 'bundles',
        materialUnitCost: MATERIAL_SPECS.starterStrip.unitCost,
        materialTotal: Math.ceil(totalStarterLength / MATERIAL_SPECS.starterStrip.coverage) * MATERIAL_SPECS.starterStrip.unitCost,
        laborQty: Math.round(totalStarterLength),
        laborUnit: 'LF',
        laborRate: LABOR_RATES.starterStrip.rate,
        laborTotal: totalStarterLength * LABOR_RATES.starterStrip.rate,
        color: '#06b6d4',
      });
    }

    // Valleys → Ice & Water Shield + Valley Metal
    const totalValley = measurements.valleys.reduce((sum, v) => sum + v.lengthFt, 0);
    if (totalValley > 0) {
      items.push({
        component: 'Ice & Water Shield',
        measured: Math.round(totalValley + totalEave * 3), // Valleys + 3ft up from eaves
        measuredUnit: 'LF',
        materialQty: Math.ceil((totalValley + totalEave * 3) / MATERIAL_SPECS.iceWaterShield.coverage),
        materialUnit: 'rolls',
        materialUnitCost: MATERIAL_SPECS.iceWaterShield.unitCost,
        materialTotal: Math.ceil((totalValley + totalEave * 3) / MATERIAL_SPECS.iceWaterShield.coverage) * MATERIAL_SPECS.iceWaterShield.unitCost,
        laborQty: Math.round(totalValley + totalEave * 3),
        laborUnit: 'LF',
        laborRate: LABOR_RATES.iceWaterShield.rate,
        laborTotal: (totalValley + totalEave * 3) * LABOR_RATES.iceWaterShield.rate,
        color: '#ef4444',
      });

      items.push({
        component: 'Valley Metal',
        measured: Math.round(totalValley),
        measuredUnit: 'LF',
        materialQty: Math.ceil(totalValley / MATERIAL_SPECS.valleyMetal.coverage),
        materialUnit: 'pieces',
        materialUnitCost: MATERIAL_SPECS.valleyMetal.unitCost,
        materialTotal: Math.ceil(totalValley / MATERIAL_SPECS.valleyMetal.coverage) * MATERIAL_SPECS.valleyMetal.unitCost,
        laborQty: Math.round(totalValley),
        laborUnit: 'LF',
        laborRate: LABOR_RATES.valleyMetal.rate,
        laborTotal: totalValley * LABOR_RATES.valleyMetal.rate,
        color: '#ef4444',
      });
    }

    // Drip Edge
    const totalDripEdge = measurements.dripEdge.reduce((sum, d) => sum + d.lengthFt, 0);
    const perimeterForDrip = totalDripEdge > 0 ? totalDripEdge : totalEave + totalRake;
    if (perimeterForDrip > 0) {
      items.push({
        component: 'Drip Edge',
        measured: Math.round(perimeterForDrip),
        measuredUnit: 'LF',
        materialQty: Math.ceil(perimeterForDrip / MATERIAL_SPECS.dripEdge.coverage),
        materialUnit: 'pieces',
        materialUnitCost: MATERIAL_SPECS.dripEdge.unitCost,
        materialTotal: Math.ceil(perimeterForDrip / MATERIAL_SPECS.dripEdge.coverage) * MATERIAL_SPECS.dripEdge.unitCost,
        laborQty: Math.round(perimeterForDrip),
        laborUnit: 'LF',
        laborRate: LABOR_RATES.dripEdge.rate,
        laborTotal: perimeterForDrip * LABOR_RATES.dripEdge.rate,
        color: '#14b8a6',
      });
    }

    // Step Flashing
    const totalStepFlashing = measurements.stepFlashing.reduce((sum, s) => sum + s.lengthFt, 0);
    if (totalStepFlashing > 0) {
      items.push({
        component: 'Step Flashing',
        measured: Math.round(totalStepFlashing),
        measuredUnit: 'LF',
        materialQty: Math.ceil(totalStepFlashing), // 1 piece per LF
        materialUnit: 'pieces',
        materialUnitCost: MATERIAL_SPECS.stepFlashing.unitCost,
        materialTotal: Math.ceil(totalStepFlashing) * MATERIAL_SPECS.stepFlashing.unitCost,
        laborQty: Math.round(totalStepFlashing),
        laborUnit: 'LF',
        laborRate: LABOR_RATES.stepFlashing.rate,
        laborTotal: totalStepFlashing * LABOR_RATES.stepFlashing.rate,
        color: '#eab308',
      });
    }

    // Penetrations
    const totalPenetrations = measurements.penetrations.length;
    if (totalPenetrations > 0) {
      items.push({
        component: 'Penetration Flashings',
        measured: totalPenetrations,
        measuredUnit: 'each',
        materialQty: totalPenetrations,
        materialUnit: 'pieces',
        materialUnitCost: MATERIAL_SPECS.penetrationFlashing.unitCost,
        materialTotal: totalPenetrations * MATERIAL_SPECS.penetrationFlashing.unitCost,
        laborQty: totalPenetrations,
        laborUnit: 'each',
        laborRate: LABOR_RATES.penetration.rate,
        laborTotal: totalPenetrations * LABOR_RATES.penetration.rate,
        color: '#ec4899',
      });
    }

    return items;
  }, [measurements, overrides]);

  const totals = useMemo(() => {
    return {
      material: lineItems.reduce((sum, item) => sum + item.materialTotal, 0),
      labor: lineItems.reduce((sum, item) => sum + item.laborTotal, 0),
    };
  }, [lineItems]);

  if (lineItems.length === 0) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground py-8">
          <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>Draw roof components to see material and labor calculations</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="p-4 bg-muted/50 border-b">
        <h3 className="font-semibold flex items-center gap-2">
          <Package className="h-4 w-4" />
          Line Item Calculator
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Real-time material & labor calculations based on manufacturer specs
        </p>
      </div>

      {/* Header */}
      <div className="grid grid-cols-12 gap-2 p-3 bg-muted/30 text-xs font-medium text-muted-foreground border-b">
        <div className="col-span-2">Component</div>
        <div className="col-span-2 text-right">Measured</div>
        <div className="col-span-2 text-right">Material Qty</div>
        <div className="col-span-2 text-right">Mat. Cost</div>
        <div className="col-span-2 text-right">Labor Qty</div>
        <div className="col-span-2 text-right">Labor Cost</div>
      </div>

      {/* Line Items */}
      <div className="divide-y">
        {lineItems.map((item, idx) => (
          <div 
            key={idx} 
            className="grid grid-cols-12 gap-2 p-3 items-center hover:bg-muted/20 transition-colors"
          >
            <div className="col-span-2 flex items-center gap-2">
              <div 
                className="w-2 h-2 rounded-full flex-shrink-0" 
                style={{ backgroundColor: item.color }} 
              />
              <span className="text-sm font-medium truncate">{item.component}</span>
            </div>
            <div className="col-span-2 text-right text-sm">
              {item.measured.toLocaleString()} <span className="text-muted-foreground">{item.measuredUnit}</span>
            </div>
            <div className="col-span-2 text-right text-sm">
              {item.materialQty > 0 ? (
                <>
                  {item.materialQty} <span className="text-muted-foreground">{item.materialUnit}</span>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            <div className="col-span-2 text-right text-sm font-medium">
              {item.materialTotal > 0 ? `$${item.materialTotal.toLocaleString()}` : '—'}
            </div>
            <div className="col-span-2 text-right text-sm">
              {item.laborQty} <span className="text-muted-foreground">{item.laborUnit}</span>
            </div>
            <div className="col-span-2 text-right text-sm font-medium">
              ${item.laborTotal.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="border-t bg-muted/30">
        <div className="grid grid-cols-2 divide-x">
          <div className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Material Subtotal</span>
            </div>
            <div className="text-2xl font-bold text-primary">
              ${totals.material.toLocaleString()}
            </div>
          </div>
          <div className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wrench className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-medium">Labor Subtotal</span>
            </div>
            <div className="text-2xl font-bold text-orange-500">
              ${totals.labor.toLocaleString()}
            </div>
          </div>
        </div>
        <Separator />
        <div className="p-4 flex items-center justify-between">
          <span className="text-lg font-semibold">Total Estimate</span>
          <span className="text-2xl font-bold">
            ${(totals.material + totals.labor).toLocaleString()}
          </span>
        </div>
      </div>
    </Card>
  );
}
