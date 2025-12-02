import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Package, Wrench } from 'lucide-react';

interface AddItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (item: {
    name: string;
    item_type: 'material' | 'labor';
    unit: string;
    unit_cost: number;
  }) => void;
}

const UNITS = ['SQ', 'LF', 'EA', 'BX', 'RL', 'BDL', 'GAL', 'PC'];

export const AddItemDialog = ({ open, onOpenChange, onAdd }: AddItemDialogProps) => {
  const [itemType, setItemType] = useState<'material' | 'labor'>('material');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('EA');
  const [unitCost, setUnitCost] = useState('');

  const handleAdd = () => {
    if (!name.trim()) return;

    onAdd({
      name: name.trim(),
      item_type: itemType,
      unit,
      unit_cost: parseFloat(unitCost) || 0,
    });

    // Reset form
    setName('');
    setUnit('EA');
    setUnitCost('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Item</DialogTitle>
        </DialogHeader>

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

          <TabsContent value="material" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="material-name">Material Name</Label>
              <Input
                id="material-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Architectural Shingles"
              />
            </div>
          </TabsContent>

          <TabsContent value="labor" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="labor-name">Labor Description</Label>
              <Input
                id="labor-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Shingle Installation"
              />
            </div>
          </TabsContent>
        </Tabs>

        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="space-y-2">
            <Label>Unit</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="unit-cost">Cost</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                $
              </span>
              <Input
                id="unit-cost"
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

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!name.trim()}>
            Add {itemType === 'material' ? 'Material' : 'Labor'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
