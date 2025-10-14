import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Phone, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface PhoneNumber {
  label: string;
  number: string;
}

interface PhoneNumberSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  phoneNumbers: PhoneNumber[];
  pipelineEntryId?: string;
  onCallInitiated: (callLog: any) => void;
}

export const PhoneNumberSelector: React.FC<PhoneNumberSelectorProps> = ({
  open,
  onOpenChange,
  contactId,
  contactName,
  phoneNumbers,
  pipelineEntryId,
  onCallInitiated
}) => {
  const [calling, setCalling] = useState<string | null>(null);

  const initiateCall = async (phoneNumber: string) => {
    setCalling(phoneNumber);

    try {
      const { data, error } = await supabase.functions.invoke('twilio-voice-call', {
        body: {
          contactId,
          phoneNumber,
          pipelineEntryId
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: 'Call initiated',
          description: `Calling ${phoneNumber}...`
        });
        onCallInitiated(data.callLog);
        onOpenChange(false);
      } else {
        throw new Error(data?.error || 'Failed to initiate call');
      }
    } catch (error: any) {
      console.error('Error initiating call:', error);
      toast({
        title: 'Call failed',
        description: error.message || 'Unable to initiate call. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setCalling(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Call {contactName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {phoneNumbers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No phone numbers available for this contact.
            </p>
          ) : (
            phoneNumbers.map((phone, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent transition-colors"
              >
                <div>
                  <p className="text-sm font-medium">{phone.label}</p>
                  <p className="text-sm text-muted-foreground">{phone.number}</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => initiateCall(phone.number)}
                  disabled={calling !== null}
                >
                  {calling === phone.number ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Calling...
                    </>
                  ) : (
                    <>
                      <Phone className="h-4 w-4 mr-2" />
                      Call
                    </>
                  )}
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
