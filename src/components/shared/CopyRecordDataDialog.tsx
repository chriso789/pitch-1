import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';

import { Copy, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { useToast } from '@/hooks/use-toast';

interface CopyRecordDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: 'contact' | 'job';
  targetId: string;
  onCopied?: () => void;
}

const COPYABLE_FIELDS = {
  contact: [
    { key: 'first_name', label: 'First Name' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'address_street', label: 'Street' },
    { key: 'address_city', label: 'City' },
    { key: 'address_state', label: 'State' },
    { key: 'address_zip', label: 'ZIP' },
    { key: 'notes', label: 'Notes' },
  ],
};

export const CopyRecordDataDialog: React.FC<CopyRecordDataDialogProps> = ({
  open,
  onOpenChange,
  targetType,
  targetId,
  onCopied,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedSource, setSelectedSource] = useState<any>(null);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const { activeTenantId } = useActiveTenantId();
  const { toast } = useToast();

  const fields = COPYABLE_FIELDS.contact;

  const handleSearch = async () => {
    if (!searchQuery.trim() || !activeTenantId) return;
    setLoading(true);

    const { data } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, notes')
      .eq('tenant_id', activeTenantId)
      .or(`first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%`)
      .neq('id', targetId)
      .limit(10);

    setSearchResults(data || []);
    setLoading(false);
  };

  const handleCopy = async () => {
    if (!selectedSource || selectedFields.length === 0) return;

    const updateData: Record<string, any> = {};
    for (const key of selectedFields) {
      if (selectedSource[key] != null) {
        updateData[key] = selectedSource[key];
      }
    }

    const table = targetType === 'contact' ? 'contacts' : 'jobs';
    const { error } = await supabase.from(table).update(updateData).eq('id', targetId);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Data copied successfully', description: `${selectedFields.length} field(s) updated.` });
      onCopied?.();
      onOpenChange(false);
    }
  };

  const toggleField = (key: string) => {
    setSelectedFields(prev =>
      prev.includes(key) ? prev.filter(f => f !== key) : [...prev, key]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Copy Data From Another Record
          </DialogTitle>
          <DialogDescription>
            Search for a record and select fields to copy into this {targetType}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by name, email, or phone..."
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            <Button variant="outline" onClick={handleSearch} disabled={loading}>
              <Search className="h-4 w-4" />
            </Button>
          </div>

          {searchResults.length > 0 && !selectedSource && (
            <div className="border rounded-lg max-h-40 overflow-y-auto">
              {searchResults.map(r => (
                <button
                  key={r.id}
                  className="w-full text-left p-3 hover:bg-muted/50 border-b last:border-b-0 text-sm"
                  onClick={() => {
                    setSelectedSource(r);
                    setSelectedFields([]);
                  }}
                >
                  <div className="font-medium">{r.first_name} {r.last_name}</div>
                  <div className="text-xs text-muted-foreground">{r.email || r.phone}</div>
                </button>
              ))}
            </div>
          )}

          {selectedSource && (
            <>
              <div className="p-3 bg-muted/50 rounded-lg text-sm">
                <div className="font-medium">Source: {selectedSource.first_name} {selectedSource.last_name}</div>
                <Button variant="link" size="sm" className="p-0 h-auto text-xs" onClick={() => setSelectedSource(null)}>
                  Change source
                </Button>
              </div>

              <div className="space-y-2">
                <Label>Select fields to copy:</Label>
                <div className="grid grid-cols-2 gap-2">
                  {fields.map(f => {
                    const value = selectedSource[f.key];
                    return (
                      <label
                        key={f.key}
                        className="flex items-center gap-2 p-2 rounded border cursor-pointer hover:bg-muted/50 text-sm"
                      >
                        <Checkbox
                          checked={selectedFields.includes(f.key)}
                          onCheckedChange={() => toggleField(f.key)}
                          disabled={!value}
                        />
                        <div>
                          <div className="font-medium">{f.label}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                            {value || '(empty)'}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCopy} disabled={!selectedSource || selectedFields.length === 0}>
            Copy {selectedFields.length} Field{selectedFields.length !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
