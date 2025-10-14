import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { 
  MessageSquare, 
  Phone, 
  Mail, 
  Calendar,
  Plus,
  Send,
  User,
  Clock,
  TrendingUp,
  Activity
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PhoneNumberSelector } from "@/components/communication/PhoneNumberSelector";
import { FloatingEmailComposer } from "@/components/messaging/FloatingEmailComposer";
import { SMSComposerDialog } from "@/components/communication/SMSComposerDialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface ContactCommunicationTabProps {
  contact: any;
}

export const ContactCommunicationTab: React.FC<ContactCommunicationTabProps> = ({ 
  contact 
}) => {
  const [communications, setCommunications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false);
  const [emailComposerOpen, setEmailComposerOpen] = useState(false);
  const [smsDialogOpen, setSmsDialogOpen] = useState(false);
  const { toast } = useToast();
  const { user: currentUser } = useCurrentUser();

  useEffect(() => {
    fetchCommunications();
  }, [contact.id]);

  const fetchCommunications = async () => {
    try {
      const { data, error } = await supabase
        .from('communication_history')
        .select('*')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCommunications(data || []);
    } catch (error) {
      console.error('Error fetching communications:', error);
    } finally {
      setLoading(false);
    }
  };

  const addNote = async () => {
    if (!newNote.trim()) {
      toast({
        title: "Error",
        description: "Note content is required",
        variant: "destructive",
      });
      return;
    }

    try {
      const { data: tenantData } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      const { data, error } = await supabase
        .from('communication_history')
        .insert({
          contact_id: contact.id,
          communication_type: 'note',
          direction: 'outbound',
          content: newNote,
          tenant_id: tenantData?.tenant_id,
          rep_id: (await supabase.auth.getUser()).data.user?.id
        })
        .select()
        .single();

      if (error) throw error;

      setCommunications([data, ...communications]);
      setNewNote('');
      setDialogOpen(false);
      
      toast({
        title: "Success",
        description: "Note added successfully",
      });
    } catch (error) {
      console.error('Error adding note:', error);
      toast({
        title: "Error",
        description: "Failed to add note",
        variant: "destructive",
      });
    }
  };

  const handleCallInitiated = (callLog: any) => {
    toast({
      title: "Call initiated",
      description: `Calling ${contact.first_name} ${contact.last_name}`,
    });
    fetchCommunications();
  };

  const handleSendEmail = async (emailData: any) => {
    try {
      const { error } = await supabase.functions.invoke('send-email', {
        body: {
          to: emailData.to,
          cc: emailData.cc,
          bcc: emailData.bcc,
          subject: emailData.subject,
          body: emailData.body,
          contactId: contact.id,
        }
      });

      if (error) throw error;

      toast({
        title: "Email sent",
        description: `Email sent to ${contact.first_name} ${contact.last_name}`,
      });
      
      fetchCommunications();
    } catch (error: any) {
      console.error('Error sending email:', error);
      toast({
        title: "Failed to send email",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleSendSMS = async (message: string) => {
    try {
      const { error } = await supabase.functions.invoke('send-sms', {
        body: {
          to: contact.phone,
          message,
          contactId: contact.id,
        }
      });

      if (error) throw error;

      toast({
        title: "SMS sent",
        description: `Message sent to ${contact.first_name} ${contact.last_name}`,
      });
      
      fetchCommunications();
    } catch (error: any) {
      console.error('Error sending SMS:', error);
      toast({
        title: "Failed to send SMS",
        description: error.message || "SMS service not configured",
        variant: "destructive",
      });
    }
  };

  const getCommunicationIcon = (type: string) => {
    switch (type) {
      case 'call':
        return <Phone className="h-4 w-4" />;
      case 'email':
        return <Mail className="h-4 w-4" />;
      case 'sms':
        return <MessageSquare className="h-4 w-4" />;
      case 'meeting':
        return <Calendar className="h-4 w-4" />;
      default:
        return <MessageSquare className="h-4 w-4" />;
    }
  };

  const getCommunicationTypeColor = (type: string) => {
    switch (type) {
      case 'call':
        return 'bg-primary text-primary-foreground';
      case 'email':
        return 'bg-secondary text-secondary-foreground';
      case 'sms':
        return 'bg-accent text-accent-foreground';
      case 'meeting':
        return 'bg-success text-success-foreground';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const communicationStats = {
    total: communications.length,
    calls: communications.filter(c => c.communication_type === 'call').length,
    emails: communications.filter(c => c.communication_type === 'email').length,
    sms: communications.filter(c => c.communication_type === 'sms').length,
    notes: communications.filter(c => c.communication_type === 'note').length
  };

  const phoneNumbers = [
    ...(contact.phone ? [{ label: 'Primary', number: contact.phone }] : []),
    ...(contact.phone_2 ? [{ label: 'Secondary', number: contact.phone_2 }] : []),
  ];

  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <div className="flex gap-2 flex-wrap">
        <Button 
          onClick={() => setPhoneDialogOpen(true)}
          disabled={phoneNumbers.length === 0}
          className="gap-2"
        >
          <Phone className="h-4 w-4" />
          Call Now
        </Button>
        <Button 
          variant="outline"
          onClick={() => setEmailComposerOpen(true)}
          disabled={!contact.email}
          className="gap-2"
        >
          <Mail className="h-4 w-4" />
          Send Email
        </Button>
        <Button 
          variant="outline"
          onClick={() => setSmsDialogOpen(true)}
          disabled={!contact.phone}
          className="gap-2"
        >
          <MessageSquare className="h-4 w-4" />
          Send SMS
        </Button>
      </div>

      {/* Communication Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="shadow-soft">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <Activity className="h-4 w-4 text-primary" />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Total</p>
                <p className="text-2xl font-bold">{communicationStats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="shadow-soft">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <Phone className="h-4 w-4 text-success" />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Calls</p>
                <p className="text-2xl font-bold">{communicationStats.calls}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <Mail className="h-4 w-4 text-secondary" />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Emails</p>
                <p className="text-2xl font-bold">{communicationStats.emails}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <MessageSquare className="h-4 w-4 text-warning" />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">SMS</p>
                <p className="text-2xl font-bold">{communicationStats.sms}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Communication Timeline */}
      <Card className="shadow-soft">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Communication Timeline
          </CardTitle>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gradient-primary">
                <Plus className="h-4 w-4 mr-2" />
                Add Note
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Communication Note</DialogTitle>
                <DialogDescription>
                  Add a note about your communication with {contact?.first_name} {contact?.last_name}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="note">Note</Label>
                  <Textarea
                    id="note"
                    placeholder="Enter your note here..."
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    rows={4}
                  />
                </div>
                <div className="flex gap-2 pt-4">
                  <Button onClick={addNote} className="gradient-primary">
                    <Send className="h-4 w-4 mr-2" />
                    Add Note
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
            </div>
          ) : communications.length > 0 ? (
            <div className="space-y-4">
              {communications.map((comm) => (
                <div key={comm.id} className="border-l-2 border-muted pl-4 pb-4 relative">
                  <div className="absolute -left-2 top-2 w-4 h-4 bg-background border-2 border-primary rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-primary rounded-full"></div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge className={`text-xs ${getCommunicationTypeColor(comm.communication_type)}`}>
                          {getCommunicationIcon(comm.communication_type)}
                          <span className="ml-1">{comm.communication_type}</span>
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {comm.direction}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {new Date(comm.created_at).toLocaleString()}
                      </div>
                    </div>
                    
                    {comm.subject && (
                      <h4 className="font-medium">{comm.subject}</h4>
                    )}
                    
                    {comm.content && (
                      <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                        {comm.content}
                      </p>
                    )}
                    
                    {comm.sentiment_score && (
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          Sentiment: {(comm.sentiment_score * 100).toFixed(0)}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Communication History</h3>
              <p className="text-muted-foreground mb-4">
                Start tracking communication with {contact?.first_name} {contact?.last_name}
              </p>
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gradient-primary">
                    <Plus className="h-4 w-4 mr-2" />
                    Add First Note
                  </Button>
                </DialogTrigger>
              </Dialog>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <PhoneNumberSelector
        open={phoneDialogOpen}
        onOpenChange={setPhoneDialogOpen}
        contactId={contact.id}
        contactName={`${contact.first_name} ${contact.last_name}`}
        phoneNumbers={phoneNumbers}
        onCallInitiated={handleCallInitiated}
      />

      <FloatingEmailComposer
        isOpen={emailComposerOpen}
        onClose={() => setEmailComposerOpen(false)}
        defaultRecipient={{
          id: contact.id,
          name: `${contact.first_name} ${contact.last_name}`,
          email: contact.email,
          type: 'contact'
        }}
        onSendEmail={handleSendEmail}
      />

      <SMSComposerDialog
        open={smsDialogOpen}
        onOpenChange={setSmsDialogOpen}
        phoneNumber={contact.phone}
        contactName={`${contact.first_name} ${contact.last_name}`}
        onSend={handleSendSMS}
      />
    </div>
  );
};
