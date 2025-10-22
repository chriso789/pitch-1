import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Phone, 
  MessageSquare, 
  Mail, 
  Play, 
  Pause,
  PhoneCall,
  MessageCircle,
  Send,
  User,
  Clock,
  Download
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface CommunicationHubProps {
  contactId?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  assignedRep?: {
    id: string;
    first_name: string;
    last_name: string;
  };
  onCallClick?: () => void;
  onEmailClick?: () => void;
  onSMSClick?: () => void;
  className?: string;
}

interface Call {
  id: string;
  direction: string;
  status: string;
  duration_seconds: number;
  recording_url: string | null;
  disposition: string | null;
  disposition_notes: string | null;
  started_at: string;
  caller_id: string;
  callee_number: string;
}

interface Message {
  id: string;
  direction: string;
  content: string;
  created_at: string;
}

interface Email {
  id: string;
  direction: string;
  subject: string | null;
  content: string;
  metadata: any;
  created_at: string;
}

const CommunicationHub: React.FC<CommunicationHubProps> = ({
  contactId,
  contactName,
  contactEmail,
  contactPhone,
  assignedRep,
  onCallClick,
  onEmailClick,
  onSMSClick,
  className
}) => {
  const [activeTab, setActiveTab] = useState('calls');
  const [calls, setCalls] = useState<Call[]>([]);
  const [smsMessages, setSmsMessages] = useState<Message[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  // Fetch calls
  const fetchCalls = async () => {
    if (!contactId) return;
    
    try {
      const { data, error } = await supabase
        .from('call_logs')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setCalls(data || []);
    } catch (error) {
      console.error('Error fetching calls:', error);
    }
  };

  // Fetch SMS messages
  const fetchSMS = async () => {
    if (!contactId) return;
    
    try {
      const { data, error } = await supabase
        .from('communication_history')
        .select('*')
        .eq('contact_id', contactId)
        .eq('communication_type', 'sms')
        .order('created_at', { ascending: true });

      if (error) throw error;
      setSmsMessages(data || []);
    } catch (error) {
      console.error('Error fetching SMS:', error);
    }
  };

  // Fetch emails
  const fetchEmails = async () => {
    if (!contactId) return;
    
    try {
      const { data, error } = await supabase
        .from('communication_history')
        .select('*')
        .eq('contact_id', contactId)
        .eq('communication_type', 'email')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setEmails(data || []);
    } catch (error) {
      console.error('Error fetching emails:', error);
    }
  };

  // Initial data fetch
  useEffect(() => {
    if (!contactId) return;
    
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchCalls(), fetchSMS(), fetchEmails()]);
      setLoading(false);
    };

    loadData();
  }, [contactId]);

  // Realtime subscriptions
  useEffect(() => {
    if (!contactId) return;

    const channel = supabase
      .channel('communication-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'communication_history',
          filter: `contact_id=eq.${contactId}`
        },
        (payload) => {
          if (payload.new.communication_type === 'sms') {
            fetchSMS();
          } else if (payload.new.communication_type === 'email') {
            fetchEmails();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_logs',
          filter: `contact_id=eq.${contactId}`
        },
        () => {
          fetchCalls();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [contactId]);

  // Audio player controls
  const handlePlayRecording = (recordingUrl: string) => {
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }

    if (playingAudio === recordingUrl) {
      setPlayingAudio(null);
      setAudioElement(null);
      return;
    }

    const audio = new Audio(recordingUrl);
    audio.onended = () => {
      setPlayingAudio(null);
      setAudioElement(null);
    };
    audio.onerror = () => {
      toast({
        title: 'Playback Error',
        description: 'Unable to play recording',
        variant: 'destructive'
      });
      setPlayingAudio(null);
      setAudioElement(null);
    };
    
    audio.play();
    setAudioElement(audio);
    setPlayingAudio(recordingUrl);
  };

  // Format duration from seconds to MM:SS
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Get status badge color
  const getStatusBadge = (status: string, disposition: string | null) => {
    const displayText = disposition || status;
    let variant: "default" | "secondary" | "destructive" | "outline" = "secondary";
    
    if (status === 'completed' || disposition === 'completed') {
      variant = "default";
    } else if (status === 'no-answer' || disposition === 'no_answer') {
      variant = "destructive";
    }
    
    return <Badge variant={variant} className="text-xs">{displayText}</Badge>;
  };

  return (
    <Card className={cn("border-primary/20", className)}>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <span>Communication Hub</span>
        </CardTitle>
        {assignedRep && (
          <div className="flex items-center space-x-2 text-sm text-muted-foreground">
            <User className="h-4 w-4" />
            <span>
              {assignedRep.first_name} {assignedRep.last_name} - Sales Rep
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="calls" className="flex items-center space-x-1">
              <Phone className="h-4 w-4" />
              <span>Calls</span>
              <Badge variant="secondary" className="ml-1 text-xs">
                {calls.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="sms" className="flex items-center space-x-1">
              <MessageCircle className="h-4 w-4" />
              <span>SMS</span>
              <Badge variant="secondary" className="ml-1 text-xs">
                {smsMessages.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="email" className="flex items-center space-x-1">
              <Mail className="h-4 w-4" />
              <span>Email</span>
              <Badge variant="secondary" className="ml-1 text-xs">
                {emails.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          {/* Calls Tab */}
          <TabsContent value="calls" className="space-y-4 mt-4">
            <div className="flex space-x-2">
              <Button 
                size="sm" 
                className="flex items-center space-x-1"
                onClick={onCallClick}
                disabled={!contactPhone}
              >
                <PhoneCall className="h-4 w-4" />
                <span>Call Now</span>
              </Button>
            </div>
            
            <ScrollArea className="h-[400px]">
              <div className="space-y-2 pr-4">
                {loading ? (
                  <div className="text-sm text-muted-foreground text-center py-8">
                    Loading calls...
                  </div>
                ) : calls.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-8">
                    No call history
                  </div>
                ) : (
                  calls.map((call) => (
                    <div key={call.id} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <div className={cn(
                            "w-2 h-2 rounded-full",
                            call.direction === 'outbound' ? "bg-success" : "bg-primary"
                          )} />
                          <span className="text-sm font-medium capitalize">
                            {call.direction}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {formatDuration(call.duration_seconds || 0)}
                          </Badge>
                          {getStatusBadge(call.status, call.disposition)}
                        </div>
                        <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>
                            {format(new Date(call.started_at), 'MMM d, h:mm a')}
                          </span>
                        </div>
                      </div>
                      
                      <div className="text-xs text-muted-foreground">
                        <div>From: {call.caller_id}</div>
                        <div>To: {call.callee_number}</div>
                      </div>

                      {call.disposition_notes && (
                        <p className="text-sm text-muted-foreground">
                          {call.disposition_notes}
                        </p>
                      )}
                      
                      {call.recording_url && (
                        <div className="flex gap-2">
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="h-7 px-2"
                            onClick={() => handlePlayRecording(call.recording_url!)}
                          >
                            {playingAudio === call.recording_url ? (
                              <>
                                <Pause className="h-3 w-3 mr-1" />
                                Pause
                              </>
                            ) : (
                              <>
                                <Play className="h-3 w-3 mr-1" />
                                Play Recording
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => window.open(call.recording_url!, '_blank')}
                          >
                            <Download className="h-3 w-3 mr-1" />
                            Download
                          </Button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* SMS Tab */}
          <TabsContent value="sms" className="space-y-4 mt-4">
            <ScrollArea className="h-[400px]">
              <div className="space-y-2 pr-4">
                {loading ? (
                  <div className="text-sm text-muted-foreground text-center py-8">
                    Loading messages...
                  </div>
                ) : smsMessages.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-8">
                    No SMS history
                  </div>
                ) : (
                  smsMessages.map((message) => (
                    <div 
                      key={message.id} 
                      className={cn(
                        "flex mb-3",
                        message.direction === 'outbound' ? "justify-end" : "justify-start"
                      )}
                    >
                      <div className={cn(
                        "max-w-[75%] rounded-lg p-3 text-sm",
                        message.direction === 'outbound' 
                          ? "bg-primary text-primary-foreground" 
                          : "bg-muted"
                      )}>
                        <p className="break-words">{message.content}</p>
                        <div className={cn(
                          "text-xs mt-1",
                          message.direction === 'outbound' 
                            ? "opacity-80" 
                            : "text-muted-foreground"
                        )}>
                          {format(new Date(message.created_at), 'MMM d, h:mm a')}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
            
            <div className="flex space-x-2 pt-2 border-t">
              <Button 
                size="sm" 
                className="flex items-center space-x-1 flex-1"
                onClick={onSMSClick}
                disabled={!contactPhone}
              >
                <Send className="h-4 w-4" />
                <span>Send SMS</span>
              </Button>
            </div>
          </TabsContent>

          {/* Email Tab */}
          <TabsContent value="email" className="space-y-4 mt-4">
            <ScrollArea className="h-[400px]">
              <div className="space-y-2 pr-4">
                {loading ? (
                  <div className="text-sm text-muted-foreground text-center py-8">
                    Loading emails...
                  </div>
                ) : emails.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-8">
                    No email history
                  </div>
                ) : (
                  emails.map((email) => (
                    <div key={email.id} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium text-sm">
                          {email.subject || '(No Subject)'}
                        </h4>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(new Date(email.created_at), 'MMM d, h:mm a')}
                        </div>
                      </div>
                      
                      <div className="text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <span className="font-medium">Direction:</span>
                          <Badge variant="outline" className="text-xs capitalize">
                            {email.direction}
                          </Badge>
                        </div>
                      </div>

                      <div className="text-sm text-muted-foreground max-h-20 overflow-hidden">
                        {email.content?.substring(0, 200)}
                        {email.content?.length > 200 && '...'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
            
            <div className="pt-2 border-t">
              <Button 
                size="sm" 
                className="flex items-center space-x-1"
                onClick={onEmailClick}
                disabled={!contactEmail}
              >
                <Mail className="h-4 w-4" />
                <span>Compose Email</span>
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default CommunicationHub;
