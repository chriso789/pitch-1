import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { useLocation } from '@/contexts/LocationContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ArrowLeft, Send, Eye, Users, AlertTriangle, UserPlus, ListPlus, Phone, CheckCircle, Sparkles, FileText, Pencil, Save, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { TextBlastListBuilder } from './TextBlastListBuilder';
import { resolveSmsTags, SAMPLE_TAG_CONTEXT, SMS_AVAILABLE_TAGS } from '@/lib/smartTags/smsTagResolver';
import { useContactStatuses } from '@/hooks/useContactStatuses';
import { SmsBlastLaunchChecklist } from './SmsBlastLaunchChecklist';
import { LockedSmsPreviewTable } from './LockedSmsPreviewTable';
import { useSmsBlastMetrics } from '@/hooks/useSmsBlastMetrics';

const BATCH_SIZE_OPTIONS = [10, 20, 30, 40, 50, 100, 250, 500];

const normalizeTemplateText = (value: string | null | undefined) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const getDefaultScriptForGoal = (goal: string) => {
  switch (goal) {
    case 'collect_homeowner_email_for_roof_estimate':
      return `Hi {{contact.first_name}}, we have a roof replacement estimate ready for {{contact.address_street}}. What's the best email to send it to?\n\nWe can also help walk you through the My Safe Florida Home Program, which may provide up to $10,000 toward a qualifying roof replacement.`;
    case 'msfh_grant':
      return `Hi {{contact.first_name}}, Florida homeowners may qualify for help through the My Safe Florida Home Program. We help walk people through the roof grant process from inspection to paperwork.\n\nWould you like us to check {{contact.address_street}}?`;
    case 'storm_canvass':
      return `Hi {{contact.first_name}}, we're checking roofs near {{contact.address_street}} after recent storms. If you'd like, we can do a quick roof review and let you know if there are issues before they turn into leaks.`;
    case 'dormant_reactivation':
      return `Hi {{contact.first_name}}, we had your property at {{contact.address_street}} in our system and wanted to follow up. Are you still considering roof repair or replacement options this year?`;
    case 'general_outreach':
    default:
      return `Hi {{contact.first_name}}, this is {{company.name}}. We're following up about {{contact.address_street}}. Would you like us to send over more information?`;
  }
};

interface TextBlastCreatorProps {
  onBack: () => void;
  onCreated: (blastId: string) => void;
}

