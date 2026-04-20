import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Plus, Pencil, Trash2, Download, Sparkles, Star } from 'lucide-react';
import { toast } from 'sonner';
import { ConditionsBuilder } from './ConditionsBuilder';
import { ActionsBuilder } from './ActionsBuilder';
import { RuleAction, RuleCondition, RuleTemplate, TRIGGER_SCOPES } from './types';

interface EventTypeRow { key: string; description: string }

export function TemplatesPanel() {
  const tenantId = useEffectiveTenantId();
  const { profile } = useUserProfile();
  const isMaster = profile?.role === 'master';

  const [templates, setTemplates] = useState<RuleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<RuleTemplate | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('automation_rule_templates')
      .select('*')
      .order('sort_order')
      .order('name');
    setTemplates((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const install = async (t: RuleTemplate) => {
    if (!tenantId) return toast.error('No active company selected');
    const { error } = await supabase.from('automation_rules_v2').insert({
      company_id: tenantId,
      name: t.name,
      description: t.description,
      is_active: true,
      trigger_event: t.trigger_event,
      trigger_scope: t.trigger_scope,
      conditions: t.conditions as any,
      actions: t.actions as any,
      cooldown_seconds: t.default_cooldown_seconds,
      max_runs_per_entity_per_day: t.default_max_runs_per_entity_per_day,
      stop_processing_on_match: false,
    });
    if (error) return toast.error(error.message);
    toast.success(`Installed "${t.name}"`);
  };

  const remove = async (t: RuleTemplate) => {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    const { error } = await supabase.from('automation_rule_templates').delete().eq('id', t.id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Rule templates</h3>
          <p className="text-sm text-muted-foreground">
            {isMaster
              ? 'Master-managed library. Define once, available to every company.'
              : 'Pre-built rules — install with one click into your company.'}
          </p>
        </div>
        {isMaster && (
          <Button onClick={() => { setEditing(null); setEditorOpen(true); }}>
            <Plus className="mr-1 h-4 w-4" /> New template
          </Button>
        )}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && templates.length === 0 && (
        <Card><CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
          <Sparkles className="h-8 w-8" />
          <p>No templates yet. {isMaster ? 'Create the first one above.' : 'Ask your platform admin to publish templates.'}</p>
        </CardContent></Card>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {templates.map((t) => (
          <Card key={t.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    {t.is_recommended && (
                      <Badge variant="secondary" className="gap-1"><Star className="h-3 w-3" /> Recommended</Badge>
                    )}
                    {!t.is_active && <Badge variant="outline">Inactive</Badge>}
                  </div>
                  <Badge variant="outline" className="font-mono text-xs">{t.trigger_event}</Badge>
                  <p className="text-xs text-muted-foreground">{t.category}</p>
                </div>
              </div>
              {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
              <p className="text-xs text-muted-foreground">
                {(t.conditions || []).length} condition(s) · {(t.actions || []).length} action(s)
              </p>
              <div className="flex items-center justify-between gap-2">
                <Button size="sm" onClick={() => install(t)}>
                  <Download className="mr-1 h-4 w-4" /> Install to my company
                </Button>
                {isMaster && (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => { setEditing(t); setEditorOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(t)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {isMaster && (
        <TemplateEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          template={editing}
          onSaved={load}
        />
      )}
    </div>
  );
}

// ---- Master-only template editor ----

interface EditorProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  template: RuleTemplate | null;
  onSaved: () => void;
}

function TemplateEditor({ open, onOpenChange, template, onSaved }: EditorProps) {
  const [eventTypes, setEventTypes] = useState<EventTypeRow[]>([]);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [triggerEvent, setTriggerEvent] = useState('lead.created');
  const [triggerScope, setTriggerScope] = useState('entity');
  const [conditions, setConditions] = useState<RuleCondition[]>([]);
  const [actions, setActions] = useState<RuleAction[]>([]);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [maxRunsPerDay, setMaxRunsPerDay] = useState<number | ''>('');
  const [isRecommended, setIsRecommended] = useState(false);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    supabase.from('event_types').select('key, description').order('key')
      .then(({ data }) => setEventTypes((data as EventTypeRow[]) || []));
  }, []);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setDescription(template.description ?? '');
      setCategory(template.category);
      setTriggerEvent(template.trigger_event);
      setTriggerScope(template.trigger_scope);
      setConditions(Array.isArray(template.conditions) ? template.conditions : []);
      setActions(Array.isArray(template.actions) ? template.actions : []);
      setCooldownSeconds(template.default_cooldown_seconds);
      setMaxRunsPerDay(template.default_max_runs_per_entity_per_day ?? '');
      setIsRecommended(template.is_recommended);
      setIsActive(template.is_active);
    } else {
      setName(''); setDescription(''); setCategory('general');
      setTriggerEvent('lead.created'); setTriggerScope('entity');
      setConditions([]); setActions([]);
      setCooldownSeconds(0); setMaxRunsPerDay('');
      setIsRecommended(false); setIsActive(true);
    }
  }, [template, open]);

  const save = async () => {
    if (!name.trim()) return toast.error('Name is required');
    if (actions.length === 0) return toast.error('Add at least one action');
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        category,
        trigger_event: triggerEvent,
        trigger_scope: triggerScope,
        conditions: conditions as any,
        actions: actions as any,
        default_cooldown_seconds: cooldownSeconds,
        default_max_runs_per_entity_per_day: maxRunsPerDay === '' ? null : Number(maxRunsPerDay),
        is_recommended: isRecommended,
        is_active: isActive,
      };
      const { error } = template
        ? await supabase.from('automation_rule_templates').update(payload).eq('id', template.id)
        : await supabase.from('automation_rule_templates').insert(payload);
      if (error) throw error;
      toast.success(template ? 'Template updated' : 'Template created');
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template ? 'Edit template' : 'New template'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="sales / production / billing" />
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label>Trigger event</Label>
              <Select value={triggerEvent} onValueChange={setTriggerEvent}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {eventTypes.map((e) => <SelectItem key={e.key} value={e.key}>{e.key}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Trigger scope</Label>
              <Select value={triggerScope} onValueChange={setTriggerScope}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRIGGER_SCOPES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Tabs defaultValue="conditions">
            <TabsList>
              <TabsTrigger value="conditions">Conditions</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
              <TabsTrigger value="meta">Meta</TabsTrigger>
            </TabsList>
            <TabsContent value="conditions" className="pt-4">
              <ConditionsBuilder value={conditions} onChange={setConditions} />
            </TabsContent>
            <TabsContent value="actions" className="pt-4">
              <ActionsBuilder value={actions} onChange={setActions} />
            </TabsContent>
            <TabsContent value="meta" className="space-y-4 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label>Default cooldown (s)</Label>
                  <Input type="number" value={cooldownSeconds} onChange={(e) => setCooldownSeconds(Number(e.target.value) || 0)} />
                </div>
                <div>
                  <Label>Default max runs / entity / day</Label>
                  <Input type="number" value={maxRunsPerDay}
                    onChange={(e) => setMaxRunsPerDay(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="unlimited" />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch checked={isRecommended} onCheckedChange={setIsRecommended} id="rec" />
                  <Label htmlFor="rec">Recommended</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={isActive} onCheckedChange={setIsActive} id="tplactive" />
                  <Label htmlFor="tplactive">Active (visible to companies)</Label>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save template'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
