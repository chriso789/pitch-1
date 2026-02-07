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
import { Slider } from '@/components/ui/slider';
import { Plus, Edit, Trash2, GripVertical, ArrowUp, ArrowDown, Loader2, AlertTriangle, Palette } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { cn } from '@/lib/utils';

interface PipelineStage {
  id: string;
  tenant_id: string;
  name: string;
  key: string | null;
  description: string | null;
  stage_order: number;
  probability_percent: number;
  is_active: boolean;
  color: string;
  auto_actions: unknown;
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

interface StageDialogProps {
  stage?: PipelineStage;
  existingStages: PipelineStage[];
  onSave: () => void;
  trigger: React.ReactNode;
}

// Generate a URL-safe key from stage name
function generateStageKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .trim();
}

const StageDialog: React.FC<StageDialogProps> = ({ stage, existingStages, onSave, trigger }) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(stage?.name || '');
  const [stageKey, setStageKey] = useState(stage?.key || '');
  const [description, setDescription] = useState(stage?.description || '');
  const [color, setColor] = useState(stage?.color || '#3b82f6');
  const [probability, setProbability] = useState(stage?.probability_percent || 0);
  const [isActive, setIsActive] = useState(stage?.is_active ?? true);
  const { toast } = useToast();
  const { profile } = useUserProfile();

  useEffect(() => {
    if (open && stage) {
      setName(stage.name);
      setStageKey(stage.key || '');
      setDescription(stage.description || '');
      setColor(stage.color);
      setProbability(stage.probability_percent);
      setIsActive(stage.is_active);
    } else if (open && !stage) {
      setName('');
      setStageKey('');
      setDescription('');
      setColor('#3b82f6');
      setProbability(0);
      setIsActive(true);
    }
  }, [open, stage]);

  // Auto-generate key when name changes (only for new stages or if key is empty)
  useEffect(() => {
    if (!stage && name && !stageKey) {
      // Auto-suggest key for new stages
    }
  }, [name, stage, stageKey]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: 'Error', description: 'Stage name is required', variant: 'destructive' });
      return;
    }

    // Use provided key or auto-generate from name
    const finalKey = stageKey.trim() || generateStageKey(name);
    
    // Check for duplicate keys within tenant
    const duplicateKey = existingStages.find(
      s => s.id !== stage?.id && (s.key === finalKey || (!s.key && generateStageKey(s.name) === finalKey))
    );
    if (duplicateKey) {
      toast({ 
        title: 'Error', 
        description: `Key "${finalKey}" is already used by "${duplicateKey.name}"`, 
        variant: 'destructive' 
      });
      return;
    }

    setSaving(true);
    try {
      if (stage) {
        const { error } = await supabase
          .from('pipeline_stages')
          .update({
            name: name.trim(),
            key: finalKey,
            description: description.trim() || null,
            color,
            probability_percent: probability,
            is_active: isActive,
            updated_at: new Date().toISOString()
          })
          .eq('id', stage.id);
        
        if (error) throw error;
        toast({ title: 'Success', description: 'Stage updated successfully' });
      } else {
        // Calculate next stage_order
        const maxOrder = Math.max(0, ...existingStages.map(s => s.stage_order));
        
        const { error } = await supabase
          .from('pipeline_stages')
          .insert({
            tenant_id: profile?.tenant_id,
            name: name.trim(),
            key: finalKey,
            description: description.trim() || null,
            color,
            probability_percent: probability,
            is_active: isActive,
            stage_order: maxOrder + 1,
            created_by: profile?.id
          });
        
        if (error) throw error;
        toast({ title: 'Success', description: 'Stage created successfully' });
      }
      
      setOpen(false);
      onSave();
    } catch (error) {
      console.error('Error saving stage:', error);
      toast({ title: 'Error', description: 'Failed to save stage', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{stage ? 'Edit Pipeline Stage' : 'Add New Stage'}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Stage Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., New Lead, Proposal Sent"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="stageKey">Status Key</Label>
            <Input
              id="stageKey"
              value={stageKey}
              onChange={(e) => setStageKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder={name ? generateStageKey(name) : 'e.g., new_lead, proposal_sent'}
            />
            <p className="text-xs text-muted-foreground">
              Internal identifier used to match pipeline entries. Leave blank to auto-generate from name.
              {stage && stage.key && (
                <span className="text-amber-600 dark:text-amber-400 ml-1">
                  Changing this may orphan existing entries with status "{stage.key}"
                </span>
              )}
            </p>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this stage..."
              rows={2}
            />
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
          
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Probability %</Label>
              <span className="text-sm font-medium">{probability}%</span>
            </div>
            <Slider
              value={[probability]}
              onValueChange={([val]) => setProbability(val)}
              max={100}
              step={5}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Likelihood of deal closing when in this stage
            </p>
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <Label>Active</Label>
              <p className="text-xs text-muted-foreground">Show this stage in the pipeline</p>
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
            {stage ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const PipelineStageManager: React.FC = () => {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [reordering, setReordering] = useState<string | null>(null);
  const { toast } = useToast();
  const { profile } = useUserProfile();

  const fetchStages = async () => {
    if (!profile?.tenant_id) return;
    
    try {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('stage_order', { ascending: true });
      
      if (error) throw error;
      setStages(data || []);
    } catch (error) {
      console.error('Error fetching stages:', error);
      toast({ title: 'Error', description: 'Failed to load pipeline stages', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.tenant_id) {
      fetchStages();
    }
  }, [profile?.tenant_id]);

  const moveStage = async (stageId: string, direction: 'up' | 'down') => {
    const stageIndex = stages.findIndex(s => s.id === stageId);
    if (stageIndex === -1) return;
    
    const targetIndex = direction === 'up' ? stageIndex - 1 : stageIndex + 1;
    if (targetIndex < 0 || targetIndex >= stages.length) return;
    
    setReordering(stageId);
    
    const currentStage = stages[stageIndex];
    const targetStage = stages[targetIndex];
    
    try {
      // Swap stage_order values
      await Promise.all([
        supabase
          .from('pipeline_stages')
          .update({ stage_order: targetStage.stage_order, updated_at: new Date().toISOString() })
          .eq('id', currentStage.id),
        supabase
          .from('pipeline_stages')
          .update({ stage_order: currentStage.stage_order, updated_at: new Date().toISOString() })
          .eq('id', targetStage.id)
      ]);
      
      await fetchStages();
      toast({ title: 'Success', description: 'Stage order updated' });
    } catch (error) {
      console.error('Error reordering stages:', error);
      toast({ title: 'Error', description: 'Failed to reorder stages', variant: 'destructive' });
    } finally {
      setReordering(null);
    }
  };

  const deleteStage = async (stageId: string) => {
    try {
      // Check if any pipeline entries use this stage by key
      const stage = stages.find(s => s.id === stageId);
      const stageKey = stage?.key || generateStageKey(stage?.name || '');
      
      const { count, error: countError } = await supabase
        .from('pipeline_entries')
        .select('id', { count: 'exact', head: true } as const)
        .eq('status', stageKey);
      
      if (countError) throw countError;
      
      if (count && count > 0) {
        toast({
          title: 'Cannot Delete',
          description: `This stage has ${count} entries with status "${stageKey}". Move them to another stage first.`,
          variant: 'destructive'
        });
        return;
      }
      
      const { error } = await supabase
        .from('pipeline_stages')
        .delete()
        .eq('id', stageId);
      
      if (error) throw error;
      
      toast({ title: 'Success', description: 'Stage deleted successfully' });
      fetchStages();
    } catch (error) {
      console.error('Error deleting stage:', error);
      toast({ title: 'Error', description: 'Failed to delete stage', variant: 'destructive' });
    }
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
          <h2 className="text-2xl font-bold">Pipeline Stages</h2>
          <p className="text-muted-foreground">
            Configure the stages that leads progress through in your sales pipeline
          </p>
        </div>
        <StageDialog
          existingStages={stages}
          onSave={fetchStages}
          trigger={
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Stage
            </Button>
          }
        />
      </div>

      {stages.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No pipeline stages configured</h3>
            <p className="text-muted-foreground text-center max-w-sm mt-1 mb-4">
              Create your first stage to start organizing leads in your pipeline
            </p>
            <StageDialog
              existingStages={stages}
              onSave={fetchStages}
              trigger={
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Stage
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Stage Order</CardTitle>
            <CardDescription>
              Drag or use arrows to reorder. Stages appear left-to-right in the Kanban view.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[500px]">
              <div className="space-y-2">
                {stages.map((stage, index) => (
                  <div
                    key={stage.id}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border bg-card transition-all",
                      !stage.is_active && "opacity-50"
                    )}
                  >
                    <GripVertical className="h-5 w-5 text-muted-foreground cursor-grab" />
                    
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div
                        className="w-4 h-4 rounded-full shrink-0"
                        style={{ backgroundColor: stage.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{stage.name}</span>
                          {!stage.is_active && (
                            <Badge variant="secondary" className="text-xs">Inactive</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                            {stage.key || generateStageKey(stage.name)}
                          </code>
                          {stage.description && (
                            <p className="text-xs text-muted-foreground truncate">
                              {stage.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {stage.probability_percent}%
                      </Badge>
                    </div>
                    
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={index === 0 || !!reordering}
                        onClick={() => moveStage(stage.id, 'up')}
                      >
                        {reordering === stage.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ArrowUp className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={index === stages.length - 1 || !!reordering}
                        onClick={() => moveStage(stage.id, 'down')}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      
                      <StageDialog
                        stage={stage}
                        existingStages={stages}
                        onSave={fetchStages}
                        trigger={
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <Edit className="h-4 w-4" />
                          </Button>
                        }
                      />
                      
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Stage?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete the "{stage.name}" stage. 
                              Leads in this stage will need to be moved first.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteStage(stage.id)}
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

      <Card className="border-warning/30 bg-warning/5">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-foreground">Note</p>
              <p className="text-muted-foreground">
                Changes to pipeline stages will affect how leads are organized in your Kanban view. 
                Existing leads will remain in their current stage.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
