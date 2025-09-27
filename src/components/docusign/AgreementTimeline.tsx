import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  FileText, 
  Send, 
  Eye, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Download,
  ExternalLink,
  User,
  Calendar,
  AlertCircle
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow, format } from 'date-fns';

interface AgreementTimelineProps {
  agreementInstanceId: string;
  showRecipients?: boolean;
  onSigningRequest?: (recipientRole: string) => void;
}

interface AgreementData {
  agreement: any;
  recipients: any[];
  events: any[];
  template: any;
}

export default function AgreementTimeline({ 
  agreementInstanceId, 
  showRecipients = true,
  onSigningRequest 
}: AgreementTimelineProps) {
  const [data, setData] = useState<AgreementData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (agreementInstanceId) {
      fetchAgreementData();
      
      // Set up real-time subscription for events
      const subscription = supabase
        .channel(`agreement-${agreementInstanceId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'docusign_events',
            filter: `agreement_instance_id=eq.${agreementInstanceId}`,
          },
          () => {
            fetchAgreementData(); // Refresh data when new events arrive
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(subscription);
      };
    }
  }, [agreementInstanceId]);

  const fetchAgreementData = async () => {
    try {
      setIsLoading(true);

      // Fetch agreement instance
      const { data: agreement, error: agreementError } = await supabase
        .from('agreement_instances')
        .select(`
          *,
          agreement_templates (
            id,
            name,
            slug,
            description
          )
        `)
        .eq('id', agreementInstanceId)
        .single();

      if (agreementError) throw agreementError;

      // Fetch recipients
      const { data: recipients, error: recipientsError } = await supabase
        .from('recipients')
        .select('*')
        .eq('agreement_instance_id', agreementInstanceId)
        .order('routing_order');

      if (recipientsError) throw recipientsError;

      // Fetch events
      const { data: events, error: eventsError } = await supabase
        .from('docusign_events')
        .select('*')
        .eq('agreement_instance_id', agreementInstanceId)
        .order('created_at', { ascending: false });

      if (eventsError) throw eventsError;

      setData({
        agreement,
        recipients: recipients || [],
        events: events || [],
        template: agreement.agreement_templates,
      });
    } catch (error: any) {
      console.error('Error fetching agreement data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load agreement information',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'draft':
        return 'default';
      case 'sent':
        return 'secondary';
      case 'delivered':
        return 'outline';
      case 'completed':
        return 'default'; // Success color
      case 'declined':
      case 'voided':
        return 'destructive';
      default:
        return 'secondary';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'draft':
        return <FileText className="h-4 w-4" />;
      case 'sent':
        return <Send className="h-4 w-4" />;
      case 'delivered':
        return <Eye className="h-4 w-4" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4" />;
      case 'declined':
      case 'voided':
        return <XCircle className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'envelope-sent':
        return <Send className="h-4 w-4 text-blue-500" />;
      case 'envelope-delivered':
        return <Eye className="h-4 w-4 text-yellow-500" />;
      case 'envelope-completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'envelope-declined':
      case 'envelope-voided':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'recipient-completed':
        return <User className="h-4 w-4 text-green-500" />;
      case 'recipient-delivered':
        return <User className="h-4 w-4 text-yellow-500" />;
      case 'recipient-declined':
        return <User className="h-4 w-4 text-red-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const formatEventTitle = (eventType: string) => {
    return eventType
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const downloadDocument = async () => {
    if (!data?.agreement.envelope_id) return;

    try {
      // This would call a function to download the signed document
      toast({
        title: 'Download Started',
        description: 'The signed document is being prepared for download.',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to download document',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Clock className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="text-center py-8">
          <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground">Agreement not found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Agreement Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                {getStatusIcon(data.agreement.status)}
                {data.template?.name || 'Document Agreement'}
              </CardTitle>
              <CardDescription>
                {data.agreement.email_subject}
              </CardDescription>
            </div>
            <Badge variant={getStatusColor(data.agreement.status)}>
              {data.agreement.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Created:</span>
              <p>{format(new Date(data.agreement.created_at), 'PPp')}</p>
            </div>
            {data.agreement.sent_at && (
              <div>
                <span className="text-muted-foreground">Sent:</span>
                <p>{format(new Date(data.agreement.sent_at), 'PPp')}</p>
              </div>
            )}
            {data.agreement.completed_at && (
              <div>
                <span className="text-muted-foreground">Completed:</span>
                <p>{format(new Date(data.agreement.completed_at), 'PPp')}</p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Envelope ID:</span>
              <p className="font-mono text-xs">{data.agreement.envelope_id}</p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            {data.agreement.status === 'completed' && (
              <Button variant="outline" size="sm" onClick={downloadDocument}>
                <Download className="h-4 w-4 mr-2" />
                Download PDF
              </Button>
            )}
            {data.agreement.envelope_id && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`https://demo.docusign.com/Signing/StartInSession.aspx?t=${data.agreement.envelope_id}`, '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View in DocuSign
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recipients */}
      {showRecipients && data.recipients.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recipients</CardTitle>
            <CardDescription>
              Signing status for each recipient
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.recipients.map((recipient) => (
                <div
                  key={recipient.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(recipient.status)}
                      <div>
                        <p className="font-medium">{recipient.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {recipient.email}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{recipient.role}</Badge>
                    <Badge variant={getStatusColor(recipient.status)}>
                      {recipient.status}
                    </Badge>
                    {recipient.status === 'delivered' && recipient.client_user_id && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onSigningRequest?.(recipient.role)}
                      >
                        Sign Now
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Event Timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Activity Timeline</CardTitle>
          <CardDescription>
            Recent events and status changes
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-64">
            {data.events.length > 0 ? (
              <div className="space-y-4">
                {data.events.map((event, index) => (
                  <div key={event.id} className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-1">
                      {getEventIcon(event.event_type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">
                          {formatEventTitle(event.event_type)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(event.created_at), { 
                            addSuffix: true 
                          })}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(event.created_at), 'PPp')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Calendar className="h-8 w-8 mx-auto mb-2" />
                <p>No events recorded yet</p>
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}