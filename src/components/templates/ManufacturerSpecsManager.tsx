import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit, Trash2, Factory } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

interface ManufacturerSpec {
  id: string;
  manufacturer: string;
  product_line: string;
  product_type: string;
  coverage_specs: any;
  waste_factor_default: number;
  material_formulas: any;
  is_active: boolean;
}

const ManufacturerSpecsManager: React.FC = () => {
  const [specs, setSpecs] = useState<ManufacturerSpec[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [editingSpec, setEditingSpec] = useState<ManufacturerSpec | null>(null);

  const [form, setForm] = useState({
    manufacturer: 'GAF',
    product_line: 'Timberline HDZ',
    product_type: 'shingles',
    coverage_value: 3,
    waste_factor_default: 10,
    formula: "ceil(roof.squares * 1.10) * 3"
  });

  useEffect(() => {
    fetchSpecs();
  }, []);

  const fetchSpecs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('manufacturer_specs' as any)
        .select('*')
        .eq('is_active', true)
        .order('manufacturer, product_line, product_type');

      if (error) throw error;
      setSpecs((data || []) as any[]);
    } catch (error) {
      console.error('Error fetching specs:', error);
      toast.error('Failed to load manufacturer specifications');
    } finally {
      setLoading(false);
    }
  };

  const saveSpec = async () => {
    try {
      const coverageSpecs = form.product_type === 'shingles' 
        ? { bundles_per_square: form.coverage_value }
        : form.product_type === 'ridge_cap' || form.product_type === 'starter_strip'
        ? { linear_ft_per_bundle: form.coverage_value, coverage_per_bundle: form.coverage_value }
        : { linear_ft_per_roll: form.coverage_value };

      const materialFormulas = {
        formula: form.formula,
        description: `Coverage calculation for ${form.product_type}`
      };

      const { error } = await supabase
        .from('manufacturer_specs' as any)
        .insert({
          manufacturer: form.manufacturer,
          product_line: form.product_line,
          product_type: form.product_type,
          coverage_specs: coverageSpecs,
          waste_factor_default: form.waste_factor_default,
          material_formulas: materialFormulas,
          is_active: true
        });

      if (error) throw error;

      toast.success('Specification saved successfully');
      fetchSpecs();
      setShowDialog(false);
      resetForm();
    } catch (error: any) {
      console.error('Error saving spec:', error);
      toast.error(error.message || 'Failed to save specification');
    }
  };

  const deleteSpec = async (id: string) => {
    if (!confirm('Delete this specification?')) return;

    try {
      const { error } = await supabase
        .from('manufacturer_specs' as any)
        .update({ is_active: false })
        .eq('id', id);

      if (error) throw error;

      toast.success('Specification deleted');
      fetchSpecs();
    } catch (error) {
      console.error('Error deleting spec:', error);
      toast.error('Failed to delete specification');
    }
  };

  const resetForm = () => {
    setForm({
      manufacturer: 'GAF',
      product_line: 'Timberline HDZ',
      product_type: 'shingles',
      coverage_value: 3,
      waste_factor_default: 10,
      formula: "ceil(roof.squares * 1.10) * 3"
    });
    setEditingSpec(null);
  };

  const getProductTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      shingles: 'Shingles',
      ridge_cap: 'Ridge Cap',
      starter_strip: 'Starter Strip',
      valley: 'Valley',
      ice_water: 'Ice & Water Shield'
    };
    return labels[type] || type;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Factory className="h-6 w-6" />
          <h2 className="text-2xl font-bold">Manufacturer Specifications</h2>
        </div>
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Specification
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add Manufacturer Specification</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Manufacturer</Label>
                  <Select
                    value={form.manufacturer}
                    onValueChange={(value) => setForm({...form, manufacturer: value})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GAF">GAF</SelectItem>
                      <SelectItem value="Owens Corning">Owens Corning</SelectItem>
                      <SelectItem value="CertainTeed">CertainTeed</SelectItem>
                      <SelectItem value="TAMKO">TAMKO</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Product Line</Label>
                  <Input
                    value={form.product_line}
                    onChange={(e) => setForm({...form, product_line: e.target.value})}
                    placeholder="e.g., Timberline HDZ"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Product Type</Label>
                  <Select
                    value={form.product_type}
                    onValueChange={(value) => setForm({...form, product_type: value})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shingles">Shingles</SelectItem>
                      <SelectItem value="ridge_cap">Ridge Cap</SelectItem>
                      <SelectItem value="starter_strip">Starter Strip</SelectItem>
                      <SelectItem value="valley">Valley</SelectItem>
                      <SelectItem value="ice_water">Ice & Water Shield</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Coverage Value</Label>
                  <Input
                    type="number"
                    value={form.coverage_value}
                    onChange={(e) => setForm({...form, coverage_value: parseFloat(e.target.value)})}
                    placeholder={form.product_type === 'shingles' ? 'Bundles per square' : 'Linear ft per bundle/roll'}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {form.product_type === 'shingles' ? 'Bundles per square' : 'Linear feet per bundle/roll'}
                  </p>
                </div>
              </div>

              <div>
                <Label>Waste Factor (%)</Label>
                <Input
                  type="number"
                  value={form.waste_factor_default}
                  onChange={(e) => setForm({...form, waste_factor_default: parseFloat(e.target.value)})}
                />
              </div>

              <div>
                <Label>Formula</Label>
                <Input
                  value={form.formula}
                  onChange={(e) => setForm({...form, formula: e.target.value})}
                  placeholder="e.g., ceil(roof.squares * 1.10) * 3"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Available tags: roof.squares, lf.ridge, lf.hip, lf.eave, lf.rake, lf.valley
                </p>
              </div>

              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => { setShowDialog(false); resetForm(); }}>
                  Cancel
                </Button>
                <Button onClick={saveSpec}>
                  Save Specification
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current Specifications</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-8 text-muted-foreground">Loading specifications...</p>
          ) : specs.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No specifications found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Manufacturer</TableHead>
                  <TableHead>Product Line</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Coverage</TableHead>
                  <TableHead>Waste %</TableHead>
                  <TableHead>Formula</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {specs.map((spec) => (
                  <TableRow key={spec.id}>
                    <TableCell className="font-medium">{spec.manufacturer}</TableCell>
                    <TableCell>{spec.product_line}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{getProductTypeLabel(spec.product_type)}</Badge>
                    </TableCell>
                    <TableCell>
                      {spec.coverage_specs?.bundles_per_square && `${spec.coverage_specs.bundles_per_square} bundles/sq`}
                      {spec.coverage_specs?.linear_ft_per_bundle && `${spec.coverage_specs.linear_ft_per_bundle} lf/bundle`}
                      {spec.coverage_specs?.linear_ft_per_roll && `${spec.coverage_specs.linear_ft_per_roll} lf/roll`}
                    </TableCell>
                    <TableCell>{spec.waste_factor_default}%</TableCell>
                    <TableCell className="font-mono text-xs max-w-[200px] truncate">
                      {spec.material_formulas?.formula}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteSpec(spec.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ManufacturerSpecsManager;
