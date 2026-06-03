import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Plus, Edit, Trash2, Copy, MessageCircle, Mail, Search, ListOrdered,
} from 'lucide-react';

type SmsTemplate = {
  id: string;
  tenant_id: string;
  template_name: string;
  template_body: string;
  category: string | null;
  goal: string | null;
  active: boolean;
  followup_delay_days: number | null;
  created_at: string;
  updated_at: string;
};

const DELAY_OPTIONS = [0, 1, 2, 3, 5, 7, 10, 14, 21, 30];

type EmailTemplate = {
  id: string;
  tenant_id: string;
  name: string;
  template_type: string | null;
  subject: string | null;
  html_body: string | null;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
};

const GOAL_LABELS: Record<string, string> = {
  dormant_reactivation: 'Dormant Reactivation',
  msfh_grant: 'MSFH Grant',
  storm_canvass: 'Storm Canvass',
  general_outreach: 'General Outreach',
  collect_homeowner_email_for_roof_estimate: 'Collect Homeowner Email',
};

const CATEGORY_LABELS: Record<string, string> = {
  reactivation: 'Reactivation',
  msfh: 'MSFH Initial',
  storm_followup: 'Storm Follow-up',
  general: 'General',
  grant_followup: 'Grant Follow-up',
  roof_estimate: 'Roof Estimate',
  msfh_email_capture: 'MSFH Email Capture',
};

const FOLLOWUP_CATEGORIES = new Set(['storm_followup', 'grant_followup', 'reactivation']);

