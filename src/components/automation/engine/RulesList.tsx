import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Plus, Pencil, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { RuleEditorDialog } from './RuleEditorDialog';
import { AutomationRuleV2 } from './types';

export function RulesList() {
  const tenantId = useEffectiveTenantId();
  const [rules, setRules] = useState<AutomationRuleV2[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AutomationRuleV2 | null>(null);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('automation_rules_v2')
      .select('*')
      .eq('company_id', tenantId)
      .order('created_at', { ascending: false });
    if (error) toast.error(error.message);
    setRules((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenantId]);

  const toggle = async (r: AutomationRuleV2) => {
    const { error } = await supabase
      .from('automation_rules_v2')
      .update({ is_active: !r.is_active })
      .eq('id', r.id);
    if (error) return toast.error(error.message);
    load();
  };

  const remove = async (r: AutomationRuleV2) => {
    if (!confirm(`Delete "${r.name}"?`)) return;
    const { error } = await supabase.from('automation_rules_v2').delete().eq('id', r.id);
    if (error) return toast.error(error.message);
    toast.success('Rule deleted');
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Automation rules</h3>
          <p className="text-sm text-muted-foreground">Event-driven rules for this company.</p>
        </div>
        <Button onClick={() => { setEditing(null); setEditorOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" /> New rule
        </Button>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && rules.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Zap className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No rules yet. Install one from Templates or create from scratch.</p>
            <Button onClick={() => { setEditing(null); setEditorOpen(true); }}>
              <Plus className="mr-1 h-4 w-4" /> Create your first rule
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {rules.map((r) => (
          <Card key={r.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  <Badge variant="outline">{r.trigger_event}</Badge>
                  {r.cooldown_seconds > 0 && (
                    <Badge variant="secondary">cooldown {r.cooldown_seconds}s</Badge>
                  )}
                  {r.stop_processing_on_match && <Badge variant="secondary">stop-on-match</Badge>}
                </div>
                {r.description && (
                  <p className="line-clamp-1 text-sm text-muted-foreground">{r.description}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {(r.conditions || []).length} condition(s) · {(r.actions || []).length} action(s)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={r.is_active} onCheckedChange={() => toggle(r)} />
                <Button variant="ghost" size="icon" onClick={() => { setEditing(r); setEditorOpen(true); }}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => remove(r)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <RuleEditorDialog open={editorOpen} onOpenChange={setEditorOpen} rule={editing} onSaved={load} />
    </div>
  );
}
