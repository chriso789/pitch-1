import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Edit, Trash2, ArrowUp, ArrowDown, Loader2, AlertTriangle, Palette, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { cn } from '@/lib/utils';

interface ContactStatus {
  id: string;
  tenant_id: string;
  name: string;
  key: string;
  description: string | null;
  color: string;
  category: string;
  status_order: number;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

const PRESET_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#eab308', // yellow
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#6b7280', // gray
  '#10b981', // emerald
];

const CATEGORIES = [
  { value: 'disposition', label: 'Disposition' },
  { value: 'interest', label: 'Interest Level' },
  { value: 'action', label: 'Action Required' },
];

interface StatusDialogProps {
  status?: ContactStatus;
  existingStatuses: ContactStatus[];
  onSave: () => void;
  trigger: React.ReactNode;
}

const StatusDialog: React.FC<StatusDialogProps> = ({ status, existingStatuses, onSave, trigger }) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(status?.name || '');
  const [description, setDescription] = useState(status?.description || '');
  const [color, setColor] = useState(status?.color || '#3b82f6');
  const [category, setCategory] = useState(status?.category || 'disposition');
  const [isActive, setIsActive] = useState(status?.is_active ?? true);
  const { toast } = useToast();
  const tenantId = useEffectiveTenantId();

  useEffect(() => {
    if (open && status) {
      setName(status.name);
      setDescription(status.description || '');
      setColor(status.color);
      setCategory(status.category);
      setIsActive(status.is_active);
    } else if (open && !status) {
      setName('');
      setDescription('');
      setColor('#3b82f6');
      setCategory('disposition');
      setIsActive(true);
    }
  }, [open, status]);

  const generateKey = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .trim();
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: 'Error', description: 'Status name is required', variant: 'destructive' });
      return;
    }

    const key = generateKey(name);
    
    // Check for duplicate key
    const duplicate = existingStatuses.find(s => 
      s.key === key && s.id !== status?.id
    );
    if (duplicate) {
      toast({ title: 'Error', description: 'A status with this name already exists', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      if (status) {
        const { error } = await supabase
          .from('contact_statuses')
          .update({
            name: name.trim(),
            key,
            description: description.trim() || null,
            color,
            category,
            is_active: isActive,
            updated_at: new Date().toISOString()
          })
          .eq('id', status.id);
        
        if (error) throw error;
        toast({ title: 'Success', description: 'Status updated successfully' });
      } else {
        const maxOrder = Math.max(0, ...existingStatuses.map(s => s.status_order));
        
        const { error } = await supabase
          .from('contact_statuses')
          .insert({
            tenant_id: tenantId,
            name: name.trim(),
            key,
            description: description.trim() || null,
            color,
            category,
            is_active: isActive,
            status_order: maxOrder + 1,
            is_system: false
          });
        
        if (error) throw error;
        toast({ title: 'Success', description: 'Status created successfully' });
      }
      
      setOpen(false);
      onSave();
    } catch (error) {
      console.error('Error saving status:', error);
      toast({ title: 'Error', description: 'Failed to save status', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{status ? 'Edit Contact Status' : 'Add New Status'}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Status Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Interested, Not Home, Follow Up"
              disabled={status?.is_system}
            />
            {status?.is_system && (
              <p className="text-xs text-muted-foreground">System statuses cannot be renamed</p>
            )}
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this status..."
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(cat => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={cn(
                    "w-8 h-8 rounded-full transition-all",
                    color === c ? "ring-2 ring-offset-2 ring-primary scale-110" : "hover:scale-105"
                  )}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
              <div className="relative">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-8 h-8 rounded-full cursor-pointer opacity-0 absolute inset-0"
                />
                <div 
                  className="w-8 h-8 rounded-full flex items-center justify-center border-2 border-dashed border-muted-foreground/50"
                  style={{ backgroundColor: PRESET_COLORS.includes(color) ? 'transparent' : color }}
                >
                  <Palette className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <Label>Active</Label>
              <p className="text-xs text-muted-foreground">Show this status in dropdowns</p>
            </div>
            <Switch
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {status ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const ContactStatusManager: React.FC = () => {
  const [statuses, setStatuses] = useState<ContactStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [reordering, setReordering] = useState<string | null>(null);
  const { toast } = useToast();
  const tenantId = useEffectiveTenantId();

  const fetchStatuses = async () => {
    if (!tenantId) return;
    
    try {
      const { data, error } = await supabase
        .from('contact_statuses')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('status_order', { ascending: true });
      
      if (error) throw error;
      setStatuses(data || []);
    } catch (error) {
      console.error('Error fetching statuses:', error);
      toast({ title: 'Error', description: 'Failed to load contact statuses', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const initializeDefaultStatuses = async () => {
    if (!tenantId) return;
    
    const defaultStatuses = [
      { name: 'Not Home', key: 'not_home', color: '#6b7280', category: 'disposition', status_order: 1 },
      { name: 'Interested', key: 'interested', color: '#22c55e', category: 'interest', status_order: 2 },
      { name: 'Not Interested', key: 'not_interested', color: '#ef4444', category: 'interest', status_order: 3 },
      { name: 'Qualified', key: 'qualified', color: '#3b82f6', category: 'disposition', status_order: 4 },
      { name: 'Follow Up', key: 'follow_up', color: '#f59e0b', category: 'action', status_order: 5 },
      { name: 'Do Not Contact', key: 'do_not_contact', color: '#ef4444', category: 'disposition', status_order: 6, is_system: true },
    ];

    try {
      const { error } = await supabase
        .from('contact_statuses')
        .insert(defaultStatuses.map(s => ({
          ...s,
          tenant_id: tenantId,
          is_active: true,
          is_system: s.is_system || false
        })));
      
      if (error && !error.message.includes('duplicate')) throw error;
      await fetchStatuses();
    } catch (error) {
      console.error('Error initializing default statuses:', error);
    }
  };

  useEffect(() => {
    if (tenantId) {
      fetchStatuses();
    }
  }, [tenantId]);

  // Initialize defaults if no statuses exist
  useEffect(() => {
    if (!loading && statuses.length === 0 && tenantId) {
      initializeDefaultStatuses();
    }
  }, [loading, statuses.length, tenantId]);

  const moveStatus = async (statusId: string, direction: 'up' | 'down') => {
    const statusIndex = statuses.findIndex(s => s.id === statusId);
    if (statusIndex === -1) return;
    
    const targetIndex = direction === 'up' ? statusIndex - 1 : statusIndex + 1;
    if (targetIndex < 0 || targetIndex >= statuses.length) return;
    
    setReordering(statusId);
    
    const currentStatus = statuses[statusIndex];
    const targetStatus = statuses[targetIndex];
    
    try {
      await Promise.all([
        supabase
          .from('contact_statuses')
          .update({ status_order: targetStatus.status_order, updated_at: new Date().toISOString() })
          .eq('id', currentStatus.id),
        supabase
          .from('contact_statuses')
          .update({ status_order: currentStatus.status_order, updated_at: new Date().toISOString() })
          .eq('id', targetStatus.id)
      ]);
      
      await fetchStatuses();
      toast({ title: 'Success', description: 'Status order updated' });
    } catch (error) {
      console.error('Error reordering statuses:', error);
      toast({ title: 'Error', description: 'Failed to reorder statuses', variant: 'destructive' });
    } finally {
      setReordering(null);
    }
  };

  const deleteStatus = async (statusId: string) => {
    const status = statuses.find(s => s.id === statusId);
    if (status?.is_system) {
      toast({ title: 'Cannot Delete', description: 'System statuses cannot be deleted', variant: 'destructive' });
      return;
    }

    try {
      const { error } = await supabase
        .from('contact_statuses')
        .delete()
        .eq('id', statusId);
      
      if (error) throw error;
      
      toast({ title: 'Success', description: 'Status deleted successfully' });
      fetchStatuses();
    } catch (error) {
      console.error('Error deleting status:', error);
      toast({ title: 'Error', description: 'Failed to delete status', variant: 'destructive' });
    }
  };

  const getCategoryLabel = (category: string) => {
    return CATEGORIES.find(c => c.value === category)?.label || category;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Contact Statuses</h2>
          <p className="text-muted-foreground">
            Manage contact qualification and disposition statuses (separate from pipeline stages)
          </p>
        </div>
        <StatusDialog
          existingStatuses={statuses}
          onSave={fetchStatuses}
          trigger={
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Status
            </Button>
          }
        />
      </div>

      {statuses.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No contact statuses configured</h3>
            <p className="text-muted-foreground text-center max-w-sm mt-1 mb-4">
              Contact statuses help track lead qualification and disposition
            </p>
            <StatusDialog
              existingStatuses={statuses}
              onSave={fetchStatuses}
              trigger={
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Status
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Status List</CardTitle>
            <CardDescription>
              These statuses are used for contact qualification (e.g., "Interested", "Not Home"). 
              They are separate from pipeline workflow stages.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[500px]">
              <div className="space-y-2">
                {statuses.map((status, index) => (
                  <div
                    key={status.id}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border bg-card transition-all",
                      !status.is_active && "opacity-50"
                    )}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div
                        className="w-4 h-4 rounded-full shrink-0"
                        style={{ backgroundColor: status.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{status.name}</span>
                          {status.is_system && (
                            <Badge variant="outline" className="text-xs">System</Badge>
                          )}
                          {!status.is_active && (
                            <Badge variant="secondary" className="text-xs">Inactive</Badge>
                          )}
                        </div>
                        {status.description && (
                          <p className="text-xs text-muted-foreground truncate">
                            {status.description}
                          </p>
                        )}
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {getCategoryLabel(status.category)}
                      </Badge>
                    </div>
                    
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={index === 0 || !!reordering}
                        onClick={() => moveStatus(status.id, 'up')}
                      >
                        {reordering === status.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ArrowUp className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={index === statuses.length - 1 || !!reordering}
                        onClick={() => moveStatus(status.id, 'down')}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      
                      <StatusDialog
                        status={status}
                        existingStatuses={statuses}
                        onSave={fetchStatuses}
                        trigger={
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <Edit className="h-4 w-4" />
                          </Button>
                        }
                      />
                      
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            disabled={status.is_system}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Status?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete the "{status.name}" status.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteStatus(status.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
