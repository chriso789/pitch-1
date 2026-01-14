import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Calculator, 
  Ruler, 
  Layers, 
  ArrowUpDown,
  Package,
  Loader2,
  CheckCircle
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';
import { 
  PITCH_MULTIPLIERS, 
  getPitchMultiplier, 
  getPitchDescription 
} from '@/utils/pitchDetection';
import { calculateMaterialQuantities, formatMaterialList } from '@/utils/materialCalculations';

interface ManualMeasurementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineEntryId: string;
  onSuccess?: () => void;
}

interface MeasurementFormData {
  areaType: 'flat' | 'pitch_adjusted';
  area: number;
  pitch: string;
  ridges: number;
  hips: number;
  valleys: number;
  eaves: number;
  rakes: number;
  stepFlashing: number;
  wallFlashing: number;
  facets: number;
  wastePercentage: number;
}

const WASTE_OPTIONS = [
  { value: 10, label: '10% - Standard' },
  { value: 12, label: '12% - Complex' },
  { value: 15, label: '15% - Cut-up' },
  { value: 17, label: '17% - Very Cut-up' },
  { value: 20, label: '20% - Extreme' },
];

const PITCH_OPTIONS = Object.keys(PITCH_MULTIPLIERS).filter(p => p !== 'flat');

const QUICK_PRESETS = [
  { name: 'Small Ranch', area: 1200, ridges: 40, eaves: 120, rakes: 60 },
  { name: 'Medium Ranch', area: 1800, ridges: 55, eaves: 160, rakes: 80 },
  { name: 'Large Colonial', area: 2500, ridges: 70, eaves: 180, rakes: 100 },
  { name: 'Large Hip Roof', area: 3000, ridges: 30, hips: 80, eaves: 200, rakes: 40 },
];

