import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  User, Phone, Mail, MapPin, Clock, MessageSquare,
  ChevronRight, StickyNote, Loader2, History
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface ContactDetailPanelProps {
  contactId: string;
  contactName: string;
  contactPhone: string;
  contactEmail?: string | null;
  onNext: () => void;
}

export const ContactDetailPanel: React.FC<ContactDetailPanelProps> = ({
  contactId,
  contactName,
  contactPhone,
  contactEmail,
  onNext,
}) => {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Fetch contact details
  const { data: contact } = useQuery({
    queryKey: ['contact-detail-panel', contactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('*, pipeline_entries(id, status, clj_formatted_number, created_at)')
        .eq('id', contactId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!contactId,
  });

  // Fetch recent communication history
  const { data: history } = useQuery({
    queryKey: ['contact-comm-history', contactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('communication_history')
        .select('id, communication_type, direction, content, created_at')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
    enabled: !!contactId,
  });

  const handleSaveNote = async () => {
    if (!note.trim() || !tenantId) return;
    setSavingNote(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      await supabase.from('communication_history').insert({
        tenant_id: tenantId,
        contact_id: contactId,
        communication_type: 'note',
        direction: 'internal',
        content: note.trim(),
        rep_id: user?.id,
        metadata: { source: 'call_center_detail_panel' },
      });
      toast({ title: 'Note saved' });
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['contact-comm-history', contactId] });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSavingNote(false);
    }
  };

  const pipelineEntries = (contact as any)?.pipeline_entries || [];

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5 text-primary" />
            Contact Details
          </div>
          <Button onClick={onNext} className="gap-2">
            Next Contact
            <ChevronRight className="h-4 w-4" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Contact Info */}
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <User className="h-6 w-6 text-primary" />
          </div>
          <div className="space-y-1 min-w-0">
            <h3 className="text-lg font-semibold">{contactName}</h3>
            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Phone className="h-3.5 w-3.5" /> {contactPhone}
              </span>
              {contactEmail && (
                <span className="flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" /> {contactEmail}
                </span>
              )}
            </div>
            {contact && (
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                {(contact as any).address_street && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {(contact as any).address_street}, {(contact as any).address_city} {(contact as any).address_state}
                  </span>
                )}
              </div>
            )}
            {(contact as any)?.qualification_status && (
              <Badge variant="outline" className="mt-1">{(contact as any).qualification_status}</Badge>
            )}
          </div>
        </div>

        {/* Pipeline Entries */}
        {pipelineEntries.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Pipeline Entries</h4>
            <div className="flex flex-wrap gap-2">
              {pipelineEntries.map((pe: any) => (
                <Badge key={pe.id} variant="secondary">
                  {pe.clj_formatted_number} — {pe.status}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <Separator />

        {/* Quick Note */}
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            <StickyNote className="h-3.5 w-3.5" /> Add Note
          </Label>
          <Textarea
            placeholder="Quick notes about this call..."
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
          />
          <Button size="sm" onClick={handleSaveNote} disabled={savingNote || !note.trim()}>
            {savingNote && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Save Note
          </Button>
        </div>

        <Separator />

        {/* Recent Activity */}
        <div>
          <h4 className="text-sm font-medium flex items-center gap-1.5 mb-2">
            <History className="h-3.5 w-3.5" /> Recent Activity
          </h4>
          <ScrollArea className="h-[140px]">
            {history && history.length > 0 ? (
              <div className="space-y-2">
                {history.map(h => (
                  <div key={h.id} className="flex items-start gap-2 text-sm">
                    <Badge variant="outline" className="text-xs shrink-0 mt-0.5">
                      {h.communication_type}
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-muted-foreground truncate">{h.content}</p>
                      <p className="text-xs text-muted-foreground/60">
                        {format(new Date(h.created_at), 'MMM d, h:mm a')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">No recent activity</p>
            )}
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
};
