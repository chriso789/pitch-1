import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ArrowLeft, Send, Eye, Users, AlertTriangle, UserPlus, ListPlus, Phone, CheckCircle, Sparkles, FileText } from 'lucide-react';
import { TextBlastListBuilder } from './TextBlastListBuilder';
import { resolveSmsTags, SAMPLE_TAG_CONTEXT, SMS_AVAILABLE_TAGS } from '@/lib/smartTags/smsTagResolver';
import { useContactStatuses } from '@/hooks/useContactStatuses';
import { SmsBlastLaunchChecklist } from './SmsBlastLaunchChecklist';
import { LockedSmsPreviewTable } from './LockedSmsPreviewTable';
import { useSmsBlastMetrics } from '@/hooks/useSmsBlastMetrics';

const BATCH_SIZE_OPTIONS = [10, 20, 30, 40, 50, 100, 250, 500];

interface TextBlastCreatorProps {
  onBack: () => void;
  onCreated: (blastId: string) => void;
}

export const TextBlastCreator = ({ onBack, onCreated }: TextBlastCreatorProps) => {
  const { activeTenantId } = useActiveTenantId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { statuses: contactStatuses } = useContactStatuses();
  const [name, setName] = useState('');
  const [sendMode, setSendMode] = useState<'single' | 'list'>('list');
  const [selectedListId, setSelectedListId] = useState('');
  const [selectedStatusKey, setSelectedStatusKey] = useState<string>('');
  const [batchSize, setBatchSize] = useState<number>(10);
  const [manualPhone, setManualPhone] = useState('');
  const [manualName, setManualName] = useState('');
  const [singleContactId, setSingleContactId] = useState<string | null>(null);
  const [contactSearch, setContactSearch] = useState('');
  const [showContactResults, setShowContactResults] = useState(false);
  const [script, setScript] = useState('');
  const [maxAttemptsPerContact, setMaxAttemptsPerContact] = useState<number>(1);
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showListBuilder, setShowListBuilder] = useState(false);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [aiFollowupEnabled, setAiFollowupEnabled] = useState<boolean>(false);
  const [goal, setGoal] = useState<string>('');
  const [dryRun, setDryRun] = useState<boolean>(false);
  const [dryRunCompleted, setDryRunCompleted] = useState<boolean>(false);
  const [dryRunBlastId, setDryRunBlastId] = useState<string | null>(null);
  const metrics = useSmsBlastMetrics(dryRunBlastId, activeTenantId || null);

  // Fetch dialer lists
  const { data: lists } = useQuery({
    queryKey: ['dialer-lists', activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return [];
      const { data, error } = await supabase
        .from('dialer_lists')
        .select('id, name')
        .eq('tenant_id', activeTenantId)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId,
  });

  // Fetch contacts by selected status (test batch capped by batchSize)
  const { data: listItems } = useQuery({
    queryKey: ['blast-contacts-by-status', activeTenantId, selectedStatusKey, batchSize],
    queryFn: async () => {
      if (!activeTenantId || !selectedStatusKey) return [];
      const { data, error } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, phone')
        .eq('tenant_id', activeTenantId)
        .eq('qualification_status', selectedStatusKey)
        .eq('is_deleted', false)
        .not('phone', 'is', null)
        .limit(batchSize);
      if (error) throw error;
      return (data || []).map((c: any) => ({
        id: c.id,
        contact_id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        phone_number: c.phone,
      }));
    },
    enabled: !!activeTenantId && !!selectedStatusKey,
  });

  // Search contacts for single-number mode
  const { data: contactSearchResults } = useQuery({
    queryKey: ['blast-single-contact-search', activeTenantId, contactSearch],
    queryFn: async () => {
      if (!activeTenantId || contactSearch.trim().length < 2) return [];
      const term = `%${contactSearch.trim()}%`;
      const { data, error } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, phone')
        .eq('tenant_id', activeTenantId)
        .eq('is_deleted', false)
        .not('phone', 'is', null)
        .or(`first_name.ilike.${term},last_name.ilike.${term},phone.ilike.${term}`)
        .limit(8);
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId && sendMode === 'single' && contactSearch.trim().length >= 2,
  });

  // Pre-flight: for the email-capture campaign, count contacts missing address_street
  // and contacts that are already opted-out, BEFORE the user clicks Send. This is what
  // protects against blasting the wrong address to a homeowner.
  const isEmailCaptureGoal = goal === 'collect_homeowner_email_for_roof_estimate';
  const { data: preflight } = useQuery({
    queryKey: ['blast-preflight', activeTenantId, selectedStatusKey, sendMode, isEmailCaptureGoal, listItems?.length],
    queryFn: async () => {
      if (!activeTenantId || sendMode !== 'list' || !selectedStatusKey || !listItems?.length) {
        return { missingAddress: 0, optedOut: 0, eligible: 0 };
      }
      const contactIds = listItems.map((li: any) => li.contact_id).filter(Boolean);
      const phones = listItems.map((li: any) => li.phone_number).filter(Boolean);

      let missingAddress = 0;
      if (isEmailCaptureGoal && contactIds.length) {
        const { data: cs } = await supabase
          .from('contacts')
          .select('id, address_street')
          .in('id', contactIds);
        const withAddr = new Set((cs || []).filter(c => c.address_street && String(c.address_street).trim()).map(c => c.id));
        missingAddress = listItems.filter((li: any) => !li.contact_id || !withAddr.has(li.contact_id)).length;
      }

      let optedOut = 0;
      if (phones.length) {
        const { data: oo } = await supabase
          .from('opt_outs')
          .select('phone')
          .eq('tenant_id', activeTenantId)
          .eq('channel', 'sms')
          .in('phone', phones);
        optedOut = (oo || []).length;
      }
      const eligible = Math.max(0, listItems.length - missingAddress - optedOut);
      return { missingAddress, optedOut, eligible };
    },
    enabled: !!activeTenantId && sendMode === 'list' && !!selectedStatusKey && !!listItems?.length,
  });
  // Fetch SMS templates (smart-tag enabled, used for MSFH-style rotation pools)
  const { data: templates } = useQuery({
    queryKey: ['sms-templates', activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return [];
      const { data, error } = await supabase
        .from('sms_templates')
        .select('id, template_name, template_body, category, goal')
        .eq('tenant_id', activeTenantId)
        .eq('active', true)
        .order('template_name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId,
  });

  const recipientCount = sendMode === 'single' ? (manualPhone.trim() ? 1 : 0) : (listItems?.length || 0);

  // Smart-tag aware preview (MSFH-ready). Uses a real-looking FL sample context.
  const sampleCtx = sendMode === 'single' && (manualName || manualPhone)
    ? {
        ...SAMPLE_TAG_CONTEXT,
        contact: {
          ...SAMPLE_TAG_CONTEXT.contact,
          first_name: manualName.split(' ')[0] || SAMPLE_TAG_CONTEXT.contact?.first_name,
          last_name: manualName.split(' ').slice(1).join(' ') || SAMPLE_TAG_CONTEXT.contact?.last_name,
          phone: manualPhone || SAMPLE_TAG_CONTEXT.contact?.phone,
        },
      }
    : SAMPLE_TAG_CONTEXT;

  const previewMessage = resolveSmsTags(script, sampleCtx);

  const hasStopClause = /stop/i.test(script);
  const finalPreview = hasStopClause ? previewMessage : previewMessage + '\n\nReply STOP to opt out.';

  const isValid = sendMode === 'single'
    ? name.trim() && manualPhone.trim() && script.trim()
    : name.trim() && selectedStatusKey && script.trim() && (listItems?.length || 0) > 0;

  const handleSend = async () => {
    if (!isValid || !activeTenantId) return;

    // Production gate: email-capture goal must complete a dry-run first
    if (!dryRun && isEmailCaptureGoal && !dryRunCompleted) {
      toast({
        title: 'Dry-run required',
        description: 'Run a dry-run first so we can verify every address and message before sending.',
        variant: 'destructive',
      });
      return;
    }

    setSending(true);
    try {
      if (sendMode === 'single') {
        // Single number mode
        const { data: blast, error: blastError } = await supabase
          .from('sms_blasts')
          .insert({
            tenant_id: activeTenantId,
            name: name.trim(),
            script: script.trim(),
            list_id: null,
            total_recipients: 1,
            max_attempts_per_contact: maxAttemptsPerContact,
            status: 'draft',
            template_pool_ids: selectedTemplateIds.length ? selectedTemplateIds : null,
            ai_followup_enabled: aiFollowupEnabled,
            goal: goal || null,
          })
          .select()
          .single();

        if (blastError) throw blastError;

        const { error: itemsError } = await supabase
          .from('sms_blast_items')
          .insert({
            blast_id: blast.id,
            tenant_id: activeTenantId,
            contact_id: singleContactId,
            phone: manualPhone.trim(),
            contact_name: manualName.trim() || null,
            status: 'pending',
          });

        if (itemsError) throw itemsError;

        // Personalize messages first (locks `personalized_message` per item before any send)
        await supabase.functions.invoke('generate-campaign-messages', {
          body: { blast_id: blast.id },
        });

        if (!dryRun) {
          const { error: processorError } = await supabase.functions.invoke('sms-blast-processor', {
            body: { blast_id: blast.id },
          });
          if (processorError) {
            toast({ title: 'Blast created but processing failed', description: processorError.message, variant: 'destructive' });
          } else {
            toast({ title: 'Text Blast Started!', description: `Sending to 1 recipient...` });
          }
        } else {
          setDryRunCompleted(true);
          setDryRunBlastId(blast.id);
          toast({ title: 'Dry run complete', description: 'Messages rendered. Nothing was sent.' });
        }

        if (!dryRun) onCreated(blast.id);
      } else {
        // List mode (existing logic)
        const { data: blast, error: blastError } = await supabase
          .from('sms_blasts')
          .insert({
            tenant_id: activeTenantId,
            name: name.trim(),
            script: script.trim(),
            list_id: null,
            total_recipients: listItems!.length,
            max_attempts_per_contact: maxAttemptsPerContact,
            status: 'draft',
            template_pool_ids: selectedTemplateIds.length ? selectedTemplateIds : null,
            ai_followup_enabled: aiFollowupEnabled,
            goal: goal || null,
          })
          .select()
          .single();

        if (blastError) throw blastError;

        const items = listItems!.map((li: any) => ({
          blast_id: blast.id,
          tenant_id: activeTenantId,
          contact_id: li.contact_id || null,
          phone: li.phone_number,
          contact_name: [li.first_name, li.last_name].filter(Boolean).join(' ') || null,
          status: 'pending',
        }));

        const { error: itemsError } = await supabase
          .from('sms_blast_items')
          .insert(items);

        if (itemsError) throw itemsError;

        // Personalize messages first (locks `personalized_message` per item before any send).
        // This is the safety gate that prevents address-cross-contamination on email-capture campaigns.
        await supabase.functions.invoke('generate-campaign-messages', {
          body: { blast_id: blast.id },
        });

        if (!dryRun) {
          const { error: processorError } = await supabase.functions.invoke('sms-blast-processor', {
            body: { blast_id: blast.id },
          });
          if (processorError) {
            toast({ title: 'Blast created but processing failed', description: processorError.message, variant: 'destructive' });
          } else {
            toast({ title: 'Text Blast Started!', description: `Sending to ${listItems!.length} recipients...` });
          }
        } else {
          toast({ title: 'Dry run complete', description: `Rendered ${listItems!.length} messages. Nothing was sent.` });
        }

        onCreated(blast.id);
      }
    } catch (error: any) {
      console.error('Error creating blast:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const handleListCreated = (listId: string) => {
    queryClient.invalidateQueries({ queryKey: ['dialer-lists', activeTenantId] });
    setSelectedListId(listId);
  };

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-auto">
      <div className="flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <h2 className="text-lg font-semibold">New Text Blast</h2>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left: Form */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Campaign Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="blast-name">Campaign Name</Label>
                <Input
                  id="blast-name"
                  placeholder="e.g., Spring Roofing Follow-Up"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              {/* Send Mode Toggle */}
              <div className="space-y-2">
                <Label>Send To</Label>
                <RadioGroup
                  value={sendMode}
                  onValueChange={(v) => setSendMode(v as 'single' | 'list')}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="single" id="mode-single" />
                    <Label htmlFor="mode-single" className="cursor-pointer flex items-center gap-1.5 font-normal">
                      <Phone className="h-3.5 w-3.5" />
                      Single Number
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="list" id="mode-list" />
                    <Label htmlFor="mode-list" className="cursor-pointer flex items-center gap-1.5 font-normal">
                      <Users className="h-3.5 w-3.5" />
                      Contact List
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {sendMode === 'single' ? (
                <div className="space-y-3 p-3 rounded-md border border-border bg-muted/30">
                  <div className="relative">
                    <Label htmlFor="contact-search">Find Contact</Label>
                    <Input
                      id="contact-search"
                      placeholder="Search by name or phone..."
                      value={contactSearch}
                      onChange={(e) => {
                        setContactSearch(e.target.value);
                        setShowContactResults(true);
                        if (singleContactId) setSingleContactId(null);
                      }}
                      onFocus={() => setShowContactResults(true)}
                      onBlur={() => setTimeout(() => setShowContactResults(false), 200)}
                    />
                    {showContactResults && (contactSearchResults?.length ?? 0) > 0 && !singleContactId && (
                      <div className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-md border border-border bg-popover shadow-md">
                        {contactSearchResults!.map((c: any) => {
                          const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ');
                          return (
                            <button
                              key={c.id}
                              type="button"
                              className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex justify-between gap-2"
                              onClick={() => {
                                setSingleContactId(c.id);
                                setManualPhone(c.phone || '');
                                setManualName(fullName);
                                setContactSearch(fullName || c.phone || '');
                                setShowContactResults(false);
                              }}
                            >
                              <span className="font-medium">{fullName || '(no name)'}</span>
                              <span className="text-muted-foreground">{c.phone}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {singleContactId && (
                      <p className="text-xs text-primary mt-1 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" /> Linked to contact
                        <button
                          type="button"
                          className="ml-2 underline text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setSingleContactId(null);
                            setContactSearch('');
                            setManualPhone('');
                            setManualName('');
                          }}
                        >
                          clear
                        </button>
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="manual-phone">Phone Number *</Label>
                    <Input
                      id="manual-phone"
                      placeholder="+1 (555) 123-4567"
                      value={manualPhone}
                      onChange={(e) => setManualPhone(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="manual-name">Recipient Name (optional)</Label>
                    <Input
                      id="manual-name"
                      placeholder="John Smith"
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Contact Status</Label>
                      <Select value={selectedStatusKey} onValueChange={setSelectedStatusKey}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a status" />
                        </SelectTrigger>
                        <SelectContent>
                          {contactStatuses.map((s) => (
                            <SelectItem key={s.key} value={s.key}>
                              <span className="inline-flex items-center gap-2">
                                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                                {s.name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Test Batch Size</Label>
                      <Select value={String(batchSize)} onValueChange={(v) => setBatchSize(Number(v))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BATCH_SIZE_OPTIONS.map((n) => (
                            <SelectItem key={n} value={String(n)}>{n} contacts</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Sends to the first {batchSize} contacts with this status — use small batches to test before scaling up.
                  </p>
                  {selectedStatusKey && (
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">{listItems?.length || 0} recipients (capped at {batchSize})</span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Templates & Smart Tags
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Campaign Goal</Label>
                <Select value={goal || 'none'} onValueChange={(v) => setGoal(v === 'none' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a goal" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">General outreach</SelectItem>
                    <SelectItem value="msfh_grant">My Safe Florida Home (MSFH) Grant</SelectItem>
                    <SelectItem value="collect_homeowner_email_for_roof_estimate">Roof Estimate Email Capture — MSFH</SelectItem>
                    <SelectItem value="storm_canvass">Storm Canvass Follow-up</SelectItem>
                    <SelectItem value="dormant_reactivation">Dormant Lead Reactivation</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Template Rotation Pool (optional)</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Pick 2+ templates to randomly rotate per recipient — reduces carrier spam flags. Leave empty to use the single Message Script below.
                </p>
                <div className="space-y-1.5 max-h-44 overflow-y-auto rounded-md border border-border p-2">
                  {!templates?.length && (
                    <p className="text-xs text-muted-foreground italic px-1 py-2">No templates yet for this tenant.</p>
                  )}
                  {templates?.filter((t: any) => !goal || !t.goal || t.goal === goal).map((t: any) => {
                    const checked = selectedTemplateIds.includes(t.id);
                    return (
                      <label key={t.id} className="flex items-start gap-2 p-1.5 rounded hover:bg-muted/50 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={checked}
                          onChange={(e) => {
                            setSelectedTemplateIds((prev) =>
                              e.target.checked ? [...prev, t.id] : prev.filter((id) => id !== t.id)
                            );
                            if (e.target.checked && !script.trim()) setScript(t.template_body);
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium truncate">{t.template_name}</span>
                            {t.category && <Badge variant="outline" className="text-[10px] py-0">{t.category}</Badge>}
                          </div>
                          <p className="text-[11px] text-muted-foreground line-clamp-2">{t.template_body}</p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-[11px] h-6 px-2"
                          onClick={(e) => { e.preventDefault(); setScript(t.template_body); }}
                        >
                          Use
                        </Button>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border border-border p-2.5">
                <div className="flex items-start gap-2">
                  <Sparkles className="h-4 w-4 text-primary mt-0.5" />
                  <div>
                    <p className="text-xs font-medium">AI Follow-up Agent</p>
                    <p className="text-[11px] text-muted-foreground">Consultative auto-replies on positive intent (MSFH-aware)</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={aiFollowupEnabled}
                  onChange={(e) => setAiFollowupEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Message Script</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="script">Message</Label>
                <Textarea
                  id="script"
                  placeholder="Hi {{contact.first_name}}, this is {{assigned_user.first_name}} with {{company.name}}..."
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  rows={6}
                />
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {SMS_AVAILABLE_TAGS.map((t) => (
                    <button
                      key={t.tag}
                      type="button"
                      onClick={() => setScript((s) => s + (s.endsWith(' ') || !s ? '' : ' ') + t.tag)}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/70 font-mono"
                      title={t.label}
                    >
                      {t.tag}
                    </button>
                  ))}
                </div>
              </div>

              {!hasStopClause && script.trim() && (
                <div className="flex items-start gap-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    "Reply STOP to opt out" will be automatically appended for TCPA compliance.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>


          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                Throttle & Verification Agents
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="max-attempts">Repeat Attempts Per Contact</Label>
                <Input
                  id="max-attempts"
                  type="number"
                  min={1}
                  max={10}
                  value={maxAttemptsPerContact}
                  onChange={(e) => setMaxAttemptsPerContact(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Each contact will be messaged up to <span className="font-medium">{maxAttemptsPerContact}</span> time{maxAttemptsPerContact !== 1 ? 's' : ''} total. Retries stop immediately on reply, <span className="font-mono">NO</span>, or <span className="font-mono">STOP</span>. Throughput scales with the number of contacts in the run — it is not a daily volume cap.
                </p>
              </div>

              <div className="rounded-md border border-border bg-muted/40 p-3 space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Per-Contact Cadence Rule
                </p>
                <p className="text-xs text-foreground">
                  <span className="font-medium">One message per contact per 24h, up to {maxAttemptsPerContact} attempt{maxAttemptsPerContact !== 1 ? 's' : ''} total.</span> Subsequent attempts are spaced 24h apart and stop the moment the contact replies or sends <span className="font-mono">NO / STOP</span>. The system rotates across tenant numbers to find the right match before counting an attempt as exhausted.
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Active Agents
                </p>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-start gap-2">
                    <CheckCircle className="h-3.5 w-3.5 text-green-600 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-medium">Delivery Verifier</span>
                      <span className="text-muted-foreground"> — tracks which numbers received, delivered, and replied (via Telnyx status webhook). Enforces the 1-per-number-per-day cap.</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="h-3.5 w-3.5 text-green-600 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-medium">Routing Verifier</span>
                      <span className="text-muted-foreground"> — confirms each number maps to the intended contact across the tenant's number pool; routes inbound replies back to that contact and stops the cadence on reply / NO / STOP.</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {sendMode === 'list' && preflight && (preflight.missingAddress > 0 || preflight.optedOut > 0 || isEmailCaptureGoal) && (
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pre-flight summary</p>
              <div className="text-xs grid grid-cols-3 gap-2">
                <div><span className="font-semibold text-foreground">{preflight.eligible}</span> <span className="text-muted-foreground">eligible</span></div>
                <div><span className="font-semibold text-amber-600">{preflight.missingAddress}</span> <span className="text-muted-foreground">missing address</span></div>
                <div><span className="font-semibold text-destructive">{preflight.optedOut}</span> <span className="text-muted-foreground">opted out</span></div>
              </div>
              {isEmailCaptureGoal && preflight.missingAddress > 0 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  Email-capture campaigns auto-skip contacts without a street address — these {preflight.missingAddress} will not be sent.
                </p>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="h-4 w-4"
            />
            Dry run — render and store messages, do NOT send via Telnyx
          </label>

          <div className="flex gap-2">


            <Button
              onClick={handleSend}
              disabled={sending || !isValid}
              className="flex-1"
            >
              <Send className="h-4 w-4 mr-2" />
              {sending ? 'Creating...' : dryRun ? `Dry-run render for ${recipientCount}` : `Send to ${recipientCount} Recipient${recipientCount !== 1 ? 's' : ''}`}
            </Button>
            <Button variant="outline" onClick={() => setShowPreview(!showPreview)}>
              <Eye className="h-4 w-4 mr-2" />
              Preview
            </Button>
          </div>
        </div>

        {/* Right: Preview */}
        <div>
          {(showPreview || script.trim()) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Message Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-muted rounded-lg p-4">
                  <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-sm p-3 max-w-[280px] ml-auto">
                    <p className="text-sm whitespace-pre-wrap">{finalPreview || 'Start typing your message...'}</p>
                  </div>
                  <p className="text-xs text-muted-foreground text-right mt-2">Preview with sample data</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <TextBlastListBuilder
        open={showListBuilder}
        onOpenChange={setShowListBuilder}
        onListCreated={handleListCreated}
      />
    </div>
  );
};
