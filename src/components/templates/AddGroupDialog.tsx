import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Layers } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Package, Wrench } from 'lucide-react';

interface AddGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string, groupType: 'material' | 'labor' | 'turnkey') => void;
}

export const AddGroupDialog = ({ open, onOpenChange, onAdd }: AddGroupDialogProps) => {
  const [name, setName] = useState('');
  const [groupType, setGroupType] = useState<'material' | 'labor' | 'turnkey'>('material');

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
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'material', label: 'Material', icon: Package, color: 'text-blue-500' },
                { value: 'labor', label: 'Labor', icon: Wrench, color: 'text-purple-500' },
                { value: 'turnkey', label: 'Turnkey', icon: Layers, color: 'text-emerald-500' },
              ].map(({ value, label, icon: Icon, color }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setGroupType(value as 'material' | 'labor' | 'turnkey')}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 text-sm font-medium transition-colors',
                    groupType === value
                      ? 'border-primary bg-primary/5'
                      : 'border-muted hover:border-muted-foreground/30'
                  )}
                >
                  <Icon className={cn('h-5 w-5', color)} />
                  {label}
                </button>
              ))}
            </div>
            {groupType === 'turnkey' && (
              <p className="text-xs text-muted-foreground">
                Material &amp; labor bundled into one price per item.
              </p>
            )}
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
