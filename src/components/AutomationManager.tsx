import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Trash2, Edit, Plus, Play, Pause } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Automation {
  id: string;
  name: string;
  description?: string;
  trigger_type: string;
  trigger_conditions: any;
  actions: any;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface AutomationDialogProps {
  automation?: Automation;
  onSave: () => void;
  trigger: React.ReactNode;
}

const AutomationDialog: React.FC<AutomationDialogProps> = ({ automation, onSave, trigger }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(automation?.name || '');
  const [description, setDescription] = useState(automation?.description || '');
  const [triggerType, setTriggerType] = useState(automation?.trigger_type || 'manual');
  const [isActive, setIsActive] = useState(automation?.is_active ?? true);
  const { toast } = useToast();

  const handleSave = async () => {
    try {
      if (automation) {
        await supabase.rpc('api_automations_update', {
          p_id: automation.id,
          p_name: name,
          p_description: description,
          p_trigger_conditions: {},
          p_actions: []
        });
      } else {
        await supabase.rpc('api_automations_create', {
          p_name: name,
          p_description: description,
          p_trigger_type: triggerType,
          p_trigger_conditions: {},
          p_actions: []
        });
      }
      
      toast({
        title: 'Success',
        description: `Automation ${automation ? 'updated' : 'created'} successfully`,
      });
      
      setOpen(false);
      onSave();
    } catch (error) {
      console.error('Error saving automation:', error);
      toast({
        title: 'Error',
        description: 'Failed to save automation',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{automation ? 'Edit Automation' : 'Create New Automation'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter automation name"
            />
          </div>
          
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this automation does"
              rows={3}
            />
          </div>
          
          {!automation && (
            <div>
              <Label htmlFor="trigger">Trigger Type</Label>
              <Select value={triggerType} onValueChange={setTriggerType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="status_change">Status Change</SelectItem>
                  <SelectItem value="time_based">Time Based</SelectItem>
                  <SelectItem value="field_update">Field Update</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          
          <div className="flex items-center space-x-2">
            <Switch id="active" checked={isActive} onCheckedChange={setIsActive} />
            <Label htmlFor="active">Active</Label>
          </div>
          
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {automation ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const AutomationManager: React.FC = () => {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchAutomations = async () => {
    try {
      const { data, error } = await supabase
        .from('automations')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAutomations(data || []);
    } catch (error) {
      console.error('Error fetching automations:', error);
      toast({
        title: 'Error',
        description: 'Failed to load automations',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleAutomation = async (id: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('automations')
        .update({ is_active: !isActive })
        .eq('id', id);

      if (error) throw error;
      
      toast({
        title: 'Success',
        description: `Automation ${!isActive ? 'activated' : 'deactivated'}`,
      });
      
      fetchAutomations();
    } catch (error) {
      console.error('Error toggling automation:', error);
      toast({
        title: 'Error',
        description: 'Failed to toggle automation',
        variant: 'destructive',
      });
    }
  };

  const deleteAutomation = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this automation?')) return;

    try {
      const { error } = await supabase
        .from('automations')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      toast({
        title: 'Success',
        description: 'Automation deleted successfully',
      });
      
      fetchAutomations();
    } catch (error) {
      console.error('Error deleting automation:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete automation',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    fetchAutomations();
  }, []);

  if (loading) {
    return <div className="p-6">Loading automations...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Automation Manager</h2>
          <p className="text-muted-foreground">Create and manage automated workflows</p>
        </div>
        <AutomationDialog
          onSave={fetchAutomations}
          trigger={
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Create Automation
            </Button>
          }
        />
      </div>

      <div className="grid gap-4">
        {automations.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <div className="text-center">
                <h3 className="text-lg font-medium">No automations yet</h3>
                <p className="text-muted-foreground mb-4">
                  Create your first automation to get started
                </p>
                <AutomationDialog
                  onSave={fetchAutomations}
                  trigger={<Button>Create First Automation</Button>}
                />
              </div>
            </CardContent>
          </Card>
        ) : (
          automations.map((automation) => (
            <Card key={automation.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {automation.name}
                      <Badge variant={automation.is_active ? 'default' : 'secondary'}>
                        {automation.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </CardTitle>
                    {automation.description && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {automation.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleAutomation(automation.id, automation.is_active)}
                    >
                      {automation.is_active ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </Button>
                    <AutomationDialog
                      automation={automation}
                      onSave={fetchAutomations}
                      trigger={
                        <Button variant="ghost" size="sm">
                          <Edit className="w-4 h-4" />
                        </Button>
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteAutomation(automation.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>Trigger: {automation.trigger_type}</span>
                  <span>Created: {new Date(automation.created_at).toLocaleDateString()}</span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};