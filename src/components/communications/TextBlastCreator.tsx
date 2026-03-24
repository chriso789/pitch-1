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
import { ArrowLeft, Send, Eye, Users, AlertTriangle, UserPlus, ListPlus, Phone } from 'lucide-react';
import { TextBlastListBuilder } from './TextBlastListBuilder';

interface TextBlastCreatorProps {
  onBack: () => void;
  onCreated: (blastId: string) => void;
}

export const TextBlastCreator = ({ onBack, onCreated }: TextBlastCreatorProps) => {
  const { activeTenantId } = useActiveTenantId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [sendMode, setSendMode] = useState<'single' | 'list'>('list');
  const [selectedListId, setSelectedListId] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [manualName, setManualName] = useState('');
  const [script, setScript] = useState('');
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showListBuilder, setShowListBuilder] = useState(false);

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

  // Fetch items count for selected list
  const { data: listItems } = useQuery({
    queryKey: ['dialer-list-items-count', selectedListId],
    queryFn: async () => {
      if (!selectedListId) return [];
      const { data, error } = await supabase
        .from('dialer_list_items')
        .select('id, first_name, last_name, phone_number, contact_id')
        .eq('list_id', selectedListId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedListId,
  });

  const recipientCount = sendMode === 'single' ? (manualPhone.trim() ? 1 : 0) : (listItems?.length || 0);

  const previewMessage = script
    .replace(/\{\{first_name\}\}/gi, sendMode === 'single' ? (manualName.split(' ')[0] || 'Friend') : 'John')
    .replace(/\{\{last_name\}\}/gi, sendMode === 'single' ? (manualName.split(' ').slice(1).join(' ') || '') : 'Smith')
    .replace(/\{\{full_name\}\}/gi, sendMode === 'single' ? (manualName || 'Friend') : 'John Smith')
    .replace(/\{\{phone\}\}/gi, manualPhone || '+15551234567');

  const hasStopClause = /stop/i.test(script);
  const finalPreview = hasStopClause ? previewMessage : previewMessage + '\n\nReply STOP to opt out.';

  const isValid = sendMode === 'single'
    ? name.trim() && manualPhone.trim() && script.trim()
    : name.trim() && selectedListId && script.trim() && (listItems?.length || 0) > 0;

  const handleSend = async () => {
    if (!isValid || !activeTenantId) return;

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
            status: 'draft',
          })
          .select()
          .single();

        if (blastError) throw blastError;

        const { error: itemsError } = await supabase
          .from('sms_blast_items')
          .insert({
            blast_id: blast.id,
            tenant_id: activeTenantId,
            contact_id: null,
            phone: manualPhone.trim(),
            contact_name: manualName.trim() || null,
            status: 'pending',
          });

        if (itemsError) throw itemsError;

        const { error: processorError } = await supabase.functions.invoke('sms-blast-processor', {
          body: { blast_id: blast.id },
        });

        if (processorError) {
          toast({ title: 'Blast created but processing failed', description: processorError.message, variant: 'destructive' });
        } else {
          toast({ title: 'Text Blast Started!', description: `Sending to 1 recipient...` });
        }

        onCreated(blast.id);
      } else {
        // List mode (existing logic)
        const { data: blast, error: blastError } = await supabase
          .from('sms_blasts')
          .insert({
            tenant_id: activeTenantId,
            name: name.trim(),
            script: script.trim(),
            list_id: selectedListId,
            total_recipients: listItems!.length,
            status: 'draft',
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

        const { error: processorError } = await supabase.functions.invoke('sms-blast-processor', {
          body: { blast_id: blast.id },
        });

        if (processorError) {
          toast({ title: 'Blast created but processing failed', description: processorError.message, variant: 'destructive' });
        } else {
          toast({ title: 'Text Blast Started!', description: `Sending to ${listItems!.length} recipients...` });
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
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <Label>Contact List</Label>
                      <Select value={selectedListId} onValueChange={setSelectedListId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a contact list" />
                        </SelectTrigger>
                        <SelectContent>
                          {lists?.map((list: any) => (
                            <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="pt-5">
                      <Button variant="outline" size="sm" onClick={() => setShowListBuilder(true)}>
                        <ListPlus className="h-4 w-4 mr-1" />
                        Build List
                      </Button>
                    </div>
                  </div>
                  {selectedListId && (
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">{listItems?.length || 0} recipients</span>
                    </div>
                  )}
                </div>
              )}
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
                  placeholder="Hi {{first_name}}, this is your roofing team..."
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  rows={5}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Variables: <code className="px-1 bg-muted rounded">{'{{first_name}}'}</code>{' '}
                  <code className="px-1 bg-muted rounded">{'{{last_name}}'}</code>{' '}
                  <code className="px-1 bg-muted rounded">{'{{full_name}}'}</code>
                </p>
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

          <div className="flex gap-2">
            <Button
              onClick={handleSend}
              disabled={sending || !isValid}
              className="flex-1"
            >
              <Send className="h-4 w-4 mr-2" />
              {sending ? 'Creating...' : `Send to ${recipientCount} Recipient${recipientCount !== 1 ? 's' : ''}`}
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