export const TemplatesLibrary: React.FC = () => {
  const tenantId = useEffectiveTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [goalFilter, setGoalFilter] = useState<string>('all');

  const [editor, setEditor] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    id?: string;
    name: string;
    body: string;
    category: string;
    goal: string;
  }>({ open: false, mode: 'create', name: '', body: '', category: 'general', goal: 'general_outreach' });

  const smsQuery = useQuery({
    queryKey: ['templates-library-sms', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sms_templates')
        .select('*')
        .eq('tenant_id', tenantId!)
        .order('category', { ascending: true })
        .order('template_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as SmsTemplate[];
    },
  });

  const emailQuery = useQuery({
    queryKey: ['templates-library-email', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_templates')
        .select('*')
        .eq('tenant_id', tenantId!)
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as EmailTemplate[];
    },
  });

  const sms = smsQuery.data ?? [];
  const emails = emailQuery.data ?? [];

  const categories = useMemo(() => {
    const s = new Set<string>();
    sms.forEach(t => { if (t.category) s.add(t.category); });
    return Array.from(s).sort();
  }, [sms]);

  const goals = useMemo(() => {
    const s = new Set<string>();
    sms.forEach(t => { if (t.goal) s.add(t.goal); });
    return Array.from(s).sort();
  }, [sms]);

  const filteredSms = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sms.filter(t => {
      if (categoryFilter !== 'all' && (t.category || '') !== categoryFilter) return false;
      if (goalFilter !== 'all' && (t.goal || '') !== goalFilter) return false;
      if (q && !(`${t.template_name} ${t.template_body}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [sms, search, categoryFilter, goalFilter]);

  // Group by goal -> category (so user can see the full multi-message sequence per goal)
  const groupedByGoal = useMemo(() => {
    const map = new Map<string, Map<string, SmsTemplate[]>>();
    for (const t of filteredSms) {
      const g = t.goal || 'ungrouped';
      const c = t.category || 'general';
      if (!map.has(g)) map.set(g, new Map());
      const inner = map.get(g)!;
      if (!inner.has(c)) inner.set(c, []);
      inner.get(c)!.push(t);
    }
    return map;
  }, [filteredSms]);

  const openCreate = () => setEditor({
    open: true, mode: 'create', name: '', body: '',
    category: 'general', goal: 'general_outreach',
  });

  const openEdit = (t: SmsTemplate) => setEditor({
    open: true, mode: 'edit', id: t.id,
    name: t.template_name, body: t.template_body,
    category: t.category || 'general', goal: t.goal || 'general_outreach',
  });

  const saveTemplate = async () => {
    if (!tenantId) return;
    const name = editor.name.trim();
    const body = editor.body.trim();
    if (!name || !body) {
      toast({ title: 'Name and message body are required', variant: 'destructive' });
      return;
    }
    try {
      if (editor.mode === 'edit' && editor.id) {
        const { error } = await supabase.from('sms_templates').update({
          template_name: name, template_body: body,
          category: editor.category, goal: editor.goal, active: true,
        }).eq('id', editor.id).eq('tenant_id', tenantId);
        if (error) throw error;
        toast({ title: 'Template updated' });
      } else {
        const { error } = await supabase.from('sms_templates').insert({
          tenant_id: tenantId, template_name: name, template_body: body,
          category: editor.category, goal: editor.goal, active: true,
        });
        if (error) throw error;
        toast({ title: 'Template created' });
      }
      setEditor(s => ({ ...s, open: false }));
      qc.invalidateQueries({ queryKey: ['templates-library-sms', tenantId] });
      qc.invalidateQueries({ queryKey: ['sms-templates', tenantId] });
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    }
  };

  const duplicateTemplate = async (t: SmsTemplate) => {
    if (!tenantId) return;
    const { error } = await supabase.from('sms_templates').insert({
      tenant_id: tenantId,
      template_name: `${t.template_name} (Copy)`,
      template_body: t.template_body,
      category: t.category, goal: t.goal, active: true,
    });
    if (error) {
      toast({ title: 'Duplicate failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Template duplicated' });
    qc.invalidateQueries({ queryKey: ['templates-library-sms', tenantId] });
  };

  const deleteTemplate = async (t: SmsTemplate) => {
    if (!tenantId) return;
    if (!confirm(`Delete template "${t.template_name}"?`)) return;
    const { error } = await supabase.from('sms_templates').delete()
      .eq('id', t.id).eq('tenant_id', tenantId);
    if (error) {
      toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Template deleted' });
    qc.invalidateQueries({ queryKey: ['templates-library-sms', tenantId] });
  };

  const updateTemplateFields = async (t: SmsTemplate, patch: Partial<Pick<SmsTemplate, 'active' | 'followup_delay_days'>>) => {
    if (!tenantId) return;
    const { error } = await supabase.from('sms_templates')
      .update(patch)
      .eq('id', t.id).eq('tenant_id', tenantId);
    if (error) {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
      return;
    }
    qc.invalidateQueries({ queryKey: ['templates-library-sms', tenantId] });
  };

  const renderTemplateCard = (t: SmsTemplate, opts?: { index?: number; isFollowup?: boolean }) => {
    const index = opts?.index;
    const isFollowup = !!opts?.isFollowup;
    const delay = t.followup_delay_days ?? 2;
    return (
      <div key={t.id} className="border rounded-md p-3 bg-card hover:bg-accent/30 transition-colors">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {isFollowup && (
                <input
                  type="checkbox"
                  checked={t.active}
                  onChange={(e) => updateTemplateFields(t, { active: e.target.checked })}
                  className="h-4 w-4 accent-primary cursor-pointer"
                  title={t.active ? 'Disable this follow-up' : 'Enable this follow-up'}
                />
              )}
              {typeof index === 'number' && (
                <Badge variant="outline" className="text-xs">#{index + 1}</Badge>
              )}
              {!isFollowup && (
                <Badge variant="default" className="text-xs bg-amber-500 hover:bg-amber-500">Initial</Badge>
              )}
              <div className="font-medium text-sm truncate">{t.template_name}</div>
              {!t.active && <Badge variant="secondary" className="text-xs">inactive</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-3">
              {t.template_body}
            </p>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <div className="text-[10px] text-muted-foreground">
                Updated {new Date(t.updated_at).toLocaleDateString()}
              </div>
              {isFollowup && (
                <div className="flex items-center gap-1.5">
                  <Label className="text-[11px] text-muted-foreground">Send after</Label>
                  <Select
                    value={String(delay)}
                    onValueChange={(v) => updateTemplateFields(t, { followup_delay_days: Number(v) })}
                  >
                    <SelectTrigger className="h-7 w-[120px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DELAY_OPTIONS.map((d) => (
                        <SelectItem key={d} value={String(d)} className="text-xs">
                          {d === 0 ? 'Same day' : d === 1 ? '1 day' : `${d} days`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="icon" variant="ghost" onClick={() => openEdit(t)} title="Edit">
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => duplicateTemplate(t)} title="Duplicate">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => deleteTemplate(t)} title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ListOrdered className="h-5 w-5" />
                Templates Library
              </CardTitle>
              <CardDescription>
                All SMS templates and follow-up sequences across every campaign goal.
                Grouped by goal so you can see the full multi-message flow.
              </CardDescription>
            </div>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" /> New Template
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="sms" className="space-y-4">
            <TabsList>
              <TabsTrigger value="sms" className="gap-2">
                <MessageCircle className="h-4 w-4" />
                SMS ({sms.length})
              </TabsTrigger>
              <TabsTrigger value="email" className="gap-2">
                <Mail className="h-4 w-4" />
                Email ({emails.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="sms" className="space-y-4">
              {/* Filters */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search templates..."
                    className="pl-8"
                  />
                </div>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {categories.map(c => (
                      <SelectItem key={c} value={c}>{CATEGORY_LABELS[c] || c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={goalFilter} onValueChange={setGoalFilter}>
                  <SelectTrigger className="w-[220px]"><SelectValue placeholder="Goal" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All goals</SelectItem>
                    {goals.map(g => (
                      <SelectItem key={g} value={g}>{GOAL_LABELS[g] || g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {smsQuery.isLoading ? (
                <div className="space-y-2">
                  <div className="h-16 bg-muted animate-pulse rounded" />
                  <div className="h-16 bg-muted animate-pulse rounded" />
                </div>
              ) : filteredSms.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No templates match your filters.
                </div>
              ) : (
                <Accordion type="multiple" defaultValue={Array.from(groupedByGoal.keys())} className="space-y-2">
                  {Array.from(groupedByGoal.entries()).map(([goal, byCategory]) => {
                    const totalInGoal = Array.from(byCategory.values()).reduce((a, b) => a + b.length, 0);
                    return (
                      <AccordionItem key={goal} value={goal} className="border rounded-md px-3">
                        <AccordionTrigger className="hover:no-underline">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold">{GOAL_LABELS[goal] || goal}</span>
                            <Badge variant="secondary">{totalInGoal} messages</Badge>
                            <Badge variant="outline">{byCategory.size} stage{byCategory.size !== 1 ? 's' : ''}</Badge>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-4 pt-2">
                            {Array.from(byCategory.entries()).map(([cat, items]) => {
                              const isFollowup = FOLLOWUP_CATEGORIES.has(cat);
                              return (
                                <div key={cat} className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-semibold">{CATEGORY_LABELS[cat] || cat}</h4>
                                    <Badge variant={isFollowup ? 'default' : 'outline'} className="text-xs">
                                      {isFollowup ? 'Follow-up sequence' : 'Initial'}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">
                                      {items.length} message{items.length !== 1 ? 's' : ''}
                                    </span>
                                  </div>
                                  <div className="grid gap-2 md:grid-cols-2">
                                    {items.map((t, i) => renderTemplateCard(t, { index: isFollowup ? i : undefined, isFollowup }))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              )}
            </TabsContent>

            <TabsContent value="email" className="space-y-2">
              {emailQuery.isLoading ? (
                <div className="h-16 bg-muted animate-pulse rounded" />
              ) : emails.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No email templates yet.
                </div>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {emails.map(e => (
                    <div key={e.id} className="border rounded-md p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-sm">{e.name}</div>
                        <div className="flex gap-1">
                          {e.is_default && <Badge variant="default" className="text-xs">default</Badge>}
                          {!e.is_active && <Badge variant="secondary" className="text-xs">inactive</Badge>}
                          {e.template_type && <Badge variant="outline" className="text-xs">{e.template_type}</Badge>}
                        </div>
                      </div>
                      {e.subject && (
                        <div className="text-xs text-muted-foreground mt-1 truncate">
                          Subject: {e.subject}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Editor dialog */}
      <Dialog open={editor.open} onOpenChange={(open) => setEditor(s => ({ ...s, open }))}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editor.mode === 'edit' ? 'Edit Template' : 'New Template'}</DialogTitle>
            <DialogDescription>
              SMS template. Use {'{first_name}'} and other smart tags in the body.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={editor.name}
                onChange={(e) => setEditor(s => ({ ...s, name: e.target.value }))}
                placeholder="e.g. Storm Follow-up Day 3"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Goal</Label>
                <Select value={editor.goal} onValueChange={(v) => setEditor(s => ({ ...s, goal: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(GOAL_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={editor.category} onValueChange={(v) => setEditor(s => ({ ...s, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Message Body</Label>
              <Textarea
                value={editor.body}
                onChange={(e) => setEditor(s => ({ ...s, body: e.target.value }))}
                rows={8}
                placeholder="Hi {first_name}, ..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(s => ({ ...s, open: false }))}>Cancel</Button>
            <Button onClick={saveTemplate}>{editor.mode === 'edit' ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TemplatesLibrary;
