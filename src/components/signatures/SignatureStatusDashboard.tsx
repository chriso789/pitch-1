import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { 
  FileSignature, 
  Clock, 
  CheckCircle, 
  XCircle, 
  MoreHorizontal,
  Send,
  Eye,
  Trash2,
  RefreshCw,
  Loader2,
  Mail
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface SignatureEnvelope {
  id: string;
  title: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
  generated_pdf_path: string | null;
  contact: {
    first_name: string;
    last_name: string;
    email: string;
  } | null;
  signature_recipients: Array<{
    id: string;
    recipient_name: string;
    recipient_email: string;
    status: string;
    signed_at: string | null;
  }>;
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ComponentType<any> }> = {
  draft: { label: 'Draft', color: 'bg-gray-500', icon: FileSignature },
  pending: { label: 'Pending', color: 'bg-yellow-500', icon: Clock },
  sent: { label: 'Sent', color: 'bg-blue-500', icon: Send },
  viewed: { label: 'Viewed', color: 'bg-purple-500', icon: Eye },
  completed: { label: 'Completed', color: 'bg-green-500', icon: CheckCircle },
  declined: { label: 'Declined', color: 'bg-red-500', icon: XCircle },
  expired: { label: 'Expired', color: 'bg-gray-400', icon: Clock },
  voided: { label: 'Voided', color: 'bg-gray-600', icon: XCircle }
};

export function SignatureStatusDashboard() {
  const { activeCompanyId: currentTenantId } = useCompanySwitcher();
  const queryClient = useQueryClient();
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  const { data: envelopes, isLoading, refetch } = useQuery({
    queryKey: ['signature-envelopes', currentTenantId, selectedStatus],
    queryFn: async () => {
      let query = supabase
        .from('signature_envelopes')
        .select(`
          *,
          signature_recipients(id, recipient_name, recipient_email, status, signed_at)
        `)
        .eq('tenant_id', currentTenantId)
        .order('created_at', { ascending: false });

      if (selectedStatus !== 'all') {
        query = query.eq('status', selectedStatus);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      // Fetch contacts separately
      const envelopesWithContacts = await Promise.all((data || []).map(async (env) => {
        let contact = null;
        if (env.contact_id) {
          const { data: contactData } = await supabase
            .from('contacts')
            .select('first_name, last_name, email')
            .eq('id', env.contact_id)
            .single();
          contact = contactData;
        }
        return { ...env, contact };
      }));
      
      return envelopesWithContacts as SignatureEnvelope[];
    },
    enabled: !!currentTenantId
  });

  const sendReminderMutation = useMutation({
    mutationFn: async (envelopeId: string) => {
      const envelope = envelopes?.find(e => e.id === envelopeId);
      if (!envelope) throw new Error('Envelope not found');

      const pendingRecipients = envelope.signature_recipients.filter(
        (r: any) => r.status === 'pending' || r.status === 'sent'
      );

      for (const recipient of pendingRecipients) {
        await supabase.functions.invoke('email-signature-request', {
          body: {
            envelope_id: envelopeId,
            recipient_id: recipient.id,
            recipient_name: recipient.recipient_name,
            recipient_email: recipient.recipient_email,
            access_token: 'reminder',
            sender_name: 'Your Company',
            subject: envelope.title || 'Document',
            message: 'This is a reminder to sign the document.',
            is_reminder: true
          }
        });
      }
    },
    onSuccess: () => {
      toast.success('Reminder sent successfully');
      queryClient.invalidateQueries({ queryKey: ['signature-envelopes'] });
    },
    onError: () => {
      toast.error('Failed to send reminder');
    }
  });

  const voidEnvelopeMutation = useMutation({
    mutationFn: async (envelopeId: string) => {
      const { error } = await supabase
        .from('signature_envelopes')
        .update({ status: 'voided' })
        .eq('id', envelopeId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Envelope voided');
      queryClient.invalidateQueries({ queryKey: ['signature-envelopes'] });
    },
    onError: () => {
      toast.error('Failed to void envelope');
    }
  });

  const statusCounts = React.useMemo(() => {
    if (!envelopes) return {};
    return envelopes.reduce((acc, env) => {
      acc[env.status] = (acc[env.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [envelopes]);

  const getStatusBadge = (status: string) => {
    const config = statusConfig[status] || statusConfig.pending;
    const Icon = config.icon;
    return (
      <Badge 
        variant="outline" 
        className={`${config.color} text-white border-0 gap-1`}
      >
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <FileSignature className="h-6 w-6" />
            Signature Requests
          </h2>
          <p className="text-muted-foreground">
            Track and manage document signature requests
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        {Object.entries(statusConfig).slice(0, 4).map(([status, config]) => (
          <Card 
            key={status}
            className={`cursor-pointer transition-shadow hover:shadow-md ${
              selectedStatus === status ? 'ring-2 ring-primary' : ''
            }`}
            onClick={() => setSelectedStatus(selectedStatus === status ? 'all' : status)}
          >
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{config.label}</p>
                  <p className="text-2xl font-bold">{statusCounts[status] || 0}</p>
                </div>
                <div className={`p-3 rounded-full ${config.color} bg-opacity-10`}>
                  <config.icon className={`h-5 w-5 ${config.color.replace('bg-', 'text-')}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Envelopes Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            {selectedStatus === 'all' ? 'All Requests' : `${statusConfig[selectedStatus]?.label || selectedStatus} Requests`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : envelopes?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileSignature className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No signature requests found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {envelopes?.map((envelope) => (
                  <TableRow key={envelope.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{envelope.title}</p>
                        {envelope.contact && (
                          <p className="text-sm text-muted-foreground">
                            {envelope.contact.first_name} {envelope.contact.last_name}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {envelope.signature_recipients.map((r) => (
                          <div key={r.id} className="flex items-center gap-2 text-sm">
                            <span>{r.recipient_name}</span>
                            {r.status === 'signed' ? (
                              <CheckCircle className="h-3 w-3 text-green-500" />
                            ) : (
                              <Clock className="h-3 w-3 text-yellow-500" />
                            )}
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(envelope.status)}</TableCell>
                    <TableCell>
                      {envelope.sent_at 
                        ? formatDistanceToNow(new Date(envelope.sent_at), { addSuffix: true })
                        : '-'
                      }
                    </TableCell>
                    <TableCell>
                      {envelope.expires_at 
                        ? formatDistanceToNow(new Date(envelope.expires_at), { addSuffix: true })
                        : '-'
                      }
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem 
                            onClick={() => envelope.generated_pdf_path && window.open(envelope.generated_pdf_path, '_blank')}
                            disabled={!envelope.generated_pdf_path}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            View Document
                          </DropdownMenuItem>
                          {['sent', 'pending'].includes(envelope.status) && (
                            <DropdownMenuItem 
                              onClick={() => sendReminderMutation.mutate(envelope.id)}
                            >
                              <Mail className="mr-2 h-4 w-4" />
                              Send Reminder
                            </DropdownMenuItem>
                          )}
                          {!['completed', 'voided'].includes(envelope.status) && (
                            <DropdownMenuItem 
                              className="text-destructive"
                              onClick={() => voidEnvelopeMutation.mutate(envelope.id)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Void Request
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
