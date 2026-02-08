import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit, Trash2, Calculator } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Template {
  id: string;
  name: string;
  labor: any;
  overhead: any;
  currency: string;
  status: string;
  created_at: string;
}

interface TemplateItem {
  id?: string;
  item_name: string;
  unit: string;
  waste_pct: number;
  unit_cost: number;
  qty_formula: string;
  sort_order: number;
  active: boolean;
}

const TemplateManager: React.FC = () => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [templateItems, setTemplateItems] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [showItemDialog, setShowItemDialog] = useState(false);

  // Manufacturer state
  const [manufacturers, setManufacturers] = useState<{manufacturer: string, product_line: string}[]>([]);

  // Form states
  const [templateForm, setTemplateForm] = useState({
    name: '',
    manufacturer: '',
    product_line: '',
    uses_manufacturer_specs: false,
    labor: {
      rate_per_square: 125,
      complexity: {
        pitch_factor: 1.0,
        stories_factor: 1.0,
        tear_off_factor: 1.0
      }
    },
    overhead: {
      type: 'percent',
      percent: 0.15,
      fixed: 0
    }
  });

  const [itemForm, setItemForm] = useState<TemplateItem>({
    item_name: '',
    unit: 'bundle',
    waste_pct: 0.07,
    unit_cost: 0,
    qty_formula: '',
    sort_order: 0,
    active: true
  });

  useEffect(() => {
    fetchTemplates();
    fetchManufacturers();
  }, []);

  const fetchManufacturers = async () => {
    try {
      const { data, error } = await supabase
        .from('manufacturer_specs' as any)
        .select('manufacturer, product_line')
        .eq('is_active', true);
      
      if (error) throw error;
      
      // Get unique manufacturer/product combinations
      const unique = Array.from(
        new Map(data?.map((item: any) => [`${item.manufacturer}-${item.product_line}`, item])).values()
      ) as any[];
      setManufacturers(unique);
    } catch (error) {
      console.error('Error fetching manufacturers:', error);
    }
  };

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('templates')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      console.error('Error fetching templates:', error);
      toast.error('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const fetchTemplateItems = async (templateId: string) => {
    try {
      const { data, error } = await supabase
        .from('template_items')
        .select('*')
        .eq('template_id', templateId)
        .eq('active', true)
        .order('sort_order');

      if (error) throw error;
      setTemplateItems(data || []);
    } catch (error) {
      console.error('Error fetching template items:', error);
      toast.error('Failed to load template items');
    }
  };

  const createTemplate = async () => {
    try {
      const { data, error } = await supabase.rpc('api_templates_create', {
        p_name: templateForm.name,
        p_labor: templateForm.labor,
        p_overhead: templateForm.overhead,
        p_currency: 'USD'
      });

      if (error) throw error;
      
      toast.success('Template created successfully');
      setShowTemplateDialog(false);
      fetchTemplates();
      resetTemplateForm();
    } catch (error) {
      console.error('Error creating template:', error);
      toast.error('Failed to create template');
    }
  };

  const upsertTemplateItems = async () => {
    if (!selectedTemplate) return;

    try {
      // Convert to the expected JSON format
      const itemsJson = templateItems.map(item => ({
        id: item.id,
        item_name: item.item_name,
        unit: item.unit,
        waste_pct: item.waste_pct,
        unit_cost: item.unit_cost,
        qty_formula: item.qty_formula,
        sort_order: item.sort_order,
        active: item.active
      }));

      await supabase.rpc('api_template_items_upsert', {
        p_template_id: selectedTemplate.id,
        p_items: itemsJson as any
      });

      toast.success('Template items updated successfully');
      setShowItemDialog(false);
    } catch (error) {
      console.error('Error updating template items:', error);
      toast.error('Failed to update template items');
    }
  };

  const resetTemplateForm = () => {
    setTemplateForm({
      name: '',
      manufacturer: '',
      product_line: '',
      uses_manufacturer_specs: false,
      labor: {
        rate_per_square: 125,
        complexity: {
          pitch_factor: 1.0,
          stories_factor: 1.0,
          tear_off_factor: 1.0
        }
      },
      overhead: {
        type: 'percent',
        percent: 0.15,
        fixed: 0
      }
    });
  };

  const addItem = () => {
    setTemplateItems([...templateItems, { ...itemForm, sort_order: templateItems.length }]);
    setItemForm({
      item_name: '',
      unit: 'bundle',
      waste_pct: 0.07,
      unit_cost: 0,
      qty_formula: '',
      sort_order: 0,
      active: true
    });
  };

  const removeItem = (index: number) => {
    setTemplateItems(templateItems.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Template Manager</h2>
        <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Template
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Calculation Template</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Template Name</Label>
                <Input
                  id="name"
                  value={templateForm.name}
                  onChange={(e) => setTemplateForm({...templateForm, name: e.target.value})}
                  placeholder="e.g., Asphalt Shingle Standard"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Manufacturer</Label>
                  <Select
                    value={templateForm.manufacturer}
                    onValueChange={(value) => setTemplateForm({...templateForm, manufacturer: value})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select manufacturer" />
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
                  <Select
                    value={templateForm.product_line}
                    onValueChange={(value) => setTemplateForm({...templateForm, product_line: value})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select product" />
                    </SelectTrigger>
                    <SelectContent>
                      {templateForm.manufacturer === 'GAF' && (
                        <SelectItem value="Timberline HDZ">Timberline HDZ</SelectItem>
                      )}
                      {templateForm.manufacturer === 'Owens Corning' && (
                        <SelectItem value="Duration">Duration</SelectItem>
                      )}
                      {templateForm.manufacturer === 'CertainTeed' && (
                        <SelectItem value="Landmark">Landmark</SelectItem>
                      )}
                      {templateForm.manufacturer === 'TAMKO' && (
                        <SelectItem value="Heritage">Heritage</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div>
                <Label>Labor Rate per Square</Label>
                <Input
                  type="number"
                  value={templateForm.labor.rate_per_square}
                  onChange={(e) => setTemplateForm({
                    ...templateForm,
                    labor: { ...templateForm.labor, rate_per_square: parseFloat(e.target.value) }
                  })}
                />
              </div>

              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setShowTemplateDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={createTemplate}>
                  Create Template
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {templates.map((template) => (
          <Card key={template.id}>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>{template.name}</CardTitle>
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedTemplate(template);
                      fetchTemplateItems(template.id);
                      setShowItemDialog(true);
                    }}
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Items
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium">Labor Rate:</span> ${template.labor?.rate_per_square || 0}/sq
                </div>
                <div>
                  <span className="font-medium">Created:</span> {new Date(template.created_at).toLocaleDateString()}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Template Items Dialog */}
      <Dialog open={showItemDialog} onOpenChange={setShowItemDialog}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Template Items - {selectedTemplate?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-5 gap-2">
              <Input
                placeholder="Item name"
                value={itemForm.item_name}
                onChange={(e) => setItemForm({...itemForm, item_name: e.target.value})}
              />
              <Input
                placeholder="Unit"
                value={itemForm.unit}
                onChange={(e) => setItemForm({...itemForm, unit: e.target.value})}
              />
              <Input
                type="number"
                step="0.01"
                placeholder="Waste %"
                value={itemForm.waste_pct}
                onChange={(e) => setItemForm({...itemForm, waste_pct: parseFloat(e.target.value)})}
              />
              <Input
                type="number"
                step="0.01"
                placeholder="Unit cost"
                value={itemForm.unit_cost}
                onChange={(e) => setItemForm({...itemForm, unit_cost: parseFloat(e.target.value)})}
              />
              <Input
                placeholder="Formula (e.g., roof_area_sqft/100)"
                value={itemForm.qty_formula}
                onChange={(e) => setItemForm({...itemForm, qty_formula: e.target.value})}
              />
            </div>
            <Button onClick={addItem} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Item
            </Button>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Waste %</TableHead>
                  <TableHead>Unit Cost</TableHead>
                  <TableHead>Formula</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templateItems.map((item, index) => (
                  <TableRow key={index}>
                    <TableCell>{item.item_name}</TableCell>
                    <TableCell>{item.unit}</TableCell>
                    <TableCell>{(item.waste_pct * 100).toFixed(1)}%</TableCell>
                    <TableCell>${item.unit_cost.toFixed(2)}</TableCell>
                    <TableCell className="font-mono text-sm">{item.qty_formula}</TableCell>
                    <TableCell>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => removeItem(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setShowItemDialog(false)}>
                Cancel
              </Button>
              <Button onClick={upsertTemplateItems}>
                Save Items
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TemplateManager;