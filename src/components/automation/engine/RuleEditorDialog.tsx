import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ConditionsBuilder } from './ConditionsBuilder';
import { ActionsBuilder } from './ActionsBuilder';
import { AutomationRuleV2, RuleAction, RuleCondition, TRIGGER_SCOPES } from './types';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rule?: AutomationRuleV2 | null;
  onSaved: () => void;
}

interface EventTypeRow { key: string; description: string }

export function RuleEditorDialog({ open, onOpenChange, rule, onSaved }: Props) {
  const tenantId = useEffectiveTenantId();
  const [eventTypes, setEventTypes] = useState<EventTypeRow[]>([]);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [triggerEvent, setTriggerEvent] = useState('lead.created');
  const [triggerScope, setTriggerScope] = useState('entity');
  const [conditions, setConditions] = useState<RuleCondition[]>([]);
  const [actions, setActions] = useState<RuleAction[]>([]);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [maxRunsPerDay, setMaxRunsPerDay] = useState<number | ''>('');
  const [stopOnMatch, setStopOnMatch] = useState(false);

  useEffect(() => {
    supabase
      .from('event_types')
      .select('key, description')
      .order('key')
      .then(({ data }) => setEventTypes((data as EventTypeRow[]) || []));
  }, []);

  useEffect(() => {
    if (rule) {
      setName(rule.name);
      setDescription(rule.description ?? '');
      setIsActive(rule.is_active);
      setTriggerEvent(rule.trigger_event);
      setTriggerScope(rule.trigger_scope);
      setConditions(Array.isArray(rule.conditions) ? rule.conditions : []);
      setActions(Array.isArray(rule.actions) ? rule.actions : []);
      setCooldownSeconds(rule.cooldown_seconds);
      setMaxRunsPerDay(rule.max_runs_per_entity_per_day ?? '');
      setStopOnMatch(rule.stop_processing_on_match);
    } else {
      setName('');
      setDescription('');
      setIsActive(true);
      setTriggerEvent('lead.created');
      setTriggerScope('entity');
      setConditions([]);
      setActions([]);
      setCooldownSeconds(0);
      setMaxRunsPerDay('');
      setStopOnMatch(false);
    }
  }, [rule, open]);

  const save = async () => {
    if (!tenantId) {
      toast.error('No active company selected');
      return;
    }
    if (!name.trim()) {
      toast.error('Rule name is required');
      return;
    }
    if (actions.length === 0) {
      toast.error('Add at least one action');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        company_id: tenantId,
        name: name.trim(),
        description: description.trim() || null,
        is_active: isActive,
        trigger_event: triggerEvent,
        trigger_scope: triggerScope,
        conditions: conditions as any,
        actions: actions as any,
        cooldown_seconds: cooldownSeconds,
        max_runs_per_entity_per_day: maxRunsPerDay === '' ? null : Number(maxRunsPerDay),
        stop_processing_on_match: stopOnMatch,
      };

      const { error } = rule
        ? await supabase.from('automation_rules_v2').update(payload).eq('id', rule.id)
        : await supabase.from('automation_rules_v2').insert(payload);

      if (error) throw error;
      toast.success(rule ? 'Rule updated' : 'Rule created');
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule ? 'Edit automation rule' : 'New automation rule'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Permit Approved → Order Materials" />
            </div>
            <div className="flex items-end gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} id="active" />
              <Label htmlFor="active">Active</Label>
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label>Trigger event</Label>
              <Select value={triggerEvent} onValueChange={setTriggerEvent}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {eventTypes.map((e) => (
                    <SelectItem key={e.key} value={e.key}>{e.key}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Trigger scope</Label>
              <Select value={triggerScope} onValueChange={setTriggerScope}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRIGGER_SCOPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Tabs defaultValue="conditions">
            <TabsList>
              <TabsTrigger value="conditions">Conditions ({conditions.length})</TabsTrigger>
              <TabsTrigger value="actions">Actions ({actions.length})</TabsTrigger>
              <TabsTrigger value="limits">Limits</TabsTrigger>
            </TabsList>
            <TabsContent value="conditions" className="pt-4">
              <ConditionsBuilder value={conditions} onChange={setConditions} />
            </TabsContent>
            <TabsContent value="actions" className="pt-4">
              <ActionsBuilder value={actions} onChange={setActions} />
            </TabsContent>
            <TabsContent value="limits" className="space-y-4 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label>Cooldown (seconds)</Label>
                  <Input type="number" value={cooldownSeconds} onChange={(e) => setCooldownSeconds(Number(e.target.value) || 0)} />
                  <p className="mt-1 text-xs text-muted-foreground">Min seconds between firings on the same entity.</p>
                </div>
                <div>
                  <Label>Max runs / entity / day</Label>
                  <Input
                    type="number"
                    value={maxRunsPerDay}
                    onChange={(e) => setMaxRunsPerDay(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="unlimited"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={stopOnMatch} onCheckedChange={setStopOnMatch} id="stop" />
                <Label htmlFor="stop">Stop processing other rules on this event when this matches</Label>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save rule'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
