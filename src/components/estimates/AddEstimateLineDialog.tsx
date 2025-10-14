import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Search, Package, Wrench, Plus, Calculator } from "lucide-react";

interface Material {
  id: string;
  code: string;
  name: string;
  uom: string;
  category_id: string;
  coverage_per_unit: number;
  default_markup_pct: number;
  tags: string[];
}

interface FormulaPreset {
  name: string;
  formula: string;
  description: string;
  uom: string;
}

interface AddEstimateLineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddLine: (line: {
    item_name: string;
    description: string;
    quantity: number;
    unit_cost: number;
    unit_type: string;
    markup_percent: number;
    formula?: string;
    material_id?: string;
  }) => void;
  measurements?: {
    surface_area_sf?: number;
    surface_squares?: number;
    perimeter_lf?: number;
    ridge_lf?: number;
    valley_lf?: number;
    hip_lf?: number;
    rake_lf?: number;
    eave_lf?: number;
  };
}

const FORMULA_PRESETS: FormulaPreset[] = [
  {
    name: "Shingles (Squares)",
    formula: "{{ measure.surface_squares }} * 1.10",
    description: "Total squares + 10% waste",
    uom: "SQ"
  },
  {
    name: "Underlayment (SF)",
    formula: "{{ measure.surface_area_sf }} * 1.05",
    description: "Total area + 5% overlap",
    uom: "SF"
  },
  {
    name: "Ridge Cap (LF)",
    formula: "{{ measure.ridge_lf }} * 1.00",
    description: "Ridge length",
    uom: "LF"
  },
  {
    name: "Valley Metal (LF)",
    formula: "{{ measure.valley_lf }} * 1.00",
    description: "Valley length",
    uom: "LF"
  },
  {
    name: "Starter Shingles (LF)",
    formula: "{{ measure.perimeter_lf }} * 1.00",
    description: "Perimeter length",
    uom: "LF"
  },
  {
    name: "Drip Edge (LF)",
    formula: "{{ measure.rake_lf }} + {{ measure.eave_lf }}",
    description: "Rake + Eave lengths",
    uom: "LF"
  }
];

