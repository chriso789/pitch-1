import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { ArrowLeft, Send, Eye, Users, AlertTriangle } from 'lucide-react';

interface TextBlastCreatorProps {
  onBack: () => void;
  onCreated: (blastId: string) => void;
}

export const TextBlastCreator = ({ onBack, onCreated }: TextBlastCreatorProps) => {
  const { activeTenantId } = useActiveTenantId();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [selectedListId, setSelectedListId] = useState('');
  const [script, setScript] = useState('');
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

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

  const recipientCount = listItems?.length || 0;

  const previewMessage = script
    .replace(/\{\{first_name\}\}/gi, 'John')
    .replace(/\{\{last_name\}\}/gi, 'Smith')
    .replace(/\{\{full_name\}\}/gi, 'John Smith')
    .replace(/\{\{phone\}\}/gi, '+15551234567');

  const hasStopClause = /stop/i.test(script);
  const finalPreview = hasStopClause ? previewMessage : previewMessage + '\n\nReply STOP to opt out.';

  const handleSend = async () => {
    if (!name.trim() || !selectedListId || !script.trim()) {
      toast({ title: 'Missing fields', description: 'Please fill in all required fields.', variant: 'destructive' });
      return;
    }
    if (!activeTenantId || !listItems?.length) return;

    setSending(true);
    try {
      // Create the blast record
      const { data: blast, error: blastError } = await supabase
        .from('sms_blasts')
        .insert({
          tenant_id: activeTenantId,
          name: name.trim(),
          script: script.trim(),
          list_id: selectedListId,
          total_recipients: listItems.length,
          status: 'draft',
        })
        .select()
        .single();

      if (blastError) throw blastError;

      // Create blast items from list items
      const items = listItems.map((li: any) => ({
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

      // Trigger the processor
      const { error: processorError } = await supabase.functions.invoke('sms-blast-processor', {
        body: { blast_id: blast.id },
      });

      if (processorError) {
        console.error('Processor error:', processorError);
        toast({ title: 'Blast created but processing failed', description: processorError.message, variant: 'destructive' });
      } else {
        toast({ title: 'Text Blast Started!', description: `Sending to ${listItems.length} recipients...` });
      }

      onCreated(blast.id);
    } catch (error: any) {
      console.error('Error creating blast:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
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

              <div>
                <Label>Contact List</Label>
                <Select value={selectedListId} onValueChange={setSelectedListId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a dialer list" />
                  </SelectTrigger>
                  <SelectContent>
                    {lists?.map((list: any) => (
                      <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedListId && (
                  <div className="flex items-center gap-2 mt-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{recipientCount} recipients</span>
                  </div>
                )}
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
              disabled={sending || !name.trim() || !selectedListId || !script.trim() || !recipientCount}
              className="flex-1"
            >
              <Send className="h-4 w-4 mr-2" />
              {sending ? 'Creating...' : `Send to ${recipientCount} Recipients`}
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
    </div>
  );
};
