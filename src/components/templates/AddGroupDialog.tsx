import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Package, Wrench } from 'lucide-react';

interface AddGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string, groupType: 'material' | 'labor') => void;
}

export const AddGroupDialog = ({ open, onOpenChange, onAdd }: AddGroupDialogProps) => {
  const [name, setName] = useState('');
  const [groupType, setGroupType] = useState<'material' | 'labor'>('material');

  const handleAdd = () => {
    if (!name.trim()) return;

    onAdd(name.trim(), groupType);

    // Reset form
    setName('');
    setGroupType('material');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Group</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="group-name">Group Name</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Shingles, Underlayment, Labor"
            />
          </div>

          <div className="space-y-3">
            <Label>Group Type</Label>
            <RadioGroup
              value={groupType}
              onValueChange={(v) => setGroupType(v as 'material' | 'labor')}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="material" id="type-material" />
                <Label
                  htmlFor="type-material"
                  className="cursor-pointer flex items-center gap-2"
                >
                  <Package className="h-4 w-4 text-blue-500" />
                  Material
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="labor" id="type-labor" />
                <Label
                  htmlFor="type-labor"
                  className="cursor-pointer flex items-center gap-2"
                >
                  <Wrench className="h-4 w-4 text-purple-500" />
                  Labor
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!name.trim()}>
            Add Group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