export function AddEstimateLineDialog({
  open,
  onOpenChange,
  onAddLine,
  measurements = {}
}: AddEstimateLineDialogProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
  const [lineType, setLineType] = useState<"material" | "labor">("material");
  const [useFormula, setUseFormula] = useState(false);
  
  const [formData, setFormData] = useState({
    quantity: 0,
    unit_cost: 0,
    markup_percent: 15,
    formula: "",
    description: ""
  });

  useEffect(() => {
    if (searchQuery.length >= 2) {
      searchMaterials();
    } else {
      setMaterials([]);
    }
  }, [searchQuery]);

  const searchMaterials = async () => {
    setSearching(true);
    try {
      const { data, error } = await supabase.rpc("api_materials_search" as any, {
        q: searchQuery,
        lim: 20
      });

      if (error) throw error;
      setMaterials((data || []) as unknown as Material[]);
    } catch (error: any) {
      console.error("Search error:", error);
    } finally {
      setSearching(false);
    }
  };

  const selectMaterial = (material: Material) => {
    setSelectedMaterial(material);
    setFormData(prev => ({
      ...prev,
      unit_cost: 0,
      markup_percent: (material.default_markup_pct || 0.15) * 100,
      description: material.name
    }));
  };

  const applyPreset = (preset: FormulaPreset) => {
    setFormData(prev => ({
      ...prev,
      formula: preset.formula
    }));
    setUseFormula(true);
    
    // Calculate quantity from formula
    const calculatedQty = evaluateFormula(preset.formula, measurements);
    if (calculatedQty > 0) {
      setFormData(prev => ({ ...prev, quantity: calculatedQty }));
    }
  };

  const evaluateFormula = (formula: string, measures: any): number => {
    try {
      let expr = formula;
      // Replace measurement variables
      expr = expr.replace(/\{\{\s*measure\.(\w+)\s*\}\}/g, (_, key) => {
        return String(measures[key] || 0);
      });
      // Simple eval - in production use a proper formula parser
      return eval(expr) || 0;
    } catch {
      return 0;
    }
  };

  const handleFormulaChange = (formula: string) => {
    setFormData(prev => ({ ...prev, formula }));
    const calculatedQty = evaluateFormula(formula, measurements);
    if (calculatedQty > 0) {
      setFormData(prev => ({ ...prev, quantity: calculatedQty }));
    }
  };

  const handleAddLine = () => {
    if (!selectedMaterial) {
      toast({
        title: "Select Material",
        description: "Please select a material from search results",
        variant: "destructive"
      });
      return;
    }

    if (formData.quantity <= 0) {
      toast({
        title: "Invalid Quantity",
        description: "Quantity must be greater than 0",
        variant: "destructive"
      });
      return;
    }

    onAddLine({
      item_name: selectedMaterial.name,
      description: formData.description || selectedMaterial.name,
      quantity: formData.quantity,
      unit_cost: formData.unit_cost,
      unit_type: selectedMaterial.uom.toLowerCase(),
      markup_percent: formData.markup_percent,
      formula: useFormula ? formData.formula : undefined,
      material_id: selectedMaterial.id
    });

    // Reset form
    setSelectedMaterial(null);
    setSearchQuery("");
    setFormData({
      quantity: 0,
      unit_cost: 0,
      markup_percent: 15,
      formula: "",
      description: ""
    });
    setUseFormula(false);
    onOpenChange(false);

    toast({
      title: "Line Added",
      description: "Estimate line item added successfully"
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Add Estimate Line Item</DialogTitle>
        </DialogHeader>

        <Tabs value={lineType} onValueChange={(v) => setLineType(v as any)} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="material">
              <Package className="h-4 w-4 mr-2" />
              Material
            </TabsTrigger>
            <TabsTrigger value="labor">
              <Wrench className="h-4 w-4 mr-2" />
              Labor
            </TabsTrigger>
          </TabsList>

          <TabsContent value="material" className="space-y-4 mt-4">
            {/* Search Materials */}
            <div className="space-y-2">
              <Label>Search Materials</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, code, or tags..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Search Results */}
            {materials.length > 0 && (
              <ScrollArea className="h-48 border rounded-lg">
                <div className="p-2 space-y-1">
                  {materials.map((material) => (
                    <button
                      key={material.id}
                      onClick={() => selectMaterial(material)}
                      className={`w-full text-left p-3 rounded-lg hover:bg-accent transition-colors ${
                        selectedMaterial?.id === material.id ? 'bg-accent' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">{material.name}</div>
                          <div className="text-sm text-muted-foreground">
                            Code: {material.code} • UOM: {material.uom} • Markup: {(material.default_markup_pct * 100).toFixed(1)}%
                          </div>
                        </div>
                        {material.tags && material.tags.length > 0 && (
                          <div className="flex gap-1">
                            {material.tags.slice(0, 2).map((tag, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}

            {/* Selected Material Form */}
            {selectedMaterial && (
              <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{selectedMaterial.name}</h3>
                    <p className="text-sm text-muted-foreground">{selectedMaterial.code}</p>
                  </div>
                  <Badge>{selectedMaterial.uom}</Badge>
                </div>

                {/* Formula Toggle */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="use-formula"
                    checked={useFormula}
                    onChange={(e) => setUseFormula(e.target.checked)}
                    className="rounded"
                  />
                  <Label htmlFor="use-formula" className="cursor-pointer">
                    Use Formula (Auto-calculate from measurements)
                  </Label>
                </div>

                {useFormula ? (
                  <>
                    {/* Formula Presets */}
                    <div className="space-y-2">
                      <Label>Quick Presets</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {FORMULA_PRESETS.map((preset) => (
                          <Button
                            key={preset.name}
                            variant="outline"
                            size="sm"
                            onClick={() => applyPreset(preset)}
                            className="justify-start text-left h-auto py-2"
                          >
                            <div>
                              <div className="font-medium text-xs">{preset.name}</div>
                              <div className="text-xs text-muted-foreground">{preset.description}</div>
                            </div>
                          </Button>
                        ))}
                      </div>
                    </div>

                    {/* Formula Editor */}
                    <div className="space-y-2">
                      <Label>Formula</Label>
                      <Input
                        value={formData.formula}
                        onChange={(e) => handleFormulaChange(e.target.value)}
                        placeholder="{{ measure.surface_squares }} * 1.10"
                      />
                      <p className="text-xs text-muted-foreground">
                        Available: surface_area_sf, surface_squares, perimeter_lf, ridge_lf, valley_lf, hip_lf, rake_lf, eave_lf
                      </p>
                    </div>

                    <div className="flex items-center gap-2 text-sm">
                      <Calculator className="h-4 w-4 text-primary" />
                      <span className="font-medium">Calculated Quantity:</span>
                      <span className="font-bold text-primary">{formData.quantity.toFixed(2)}</span>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      value={formData.quantity}
                      onChange={(e) => setFormData(prev => ({ ...prev, quantity: parseFloat(e.target.value) || 0 }))}
                      step="0.01"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Unit Cost</Label>
                    <Input
                      type="number"
                      value={formData.unit_cost}
                      onChange={(e) => setFormData(prev => ({ ...prev, unit_cost: parseFloat(e.target.value) || 0 }))}
                      step="0.01"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Markup %</Label>
                    <Input
                      type="number"
                      value={formData.markup_percent}
                      onChange={(e) => setFormData(prev => ({ ...prev, markup_percent: parseFloat(e.target.value) || 0 }))}
                      step="0.1"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Description (Optional)</Label>
                  <Input
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder={selectedMaterial.name}
                  />
                </div>

                <Button onClick={handleAddLine} className="w-full">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Line Item
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="labor" className="space-y-4 mt-4">
            <div className="p-8 text-center text-muted-foreground">
              <Wrench className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Labor line items coming soon...</p>
              <p className="text-sm mt-2">Will support role selection, hourly rates, and formula-based calculations</p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