export const TextBlastCreator = ({ onBack, onCreated }: TextBlastCreatorProps) => {
  const { activeTenantId } = useActiveTenantId();
  const { currentLocationId } = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { statuses: contactStatuses } = useContactStatuses();
  const [name, setName] = useState('');
  const [sendMode, setSendMode] = useState<'single' | 'list' | 'custom'>('list');
  const [customContacts, setCustomContacts] = useState<any[]>([]);
  const [customSearch, setCustomSearch] = useState('');
  const [showCustomResults, setShowCustomResults] = useState(false);
  const [selectedListId, setSelectedListId] = useState('');
  const [selectedStatusKey, setSelectedStatusKey] = useState<string>('');
  const [batchSize, setBatchSize] = useState<number>(10);
  const [manualPhone, setManualPhone] = useState('');
  const [manualName, setManualName] = useState('');
  const [selectedContactAddress, setSelectedContactAddress] = useState<{ street?: string; city?: string; state?: string; zip?: string } | null>(null);

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
  const [goal, setGoal] = useState<string>('general_outreach');
  const [dryRun, setDryRun] = useState<boolean>(false);
  const [dryRunCompleted, setDryRunCompleted] = useState<boolean>(false);
  const [dryRunBlastId, setDryRunBlastId] = useState<string | null>(null);
  const [previewTemplateIndex, setPreviewTemplateIndex] = useState(0);
  const [rotateTemplates, setRotateTemplates] = useState<boolean>(false);
  const [excludePriorBlasts, setExcludePriorBlasts] = useState<boolean>(true);
  const lastGoalRef = useRef<string>('');

  // Template editor state — save/edit sms_templates for this tenant
  const [tplEditor, setTplEditor] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    id?: string;
    name: string;
    body: string;
    goal: string;
    category: string;
  }>({ open: false, mode: 'create', name: '', body: '', goal: 'general_outreach', category: 'general' });
  const [savingTpl, setSavingTpl] = useState(false);

  const openCreateTemplate = () => {
    setTplEditor({
      open: true,
      mode: 'create',
      name: '',
      body: script || '',
      goal: goal || 'general_outreach',
      category: 'general',
    });
  };

  const openEditTemplate = (t: any) => {
    setTplEditor({
      open: true,
      mode: 'edit',
      id: t.id,
      name: t.template_name || '',
      body: t.template_body || '',
      goal: t.goal || 'general_outreach',
      category: t.category || 'general',
    });
  };

  const saveTemplate = async () => {
    if (!activeTenantId) {
      toast({ title: 'No active workspace', variant: 'destructive' });
      return;
    }
    const trimmedName = tplEditor.name.trim();
    const trimmedBody = tplEditor.body.trim();
    if (!trimmedName || !trimmedBody) {
      toast({ title: 'Name and message body are required', variant: 'destructive' });
      return;
    }
    setSavingTpl(true);
    try {
      if (tplEditor.mode === 'edit' && tplEditor.id) {
        const { error } = await supabase
          .from('sms_templates')
          .update({
            template_name: trimmedName,
            template_body: trimmedBody,
            goal: tplEditor.goal,
            category: tplEditor.category || null,
            active: true,
          })
          .eq('id', tplEditor.id)
          .eq('tenant_id', activeTenantId);
        if (error) throw error;
        toast({ title: 'Template updated' });
      } else {
        const { data, error } = await supabase
          .from('sms_templates')
          .insert({
            tenant_id: activeTenantId,
            template_name: trimmedName,
            template_body: trimmedBody,
            goal: tplEditor.goal,
            category: tplEditor.category || null,
            active: true,
          })
          .select('id')
          .single();
        if (error) throw error;
        toast({ title: 'Template saved' });
        if (data?.id) setSelectedTemplateIds((prev) => Array.from(new Set([...prev, data.id])));
      }
      queryClient.invalidateQueries({ queryKey: ['sms-templates', activeTenantId] });
      setTplEditor((s) => ({ ...s, open: false }));
    } catch (err: any) {
      toast({ title: 'Save failed', description: err?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setSavingTpl(false);
    }
  };

  const metrics = useSmsBlastMetrics(dryRunBlastId, activeTenantId || null);
  const isTestBlast = /\btest\b/i.test(name.trim()) || sendMode === 'single' || batchSize <= 10;

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
        .select('id, first_name, last_name, phone, address_street, address_city, address_state, address_zip')
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


  // Search contacts for custom-list mode (multi-select)
  const { data: customSearchResults } = useQuery({
    queryKey: ['blast-custom-contact-search', activeTenantId, customSearch],
    queryFn: async () => {
      if (!activeTenantId || customSearch.trim().length < 2) return [];
      const term = `%${customSearch.trim()}%`;
      const { data, error } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, phone')
        .eq('tenant_id', activeTenantId)
        .eq('is_deleted', false)
        .not('phone', 'is', null)
        .or(`first_name.ilike.${term},last_name.ilike.${term},phone.ilike.${term}`)
        .limit(15);
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId && sendMode === 'custom' && customSearch.trim().length >= 2,
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
        .select('id, template_name, template_body, category, goal, followup_delay_days')
        .eq('tenant_id', activeTenantId)
        .eq('active', true)
        .order('template_name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId,
  });

  // Dedupe templates (tenant + goal + normalized name + normalized body).
  const dedupedTemplates = useMemo(() => {
    const seen = new Set<string>();
    return (templates || []).filter((t: any) => {
      const key = [
        t.tenant_id || activeTenantId || '',
        t.goal || '',
        normalizeTemplateText(t.template_name),
        normalizeTemplateText(t.template_body),
      ].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [templates, activeTenantId]);

  const goalMatches = (t: any) => {
    if (goal === 'general_outreach') return !t.goal || t.goal === 'general_outreach';
    return t.goal === goal;
  };

  const visibleTemplates = useMemo(
    () => dedupedTemplates.filter(goalMatches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dedupedTemplates, goal]
  );

  const FOLLOWUP_CATEGORIES = useMemo(
    () => new Set(['storm_followup', 'grant_followup', 'reactivation', 'followup']),
    []
  );
  const DELAY_OPTIONS = [1, 2, 3, 5, 7, 10, 14, 21, 30];

  const isFollowupTemplate = (t: any) =>
    FOLLOWUP_CATEGORIES.has(String(t.category || '').toLowerCase()) ||
    (typeof t.followup_delay_days === 'number' && t.followup_delay_days > 0);

  const { initialTemplates, followupTemplates } = useMemo(() => {
    const initial: any[] = [];
    const followup: any[] = [];
    for (const t of visibleTemplates) {
      (isFollowupTemplate(t) ? followup : initial).push(t);
    }
    followup.sort((a, b) => (a.followup_delay_days ?? 2) - (b.followup_delay_days ?? 2));
    return { initialTemplates: initial, followupTemplates: followup };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTemplates]);

  const formatDelayLabel = (d: number) =>
    d === 0 ? 'Same day' : d === 1 ? '1 day later' : `${d} days later`;

  const updateTemplateDelay = async (templateId: string, days: number) => {
    if (!activeTenantId) return;
    const { error } = await supabase
      .from('sms_templates')
      .update({ followup_delay_days: days })
      .eq('id', templateId)
      .eq('tenant_id', activeTenantId);
    if (error) {
      toast({ title: 'Could not update schedule', description: error.message, variant: 'destructive' });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['sms-templates', activeTenantId] });
  };

  // When Campaign Goal changes: clear selection, auto-pick top templates, reset preview.
  useEffect(() => {
    if (lastGoalRef.current === goal) return;
    lastGoalRef.current = goal;

    setDryRunCompleted(false);
    setDryRunBlastId(null);
    setPreviewTemplateIndex(0);

    const matches = dedupedTemplates.filter(goalMatches);
    if (matches.length > 0) {
      const top = matches.slice(0, 3);
      setSelectedTemplateIds(top.map((t: any) => t.id));
      setScript(top[0].template_body || '');
    } else {
      setSelectedTemplateIds([]);
      setScript(getDefaultScriptForGoal(goal));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal, dedupedTemplates]);

  // Reset preview index when selected templates change
  useEffect(() => {
    setPreviewTemplateIndex(0);
  }, [selectedTemplateIds.join('|')]);

  // Prior-blast recipients to exclude (any contact this tenant has already
  // messaged through a previous blast). Phones come back in multiple formats;
  // we normalize to last-10-digits for comparison.
  const { data: priorRecipients } = useQuery({
    queryKey: ['blast-prior-recipients', activeTenantId, excludePriorBlasts],
    queryFn: async () => {
      if (!activeTenantId || !excludePriorBlasts) return { contactIds: new Set<string>(), phoneLast10: new Set<string>() };
      const { data, error } = await supabase
        .from('sms_blast_items')
        .select('contact_id, phone, status')
        .eq('tenant_id', activeTenantId)
        .in('status', ['sent', 'delivered', 'replied', 'opted_out']);
      if (error) throw error;
      const contactIds = new Set<string>();
      const phoneLast10 = new Set<string>();
      for (const r of data || []) {
        if (r.contact_id) contactIds.add(r.contact_id as string);
        const digits = String(r.phone || '').replace(/\D/g, '');
        if (digits.length >= 10) phoneLast10.add(digits.slice(-10));
      }
      return { contactIds, phoneLast10 };
    },
    enabled: !!activeTenantId && excludePriorBlasts,
  });

  const rawListItems = sendMode === 'custom' ? customContacts : (listItems || []);
  const effectiveListItems = excludePriorBlasts && priorRecipients
    ? rawListItems.filter((li: any) => {
        if (li.contact_id && priorRecipients.contactIds.has(li.contact_id)) return false;
        const digits = String(li.phone_number || '').replace(/\D/g, '');
        if (digits.length >= 10 && priorRecipients.phoneLast10.has(digits.slice(-10))) return false;
        return true;
      })
    : rawListItems;
  const excludedCount = rawListItems.length - effectiveListItems.length;
  const recipientCount = sendMode === 'single' ? (manualPhone.trim() ? 1 : 0) : effectiveListItems.length;

  // Smart-tag aware preview (MSFH-ready). Uses a real-looking FL sample context.
  const sampleCtx = sendMode === 'single' && (manualName || manualPhone)
    ? {
        ...SAMPLE_TAG_CONTEXT,
        contact: {
          ...SAMPLE_TAG_CONTEXT.contact,
          first_name: manualName.split(' ')[0] || SAMPLE_TAG_CONTEXT.contact?.first_name,
          last_name: manualName.split(' ').slice(1).join(' ') || SAMPLE_TAG_CONTEXT.contact?.last_name,
          phone: manualPhone || SAMPLE_TAG_CONTEXT.contact?.phone,
          address1: selectedContactAddress?.street || SAMPLE_TAG_CONTEXT.contact?.address1,
          city: selectedContactAddress?.city || SAMPLE_TAG_CONTEXT.contact?.city,
          state: selectedContactAddress?.state || SAMPLE_TAG_CONTEXT.contact?.state,
          zip: selectedContactAddress?.zip || SAMPLE_TAG_CONTEXT.contact?.zip,
        },
      }
    : SAMPLE_TAG_CONTEXT;


  const selectedTemplates = useMemo(
    () => dedupedTemplates.filter((t: any) => selectedTemplateIds.includes(t.id)),
    [dedupedTemplates, selectedTemplateIds]
  );

  const activePreviewTemplate = selectedTemplates.length
    ? selectedTemplates[previewTemplateIndex % selectedTemplates.length]
    : null;

  const previewSourceScript = activePreviewTemplate?.template_body || script;

  const previewMessage = resolveSmsTags(previewSourceScript, sampleCtx);

  const hasStopClause = /stop/i.test(previewSourceScript);
  const finalPreview = hasStopClause ? previewMessage : previewMessage + '\n\nReply STOP to opt out.';

  // Source of truth for what actually gets sent:
  // - Rotation OFF (default): only the previewed template is sent to every recipient.
  // - Rotation ON: rotate across all selected templates.
  const effectiveTemplatePoolIds =
    rotateTemplates && selectedTemplateIds.length > 1
      ? selectedTemplateIds
      : activePreviewTemplate
        ? [activePreviewTemplate.id]
        : selectedTemplateIds.length
          ? [selectedTemplateIds[0]]
          : null;
  const effectiveScript = activePreviewTemplate?.template_body?.trim() || script.trim();

  const isValid = sendMode === 'single'
    ? !!(name.trim() && manualPhone.trim() && script.trim())
    : sendMode === 'custom'
      ? !!(name.trim() && script.trim() && customContacts.length > 0)
      : !!(name.trim() && selectedStatusKey && script.trim() && (listItems?.length || 0) > 0);

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
            from_location_id: currentLocationId,
            name: name.trim(),
            script: effectiveScript,
            list_id: null,
            total_recipients: 1,
            max_attempts_per_contact: maxAttemptsPerContact,
            status: 'draft',
            is_test_mode: isTestBlast,
            template_pool_ids: effectiveTemplatePoolIds,
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
            from_location_id: currentLocationId,
            name: name.trim(),
            script: effectiveScript,
            list_id: null,
            total_recipients: effectiveListItems.length,
            max_attempts_per_contact: maxAttemptsPerContact,
            status: 'draft',
            is_test_mode: isTestBlast,
            template_pool_ids: effectiveTemplatePoolIds,
            ai_followup_enabled: aiFollowupEnabled,
            goal: goal || null,
          })
          .select()
          .single();

        if (blastError) throw blastError;

        const items = effectiveListItems.map((li: any) => ({
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
            toast({ title: 'Text Blast Started!', description: `Sending to ${effectiveListItems.length} recipients...` });
          }
        } else {
          setDryRunCompleted(true);
          setDryRunBlastId(blast.id);
          toast({ title: 'Dry run complete', description: `Rendered ${effectiveListItems.length} messages. Nothing was sent.` });
        }

        if (!dryRun) onCreated(blast.id);
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

      <div className="grid gap-4 xl:grid-cols-5">
        {/* Left: Form */}
        <div className="space-y-4 xl:col-span-3">
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
                  onValueChange={(v) => setSendMode(v as 'single' | 'list' | 'custom')}
                  className="flex flex-wrap gap-4"
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
                      By Status
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="custom" id="mode-custom" />
                    <Label htmlFor="mode-custom" className="cursor-pointer flex items-center gap-1.5 font-normal">
                      <ListPlus className="h-3.5 w-3.5" />
                      Custom List
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {sendMode !== 'single' && (
                <label className="flex items-start gap-2 p-3 rounded-md border border-border bg-muted/20 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={excludePriorBlasts}
                    onChange={(e) => setExcludePriorBlasts(e.target.checked)}
                  />
                  <span className="text-sm">
                    <span className="font-medium">Exclude contacts already messaged in past blasts</span>
                    <span className="block text-xs text-muted-foreground">
                      Prevents resending to anyone who's been included in a prior blast (sent, delivered, replied, or opted-out).
                      {excludedCount > 0 && (
                        <> Filtering out <strong>{excludedCount}</strong> contact{excludedCount === 1 ? '' : 's'} from this list.</>
                      )}
                    </span>
                  </span>
                </label>
              )}


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
                                setSelectedContactAddress({
                                  street: c.address_street || '',
                                  city: c.address_city || '',
                                  state: c.address_state || '',
                                  zip: c.address_zip || '',
                                });
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
                            setSelectedContactAddress(null);
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
              ) : sendMode === 'custom' ? (
                <div className="space-y-3 p-3 rounded-md border border-border bg-muted/30">
                  <div className="relative">
                    <Label htmlFor="custom-contact-search">Search Contacts</Label>
                    <Input
                      id="custom-contact-search"
                      placeholder="Search by name or phone, then click to add..."
                      value={customSearch}
                      onChange={(e) => { setCustomSearch(e.target.value); setShowCustomResults(true); }}
                      onFocus={() => setShowCustomResults(true)}
                      onBlur={() => setTimeout(() => setShowCustomResults(false), 200)}
                    />
                    {showCustomResults && (customSearchResults?.length ?? 0) > 0 && (
                      <div className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-md border border-border bg-popover shadow-md">
                        {customSearchResults!
                          .filter((c: any) => !customContacts.some(cc => cc.contact_id === c.id))
                          .map((c: any) => {
                            const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ');
                            return (
                              <button
                                key={c.id}
                                type="button"
                                className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex justify-between gap-2"
                                onClick={() => {
                                  setCustomContacts(prev => [...prev, {
                                    id: c.id,
                                    contact_id: c.id,
                                    first_name: c.first_name,
                                    last_name: c.last_name,
                                    phone_number: c.phone,
                                  }]);
                                  setCustomSearch('');
                                  setShowCustomResults(false);
                                }}
                              >
                                <span className="font-medium">{fullName || '(no name)'}</span>
                                <span className="text-muted-foreground">{c.phone}</span>
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                      <Users className="h-4 w-4" />
                      {customContacts.length} recipient{customContacts.length === 1 ? '' : 's'} selected
                    </span>
                    {customContacts.length > 0 && (
                      <button
                        type="button"
                        className="text-xs underline text-muted-foreground hover:text-foreground"
                        onClick={() => setCustomContacts([])}
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                  {customContacts.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto p-2 rounded border border-border bg-background">
                      {customContacts.map((c) => {
                        const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ');
                        return (
                          <Badge key={c.contact_id} variant="secondary" className="gap-1.5">
                            <span>{fullName || c.phone_number}</span>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() => setCustomContacts(prev => prev.filter(p => p.contact_id !== c.contact_id))}
                              aria-label={`Remove ${fullName}`}
                            >
                              ×
                            </button>
                          </Badge>
                        );
                      })}
                    </div>
                  )}
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
                <Select value={goal || 'general_outreach'} onValueChange={(v) => setGoal(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a goal" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general_outreach">General outreach</SelectItem>
                    <SelectItem value="msfh_grant">My Safe Florida Home (MSFH) Grant</SelectItem>
                    <SelectItem value="collect_homeowner_email_for_roof_estimate">Roof Estimate Email Capture — MSFH</SelectItem>
                    <SelectItem value="storm_canvass">Storm Canvass Follow-up</SelectItem>
                    <SelectItem value="dormant_reactivation">Dormant Lead Reactivation</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>Template Rotation Pool (optional)</Label>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-[11px] h-6 px-2"
                      onClick={openCreateTemplate}
                    >
                      <Plus className="h-3 w-3 mr-1" /> New template
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-[11px] h-6 px-2"
                      onClick={async () => {
                        if (!activeTenantId) return;
                        try {
                          const { data, error } = await supabase.functions.invoke('admin-cleanup-sms-templates', {
                            body: { tenant_id: activeTenantId, dry_run: false },
                          });
                          if (error) throw error;
                          toast({
                            title: 'Template library cleaned',
                            description: `Inactivated ${data?.duplicates_to_inactivate ?? 0} duplicates · updated ${data?.templates_updated ?? 0} · inserted ${data?.templates_inserted ?? 0}.`,
                          });
                          queryClient.invalidateQueries({ queryKey: ['sms-templates', activeTenantId] });
                        } catch (err: any) {
                          toast({ title: 'Cleanup failed', description: err?.message || 'Unknown error', variant: 'destructive' });
                        }
                      }}
                    >
                      Clean duplicates
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-1">
                  Showing unique active templates for this campaign goal. Pick 2+ to rotate per recipient — reduces carrier spam flags.
                </p>
                <p className="text-[11px] text-muted-foreground italic mb-2">
                  If templates look duplicated, clean them once. This will inactivate duplicates, not delete them.
                </p>
                <div className="space-y-3 max-h-[28rem] overflow-y-auto rounded-md border border-border p-2">
                  {!visibleTemplates.length && (
                    <p className="text-xs text-muted-foreground italic px-1 py-2">No templates for this goal yet — using default script.</p>
                  )}

                  {(() => {
                    const renderTemplateRow = (
                      t: any,
                      opts: { stepNumber: number; isFollowup: boolean; isLast: boolean }
                    ) => {
                      const checked = selectedTemplateIds.includes(t.id);
                      const delay = t.followup_delay_days ?? (opts.isFollowup ? 2 : 0);
                      return (
                        <div key={t.id} className="relative">
                          <label className="flex items-start gap-2 p-2 rounded border border-border/60 bg-card hover:bg-muted/40 cursor-pointer">
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedTemplateIds((prev) => [...prev, t.id]);
                                  setScript(t.template_body || '');
                                  setPreviewTemplateIndex(0);
                                } else {
                                  const next = selectedTemplateIds.filter((id) => id !== t.id);
                                  setSelectedTemplateIds(next);
                                  if (script === t.template_body) {
                                    const fallback = visibleTemplates.find((vt: any) => next.includes(vt.id));
                                    if (fallback) setScript(fallback.template_body || '');
                                  }
                                }
                              }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge
                                  variant={opts.isFollowup ? 'secondary' : 'default'}
                                  className={`text-[10px] py-0 ${opts.isFollowup ? '' : 'bg-amber-500 hover:bg-amber-500 text-white'}`}
                                >
                                  {opts.isFollowup ? `Follow-up ${opts.stepNumber}` : 'Initial message'}
                                </Badge>
                                <Badge variant="outline" className="text-[10px] py-0">
                                  {opts.isFollowup ? formatDelayLabel(delay) : 'Sends immediately'}
                                </Badge>
                                <span className="text-xs font-medium truncate">{t.template_name}</span>
                                {t.category && (
                                  <Badge variant="outline" className="text-[10px] py-0 opacity-70">{t.category}</Badge>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1">{t.template_body}</p>

                              {opts.isFollowup && (
                                <div className="flex items-center gap-1.5 mt-2">
                                  <Label className="text-[11px] text-muted-foreground">Send after</Label>
                                  <Select
                                    value={String(delay)}
                                    onValueChange={(v) => updateTemplateDelay(t.id, Number(v))}
                                  >
                                    <SelectTrigger className="h-7 w-[130px] text-xs" onClick={(e) => e.preventDefault()}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {DELAY_OPTIONS.map((d) => (
                                        <SelectItem key={d} value={String(d)} className="text-xs">
                                          {d === 1 ? '1 day' : `${d} days`}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <span className="text-[11px] text-muted-foreground">after the initial message</span>
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                title="Edit template"
                                onClick={(e) => {
                                  e.preventDefault();
                                  openEditTemplate(t);
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-[11px] h-6 px-2"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setScript(t.template_body || '');
                                  setSelectedTemplateIds([t.id]);
                                  setPreviewTemplateIndex(0);
                                }}
                              >
                                Use
                              </Button>
                            </div>
                          </label>
                          {!opts.isLast && (
                            <div className="flex items-center justify-center my-1 text-muted-foreground" aria-hidden>
                              <div className="w-px h-3 bg-border" />
                              <span className="text-[10px] mx-1">↓ then</span>
                              <div className="w-px h-3 bg-border" />
                            </div>
                          )}
                        </div>
                      );
                    };

                    return (
                      <>
                        {initialTemplates.length > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 px-1">
                              <Badge className="bg-amber-500 hover:bg-amber-500 text-white text-[10px] py-0">Step 1 · Initial</Badge>
                              <span className="text-[11px] text-muted-foreground">First message recipients receive</span>
                            </div>
                            {initialTemplates.map((t: any, i: number) =>
                              renderTemplateRow(t, {
                                stepNumber: 1,
                                isFollowup: false,
                                isLast: i === initialTemplates.length - 1 && followupTemplates.length === 0,
                              })
                            )}
                          </div>
                        )}

                        {followupTemplates.length > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 px-1 pt-1">
                              <Badge variant="secondary" className="text-[10px] py-0">Follow-up sequence</Badge>
                              <span className="text-[11px] text-muted-foreground">
                                Sent in order based on the schedule below
                              </span>
                            </div>
                            {followupTemplates.map((t: any, i: number) =>
                              renderTemplateRow(t, {
                                stepNumber: i + 1,
                                isFollowup: true,
                                isLast: i === followupTemplates.length - 1,
                              })
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>


              <div className="rounded-md border border-border p-2.5 space-y-1.5">
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <div>
                    <p className="text-xs font-medium">Rotate across selected templates</p>
                    <p className="text-[11px] text-muted-foreground">
                      {rotateTemplates && selectedTemplateIds.length > 1
                        ? `Rotating across ${selectedTemplateIds.length} templates — each recipient gets one.`
                        : 'Off — every recipient gets the template shown in the preview.'}
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={rotateTemplates}
                    disabled={selectedTemplateIds.length < 2}
                    onChange={(e) => setRotateTemplates(e.target.checked)}
                    className="h-4 w-4"
                  />
                </label>
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
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Message Script</CardTitle>
              <div className="flex items-center gap-1">
                {activePreviewTemplate && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-[11px] h-7"
                    onClick={() => {
                      const t = activePreviewTemplate;
                      if (!t) return;
                      // Update the template currently shown in the preview/script area
                      setTplEditor({
                        open: true,
                        mode: 'edit',
                        id: t.id,
                        name: t.template_name || '',
                        body: script || t.template_body || '',
                        goal: t.goal || goal || 'general_outreach',
                        category: t.category || 'general',
                      });
                    }}
                  >
                    <Save className="h-3 w-3 mr-1" /> Update template
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-[11px] h-7"
                  onClick={openCreateTemplate}
                >
                  <Plus className="h-3 w-3 mr-1" /> Save as new template
                </Button>
              </div>
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

          {/* Launch checklist + locked preview appear after a dry-run */}
          {dryRunBlastId && (
            <>
              <SmsBlastLaunchChecklist
                blastId={dryRunBlastId}
                tenantId={activeTenantId || ''}
                goal={goal}
                recipientCount={recipientCount}
                eligibleCount={preflight?.eligible ?? metrics.rendered}
                skippedMissingAddress={preflight?.missingAddress ?? metrics.skippedMissingAddress}
                skippedOptOut={preflight?.optedOut ?? metrics.skippedOptOut}
                dryRunCompleted={dryRunCompleted}
                aiFollowupEnabled={aiFollowupEnabled}
                hasStopLanguage={true}
                allRenderedHavePersonalizedMessage={metrics.allRenderedHavePersonalizedMessage}
                allRenderedHaveAddressSnapshot={metrics.allRenderedHaveAddressSnapshot}
                batchSize={batchSize}
                onConfirmReady={async () => {
                  setSending(true);
                  try {
                    const { error } = await supabase.functions.invoke('sms-blast-processor', {
                      body: { blast_id: dryRunBlastId },
                    });
                    if (error) throw error;
                    toast({ title: 'Live send launched', description: `Processor invoked for ${metrics.rendered} rendered recipient(s).` });
                    onCreated(dryRunBlastId);
                  } catch (e: any) {
                    toast({ title: 'Launch failed', description: e.message, variant: 'destructive' });
                  } finally {
                    setSending(false);
                  }
                }}
              />
              <LockedSmsPreviewTable blastId={dryRunBlastId} tenantId={activeTenantId || ''} />
            </>
          )}

          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => { setDryRun(e.target.checked); if (e.target.checked) { setDryRunCompleted(false); setDryRunBlastId(null); } }}
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
        <div className="xl:col-span-2">
          {(showPreview || script.trim()) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Message Preview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {selectedTemplates.length > 1 && (
                  <div className="flex items-center justify-between text-xs">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() =>
                        setPreviewTemplateIndex((i) => (i - 1 + selectedTemplates.length) % selectedTemplates.length)
                      }
                    >
                      Previous
                    </Button>
                    <span className="text-muted-foreground">
                      Previewing template {(previewTemplateIndex % selectedTemplates.length) + 1} of {selectedTemplates.length}
                      {activePreviewTemplate?.template_name ? `: ${activePreviewTemplate.template_name}` : ''}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => setPreviewTemplateIndex((i) => (i + 1) % selectedTemplates.length)}
                    >
                      Next
                    </Button>
                  </div>
                )}
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

      <Dialog open={tplEditor.open} onOpenChange={(open) => setTplEditor((s) => ({ ...s, open }))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tplEditor.mode === 'edit' ? 'Edit template' : 'Save new template'}</DialogTitle>
            <DialogDescription>
              Templates are saved to this workspace's library and reused across campaigns.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input
                value={tplEditor.name}
                onChange={(e) => setTplEditor((s) => ({ ...s, name: e.target.value }))}
                placeholder="e.g. General Outreach — Local Roofing Help"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Campaign Goal</Label>
                <Select value={tplEditor.goal} onValueChange={(v) => setTplEditor((s) => ({ ...s, goal: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general_outreach">General outreach</SelectItem>
                    <SelectItem value="collect_homeowner_email_for_roof_estimate">Collect email for estimate</SelectItem>
                    <SelectItem value="msfh_grant">My Safe FL Home grant</SelectItem>
                    <SelectItem value="storm_canvass">Storm Canvass Follow-up</SelectItem>
                    <SelectItem value="dormant_reactivation">Dormant Lead Reactivation</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Category</Label>
                <Input
                  value={tplEditor.category}
                  onChange={(e) => setTplEditor((s) => ({ ...s, category: e.target.value }))}
                  placeholder="e.g. general"
                />
              </div>
            </div>
            <div>
              <Label>Message body</Label>
              <Textarea
                rows={6}
                value={tplEditor.body}
                onChange={(e) => setTplEditor((s) => ({ ...s, body: e.target.value }))}
                placeholder="Hi {{contact.first_name}}, ..."
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Smart tags like <code className="font-mono">{'{{contact.first_name}}'}</code> and <code className="font-mono">{'{{contact.address_street}}'}</code> are auto-filled per recipient.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTplEditor((s) => ({ ...s, open: false }))} disabled={savingTpl}>
              Cancel
            </Button>
            <Button onClick={saveTemplate} disabled={savingTpl}>
              <Save className="h-4 w-4 mr-1" />
              {savingTpl ? 'Saving…' : tplEditor.mode === 'edit' ? 'Save changes' : 'Save template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
