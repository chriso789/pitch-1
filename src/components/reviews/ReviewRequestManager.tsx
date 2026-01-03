import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Star, Send, MessageSquare, Mail, CheckCircle, Clock, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';
import { toast } from 'sonner';

interface Contact {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

interface ReviewRequestManagerProps {
  contact: Contact;
  projectId?: string;
  onRequestSent?: () => void;
}

const REVIEW_PLATFORMS = [
  { id: 'google', name: 'Google', icon: '🔍', color: 'bg-blue-100 text-blue-800' },
  { id: 'yelp', name: 'Yelp', icon: '⭐', color: 'bg-red-100 text-red-800' },
  { id: 'facebook', name: 'Facebook', icon: '📘', color: 'bg-indigo-100 text-indigo-800' },
  { id: 'bbb', name: 'BBB', icon: '🏢', color: 'bg-gray-100 text-gray-800' },
  { id: 'internal', name: 'Internal Review', icon: '📝', color: 'bg-green-100 text-green-800' },
];

export const ReviewRequestManager: React.FC<ReviewRequestManagerProps> = ({
  contact,
  projectId,
  onRequestSent
}) => {
  const { activeCompany } = useCompanySwitcher();
  const [isOpen, setIsOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState('google');
  const [sendVia, setSendVia] = useState<'sms' | 'email' | 'both'>('both');
  const [customMessage, setCustomMessage] = useState('');

  const contactName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Customer';

  const defaultMessage = `Hi ${contactName}! Thank you for choosing ${currentCompany?.name || 'us'}. We'd love to hear about your experience! Would you mind leaving us a quick review? It really helps our business.`;

  const handleSendRequest = async () => {
    if (!activeCompany?.tenant_id) {
      toast.error('No company selected');
      return;
    }

    setIsSending(true);

    try {
      const { data, error } = await supabase.functions.invoke('request-customer-review', {
        body: {
          tenant_id: activeCompany.tenant_id,
          contact_id: contact.id,
          project_id: projectId,
          review_type: selectedPlatform,
          send_via: sendVia,
          custom_message: customMessage || undefined
        }
      });

      if (error) throw error;

      if (data.success) {
        toast.success('Review request sent successfully!');
        setIsOpen(false);
        onRequestSent?.();
      } else {
        throw new Error(data.error || 'Failed to send request');
      }
    } catch (error: any) {
      console.error('Review request error:', error);
      toast.error(error.message || 'Failed to send review request');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Star className="h-4 w-4 mr-2" />
          Request Review
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 text-yellow-500" />
            Request Customer Review
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Contact Info */}
          <Card>
            <CardContent className="p-3">
              <p className="font-medium">{contactName}</p>
              <div className="flex gap-4 mt-1 text-sm text-muted-foreground">
                {contact.email && (
                  <span className="flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    {contact.email}
                  </span>
                )}
                {contact.phone && (
                  <span className="flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" />
                    {contact.phone}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Platform Selection */}
          <div>
            <Label>Review Platform</Label>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {REVIEW_PLATFORMS.map(platform => (
                <Button
                  key={platform.id}
                  variant={selectedPlatform === platform.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedPlatform(platform.id)}
                  className="flex flex-col h-auto py-3"
                >
                  <span className="text-lg mb-1">{platform.icon}</span>
                  <span className="text-xs">{platform.name}</span>
                </Button>
              ))}
            </div>
          </div>

          {/* Send Method */}
          <div>
            <Label>Send Via</Label>
            <div className="flex gap-2 mt-2">
              <Button
                variant={sendVia === 'sms' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSendVia('sms')}
                disabled={!contact.phone}
              >
                <MessageSquare className="h-4 w-4 mr-1" />
                SMS
              </Button>
              <Button
                variant={sendVia === 'email' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSendVia('email')}
                disabled={!contact.email}
              >
                <Mail className="h-4 w-4 mr-1" />
                Email
              </Button>
              <Button
                variant={sendVia === 'both' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSendVia('both')}
                disabled={!contact.phone || !contact.email}
              >
                Both
              </Button>
            </div>
          </div>

          {/* Custom Message */}
          <div>
            <Label htmlFor="customMessage">Message (optional)</Label>
            <Textarea
              id="customMessage"
              placeholder={defaultMessage}
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              className="mt-1"
              rows={4}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Leave blank to use the default message
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSendRequest} disabled={isSending}>
              {isSending ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Request
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
