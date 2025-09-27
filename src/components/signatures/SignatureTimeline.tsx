import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { 
  FileText, 
  Send, 
  Eye, 
  CheckCircle, 
  Clock, 
  User,
  Calendar,
  Download,
  ExternalLink
} from 'lucide-react';
import { format } from 'date-fns';

interface SignatureTimelineProps {
  envelopeId: string;
  showRecipients?: boolean;
  onViewDocument?: () => void;
}

export const SignatureTimeline: React.FC<SignatureTimelineProps> = ({
  envelopeId,
  showRecipients = true,
  onViewDocument
}) => {
  // Fetch envelope details
  const { data: envelope, isLoading } = useQuery({
    queryKey: ['signature-envelope', envelopeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('signature_envelopes')
        .select(`
          *,
          recipients:signature_recipients(*),
          events:signature_events(*)
        `)
        .eq('id', envelopeId)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!envelopeId
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'signed': return 'bg-green-500';
      case 'viewed': return 'bg-blue-500';
      case 'sent': return 'bg-yellow-500';
      case 'draft': return 'bg-gray-500';
      case 'declined': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'signed':
        return <CheckCircle className="h-4 w-4" />;
      case 'viewed':
        return <Eye className="h-4 w-4" />;
      case 'sent':
        return <Send className="h-4 w-4" />;
      case 'draft':
        return <FileText className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'created': return <FileText className="h-4 w-4" />;
      case 'sent': return <Send className="h-4 w-4" />;
      case 'viewed': return <Eye className="h-4 w-4" />;
      case 'signed': return <CheckCircle className="h-4 w-4" />;
      case 'completed': return <CheckCircle className="h-4 w-4" />;
      case 'declined': return <Clock className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse">
          <div className="h-24 bg-muted rounded-lg mb-4"></div>
          <div className="h-32 bg-muted rounded-lg"></div>
        </div>
      </div>
    );
  }

  if (!envelope) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground">Envelope not found</p>
        </CardContent>
      </Card>
    );
  }

  const sortedEvents = envelope.events?.sort((a: any, b: any) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  ) || [];

  return (
    <div className="space-y-6">
      {/* Envelope Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {envelope.title}
              </CardTitle>
              <CardDescription>
                Envelope #{envelope.envelope_number}
              </CardDescription>
            </div>
            <Badge variant={envelope.status === 'completed' ? 'default' : 'secondary'}>
              {envelope.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="font-medium">Created</p>
              <p className="text-muted-foreground">
                {format(new Date(envelope.created_at), 'MMM d, yyyy')}
              </p>
            </div>
            {envelope.sent_at && (
              <div>
                <p className="font-medium">Sent</p>
                <p className="text-muted-foreground">
                  {format(new Date(envelope.sent_at), 'MMM d, yyyy')}
                </p>
              </div>
            )}
            {envelope.completed_at && (
              <div>
                <p className="font-medium">Completed</p>
                <p className="text-muted-foreground">
                  {format(new Date(envelope.completed_at), 'MMM d, yyyy')}
                </p>
              </div>
            )}
            {envelope.expires_at && (
              <div>
                <p className="font-medium">Expires</p>
                <p className="text-muted-foreground">
                  {format(new Date(envelope.expires_at), 'MMM d, yyyy')}
                </p>
              </div>
            )}
          </div>

          {(envelope.generated_pdf_path || onViewDocument) && (
            <div className="flex gap-2 mt-4 pt-4 border-t">
              {envelope.signed_pdf_path && (
                <Button variant="outline" size="sm" className="flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Download Signed PDF
                </Button>
              )}
              {onViewDocument && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={onViewDocument}
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  View Document
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recipients */}
      {showRecipients && envelope.recipients && envelope.recipients.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Recipients ({envelope.recipients.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {envelope.recipients
                .sort((a: any, b: any) => a.signing_order - b.signing_order)
                .map((recipient: any) => (
                <div key={recipient.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${getStatusColor(recipient.status)}`} />
                    <div>
                      <p className="font-medium">{recipient.recipient_name}</p>
                      <p className="text-sm text-muted-foreground">{recipient.recipient_email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">#{recipient.signing_order}</Badge>
                    <Badge variant={recipient.status === 'signed' ? 'default' : 'secondary'}>
                      {recipient.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Activity Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Activity Timeline
          </CardTitle>
          <CardDescription>
            Chronological history of envelope events
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {sortedEvents.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                No activity recorded yet
              </p>
            ) : (
              sortedEvents.map((event: any, index: number) => (
                <div key={event.id} className="flex items-start gap-3">
                  <div className={`p-2 rounded-full ${getStatusColor(event.event_type)} text-white mt-1`}>
                    {getEventIcon(event.event_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="font-medium capitalize">
                        {event.event_type.replace(/_/g, ' ')}
                      </p>
                      <time className="text-sm text-muted-foreground">
                        {format(new Date(event.created_at), 'MMM d, h:mm a')}
                      </time>
                    </div>
                    {event.event_description && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {event.event_description}
                      </p>
                    )}
                  </div>
                  {index < sortedEvents.length - 1 && (
                    <Separator orientation="vertical" className="h-8 mt-8" />
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};