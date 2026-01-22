import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Package, Wrench, Search, Save } from 'lucide-react';
import { MaterialBrowser } from './MaterialBrowser';

interface AddItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (item: {
    name: string;
    item_type: 'material' | 'labor';
    unit: string;
    unit_cost: number;
    sku?: string;
    material_id?: string;
    coverage_per_unit?: number;
    sections?: string[];
    saveToCatalog?: boolean;
  }) => void;
}

const UNITS = ['SQ', 'LF', 'EA', 'BX', 'RL', 'BDL', 'GAL', 'PC', 'LB'];

const SECTION_OPTIONS = [
  { value: 'roof', label: 'Roofing' },
  { value: 'gutter', label: 'Gutters' },
  { value: 'exterior', label: 'Exterior' },
  { value: 'interior', label: 'Interior' },
  { value: 'labor', label: 'Labor' },
];

export const AddItemDialog = ({ open, onOpenChange, onAdd }: AddItemDialogProps) => {
  const [tab, setTab] = useState<'catalog' | 'custom'>('catalog');
  const [itemType, setItemType] = useState<'material' | 'labor'>('material');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('EA');
  const [unitCost, setUnitCost] = useState('');
  const [sku, setSku] = useState('');
  const [sections, setSections] = useState<string[]>(['roof']);
  const [saveToCatalog, setSaveToCatalog] = useState(false);

  const handleMaterialSelect = (material: any) => {
    onAdd({
      name: material.name,
      item_type: 'material',
      unit: material.uom,
      unit_cost: material.base_cost,
      sku: material.code,
      material_id: material.id,
      coverage_per_unit: material.coverage_per_unit,
    });
    resetForm();
    onOpenChange(false);
  };

  const handleCustomAdd = () => {
    if (!name.trim()) return;

    onAdd({
      name: name.trim(),
      item_type: itemType,
      unit,
      unit_cost: parseFloat(unitCost) || 0,
      sku: sku || undefined,
      sections: sections.length > 0 ? sections : undefined,
      saveToCatalog: itemType === 'material' ? saveToCatalog : undefined,
    });

    resetForm();
    onOpenChange(false);
  };

  const resetForm = () => {
    setName('');
    setUnit('EA');
    setUnitCost('');
    setSku('');
    setItemType('material');
    setSections(['roof']);
    setSaveToCatalog(false);
  };

  const handleSectionToggle = (sectionValue: string, checked: boolean) => {
    if (checked) {
      setSections([...sections, sectionValue]);
    } else {
      setSections(sections.filter(s => s !== sectionValue));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Item</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'catalog' | 'custom')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="catalog" className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              Browse Catalog
            </TabsTrigger>
            <TabsTrigger value="custom" className="flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              Custom Item
            </TabsTrigger>
          </TabsList>

          <TabsContent value="catalog" className="mt-4">
            <MaterialBrowser onSelect={handleMaterialSelect} />
          </TabsContent>

          <TabsContent value="custom" className="mt-4 space-y-4">
            <Tabs value={itemType} onValueChange={(v) => setItemType(v as 'material' | 'labor')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="material" className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Material
                </TabsTrigger>
                <TabsTrigger value="labor" className="flex items-center gap-2">
                  <Wrench className="h-4 w-4" />
                  Labor
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="space-y-2">
              <Label>{itemType === 'material' ? 'Material Name' : 'Labor Description'}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={itemType === 'material' ? 'e.g., Architectural Shingles' : 'e.g., Shingle Installation'}
              />
            </div>

            {itemType === 'material' && (
              <div className="space-y-2">
                <Label>SKU (Optional)</Label>
                <Input
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="e.g., SRS-GAF-HDZ-001"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Unit</Label>
                <Select value={unit} onValueChange={setUnit}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Unit Cost</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    type="number"
                    step="0.01"
                    value={unitCost}
                    onChange={(e) => setUnitCost(e.target.value)}
                    className="pl-7"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>

            {/* Section Assignment */}
            <div className="space-y-2">
              <Label>Assign to Sections</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-2 p-3 border rounded-md bg-muted/30">
                {SECTION_OPTIONS.map((section) => (
                  <label key={section.value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={sections.includes(section.value)}
                      onCheckedChange={(checked) => handleSectionToggle(section.value, !!checked)}
                    />
                    <span>{section.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Select which sections this item should appear in
              </p>
            </div>

            {/* Save to Catalog Option - Only for materials */}
            {itemType === 'material' && (
              <div className="flex items-start gap-3 p-3 border rounded-md bg-primary/5 border-primary/20">
                <Checkbox
                  id="save-to-catalog"
                  checked={saveToCatalog}
                  onCheckedChange={(checked) => setSaveToCatalog(!!checked)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <label htmlFor="save-to-catalog" className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                    <Save className="h-4 w-4 text-primary" />
                    Save to company catalog
                  </label>
                  <p className="text-xs text-muted-foreground mt-1">
                    This material will be available in the catalog for use in other estimate templates
                  </p>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleCustomAdd} disabled={!name.trim()}>
                Add {itemType === 'material' ? 'Material' : 'Labor'}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