export const ManualMeasurementDialog: React.FC<ManualMeasurementDialogProps> = ({
  open,
  onOpenChange,
  pipelineEntryId,
  onSuccess,
}) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<MeasurementFormData>({
    areaType: 'pitch_adjusted',
    area: 0,
    pitch: '6/12',
    ridges: 0,
    hips: 0,
    valleys: 0,
    eaves: 0,
    rakes: 0,
    stepFlashing: 0,
    wallFlashing: 0,
    facets: 1,
    wastePercentage: 10,
  });

  // Calculate adjusted area based on type
  const getAdjustedArea = () => {
    if (formData.areaType === 'pitch_adjusted') {
      return formData.area;
    }
    const multiplier = getPitchMultiplier(formData.pitch);
    return formData.area * multiplier;
  };

  const getFlatArea = () => {
    if (formData.areaType === 'flat') {
      return formData.area;
    }
    const multiplier = getPitchMultiplier(formData.pitch);
    return formData.area / multiplier;
  };

  // Calculate perimeter (eaves + rakes)
  const getPerimeter = () => formData.eaves + formData.rakes;

  // Calculate materials preview
  const getMaterialPreview = () => {
    const adjustedArea = getAdjustedArea();
    if (adjustedArea <= 0) return null;

    const perimeter = getPerimeter();
    const measurements = {
      totalArea: adjustedArea,
      perimeter: perimeter,
      ridgeLength: formData.ridges,
      hipLength: formData.hips,
      valleyLength: formData.valleys,
      eaveLength: formData.eaves,
      rakeLength: formData.rakes,
      wastePercentage: formData.wastePercentage,
    };

    return calculateMaterialQuantities(measurements);
  };

  const handleInputChange = (field: keyof MeasurementFormData, value: number | string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const applyPreset = (preset: typeof QUICK_PRESETS[0]) => {
    setFormData(prev => ({
      ...prev,
      area: preset.area,
      ridges: preset.ridges,
      eaves: preset.eaves,
      rakes: preset.rakes,
      hips: preset.hips || 0,
    }));
  };

  const handleSave = async () => {
    const adjustedArea = getAdjustedArea();
    const flatArea = getFlatArea();

    if (adjustedArea <= 0) {
      toast({
        title: 'Invalid Measurements',
        description: 'Please enter a roof area greater than 0',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      // Get current pipeline metadata
      const { data: pipelineData, error: fetchError } = await supabase
        .from('pipeline_entries')
        .select('metadata, tenant_id')
        .eq('id', pipelineEntryId)
        .single();

      if (fetchError) throw fetchError;

      const currentMetadata = (pipelineData?.metadata as Record<string, any>) || {};

      // Update metadata with manual measurements
      const updatedMetadata = {
        ...currentMetadata,
        roof_area_sq_ft: adjustedArea,
        comprehensive_measurements: {
          total_area_sqft: adjustedArea,
          flat_area_sqft: flatArea,
          pitched_area_sqft: adjustedArea,
          pitch: formData.pitch,
          ridges_lf: formData.ridges,
          hips_lf: formData.hips,
          valleys_lf: formData.valleys,
          eaves_lf: formData.eaves,
          rakes_lf: formData.rakes,
          step_flashing_lf: formData.stepFlashing,
          wall_flashing_lf: formData.wallFlashing,
          drip_edge_lf: formData.eaves + formData.rakes,
          facets_count: formData.facets,
          waste_percentage: formData.wastePercentage,
        },
        measurement_source: 'manual_entry',
        measurement_date: new Date().toISOString(),
      };

      // Update pipeline entry
      const { error: updateError } = await supabase
        .from('pipeline_entries')
        .update({ metadata: updatedMetadata })
        .eq('id', pipelineEntryId);

      if (updateError) throw updateError;

      toast({
        title: 'Measurements Saved',
        description: `${adjustedArea.toLocaleString()} sq ft with ${formData.pitch} pitch saved successfully`,
      });

      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving measurements:', error);
      toast({
        title: 'Error',
        description: 'Failed to save measurements. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const materialPreview = getMaterialPreview();
  const formattedMaterials = materialPreview ? formatMaterialList(materialPreview) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ruler className="h-5 w-5 text-primary" />
            Manual Measurement Entry
          </DialogTitle>
          <DialogDescription>
            Enter roof measurements manually when AI measurement fails or you have data from another source
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Form */}
          <div className="space-y-6">
            {/* Quick Presets */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Quick Presets</Label>
              <div className="flex flex-wrap gap-2">
                {QUICK_PRESETS.map(preset => (
                  <Button
                    key={preset.name}
                    variant="outline"
                    size="sm"
                    onClick={() => applyPreset(preset)}
                    className="text-xs"
                  >
                    {preset.name}
                  </Button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Roof Area */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <Layers className="h-4 w-4" />
                  Roof Area
                </Label>
                <Select
                  value={formData.areaType}
                  onValueChange={(v) => handleInputChange('areaType', v as 'flat' | 'pitch_adjusted')}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pitch_adjusted">Pitch-Adjusted</SelectItem>
                    <SelectItem value="flat">Flat (Footprint)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={formData.area || ''}
                  onChange={(e) => handleInputChange('area', parseFloat(e.target.value) || 0)}
                  placeholder="Enter sq ft"
                  className="flex-1"
                />
                <span className="flex items-center text-sm text-muted-foreground">sq ft</span>
              </div>
              {formData.area > 0 && (
                <div className="text-sm text-muted-foreground">
                  {formData.areaType === 'flat' ? (
                    <>Pitch-adjusted: {getAdjustedArea().toLocaleString()} sq ft</>
                  ) : (
                    <>Footprint: {getFlatArea().toLocaleString()} sq ft</>
                  )}
                </div>
              )}
            </div>

            {/* Pitch */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <ArrowUpDown className="h-4 w-4" />
                Roof Pitch
              </Label>
              <Select
                value={formData.pitch}
                onValueChange={(v) => handleInputChange('pitch', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PITCH_OPTIONS.map(pitch => (
                    <SelectItem key={pitch} value={pitch}>
                      {getPitchDescription(pitch)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">
                Multiplier: {getPitchMultiplier(formData.pitch).toFixed(3)}x
              </div>
            </div>

            <Separator />

            {/* Linear Measurements */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Linear Measurements (LF)</Label>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Ridge</Label>
                  <Input
                    type="number"
                    value={formData.ridges || ''}
                    onChange={(e) => handleInputChange('ridges', parseFloat(e.target.value) || 0)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Hip</Label>
                  <Input
                    type="number"
                    value={formData.hips || ''}
                    onChange={(e) => handleInputChange('hips', parseFloat(e.target.value) || 0)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Valley</Label>
                  <Input
                    type="number"
                    value={formData.valleys || ''}
                    onChange={(e) => handleInputChange('valleys', parseFloat(e.target.value) || 0)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Eave</Label>
                  <Input
                    type="number"
                    value={formData.eaves || ''}
                    onChange={(e) => handleInputChange('eaves', parseFloat(e.target.value) || 0)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Rake</Label>
                  <Input
                    type="number"
                    value={formData.rakes || ''}
                    onChange={(e) => handleInputChange('rakes', parseFloat(e.target.value) || 0)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Step Flashing</Label>
                  <Input
                    type="number"
                    value={formData.stepFlashing || ''}
                    onChange={(e) => handleInputChange('stepFlashing', parseFloat(e.target.value) || 0)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Wall Flashing</Label>
                  <Input
                    type="number"
                    value={formData.wallFlashing || ''}
                    onChange={(e) => handleInputChange('wallFlashing', parseFloat(e.target.value) || 0)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Facet Count</Label>
                  <Input
                    type="number"
                    value={formData.facets || ''}
                    onChange={(e) => handleInputChange('facets', parseInt(e.target.value) || 1)}
                    placeholder="1"
                    min={1}
                  />
                </div>
              </div>
            </div>

            {/* Waste Factor */}
            <div className="space-y-2">
              <Label>Waste Factor</Label>
              <Select
                value={formData.wastePercentage.toString()}
                onValueChange={(v) => handleInputChange('wastePercentage', parseInt(v))}
              >
                <SelectTrigger>
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

          {/* Right Column - Preview */}
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-muted/50 border">
              <h4 className="font-medium flex items-center gap-2 mb-3">
                <Calculator className="h-4 w-4 text-primary" />
                Calculated Summary
              </h4>
              
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Pitch-Adjusted Area:</span>
                  <span className="font-medium">{getAdjustedArea().toLocaleString()} sq ft</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Squares:</span>
                  <span className="font-medium">{(getAdjustedArea() / 100).toFixed(1)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Drip Edge:</span>
                  <span className="font-medium">{(formData.eaves + formData.rakes).toLocaleString()} LF</span>
                </div>
              </div>
            </div>

            {formattedMaterials.length > 0 && (
              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                <h4 className="font-medium flex items-center gap-2 mb-3">
                  <Package className="h-4 w-4 text-primary" />
                  Material Preview
                </h4>
                
                <div className="space-y-1.5">
                  {formattedMaterials.slice(0, 6).map((mat, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{mat.item}:</span>
                      <span className="font-medium">
                        {mat.quantity} {mat.unit}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-3 pt-2 border-t">
                  <Badge variant="secondary" className="text-xs">
                    Includes {formData.wastePercentage}% waste
                  </Badge>
                </div>
              </div>
            )}

            {getAdjustedArea() > 0 && (
              <div className="p-3 rounded-lg bg-success/10 border border-success/30">
                <div className="flex items-center gap-2 text-sm text-success">
                  <CheckCircle className="h-4 w-4" />
                  Ready to save measurements
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || getAdjustedArea() <= 0}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Save Measurements
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
