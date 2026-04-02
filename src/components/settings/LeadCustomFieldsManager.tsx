import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, GripVertical, FormInput } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { useToast } from '@/hooks/use-toast';

interface CustomField {
  id: string;
  field_name: string;
  field_type: string;
  options: string[];
  sort_order: number;
  required: boolean;
  active: boolean;
}

export const LeadCustomFieldsManager = () => {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState('text');
  const [options, setOptions] = useState('');
  const [required, setRequired] = useState(false);
  const { activeTenantId } = useActiveTenantId();
  const { toast } = useToast();

  useEffect(() => {
    if (activeTenantId) fetchFields();
  }, [activeTenantId]);

  const fetchFields = async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('lead_custom_fields')
      .select('*')
      .eq('tenant_id', activeTenantId)
      .order('sort_order');

    if (error) {
      console.error('Error loading custom fields:', error);
    } else {
      setFields((data || []).map(f => ({ ...f, options: f.options || [] })));
    }
    setLoading(false);
  };

  const openCreate = () => {
    setEditingField(null);
    setFieldName('');
    setFieldType('text');
    setOptions('');
    setRequired(false);
    setDialogOpen(true);
  };

  const openEdit = (field: CustomField) => {
    setEditingField(field);
    setFieldName(field.field_name);
    setFieldType(field.field_type);
    setOptions(Array.isArray(field.options) ? field.options.join(', ') : '');
    setRequired(field.required);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!fieldName.trim() || !activeTenantId) return;

    const parsedOptions = fieldType === 'select'
      ? options.split(',').map(o => o.trim()).filter(Boolean)
      : [];

    if (editingField) {
      const { error } = await supabase
        .from('lead_custom_fields')
        .update({
          field_name: fieldName.trim(),
          field_type: fieldType,
          options: parsedOptions,
          required,
        })
        .eq('id', editingField.id);

      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        return;
      }
      toast({ title: 'Field updated' });
    } else {
      const { error } = await supabase
        .from('lead_custom_fields')
        .insert({
          tenant_id: activeTenantId,
          field_name: fieldName.trim(),
          field_type: fieldType,
          options: parsedOptions,
          required,
          sort_order: fields.length,
        });

      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        return;
      }
      toast({ title: 'Field created' });
    }

    setDialogOpen(false);
    fetchFields();
  };

  const toggleActive = async (field: CustomField) => {
    await supabase
      .from('lead_custom_fields')
      .update({ active: !field.active })
      .eq('id', field.id);
    fetchFields();
  };

  const deleteField = async (id: string) => {
    await supabase.from('lead_custom_fields').delete().eq('id', id);
    toast({ title: 'Field deleted' });
    fetchFields();
  };

  const typeLabel = (t: string) => {
    const map: Record<string, string> = { text: 'Text', number: 'Number', select: 'Dropdown', checkbox: 'Checkbox', date: 'Date' };
    return map[t] || t;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FormInput className="h-5 w-5" />
              Custom Lead Fields
            </CardTitle>
            <CardDescription>
              Add custom fields that appear on the lead creation form
            </CardDescription>
          </div>
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Add Field
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : fields.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No custom fields yet. Click "Add Field" to create one.
          </div>
        ) : (
          <div className="space-y-2">
            {fields.map((field) => (
              <div
                key={field.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {field.field_name}
                      {field.required && <Badge variant="destructive" className="text-[10px] px-1">Required</Badge>}
                      {!field.active && <Badge variant="secondary" className="text-[10px] px-1">Inactive</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {typeLabel(field.field_type)}
                      {field.field_type === 'select' && field.options?.length > 0 && (
                        <span> · {field.options.length} options</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={field.active} onCheckedChange={() => toggleActive(field)} />
                  <Button variant="ghost" size="icon" onClick={() => openEdit(field)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteField(field.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingField ? 'Edit Custom Field' : 'Add Custom Field'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Field Name</Label>
                <Input value={fieldName} onChange={e => setFieldName(e.target.value)} placeholder="e.g., Insurance Company" />
              </div>
              <div>
                <Label>Field Type</Label>
                <Select value={fieldType} onValueChange={setFieldType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="select">Dropdown</SelectItem>
                    <SelectItem value="checkbox">Checkbox</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {fieldType === 'select' && (
                <div>
                  <Label>Options (comma-separated)</Label>
                  <Input value={options} onChange={e => setOptions(e.target.value)} placeholder="Option 1, Option 2, Option 3" />
                </div>
              )}
              <div className="flex items-center gap-2">
                <Switch checked={required} onCheckedChange={setRequired} />
                <Label>Required field</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={!fieldName.trim()}>
                {editingField ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};
