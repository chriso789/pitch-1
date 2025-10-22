/**
 * Call Button Component
 * Quick action button to initiate a call to a contact
 */

import { Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { telnyxService } from '@/services/telnyxService';
import { useToast } from '@/hooks/use-toast';

interface CallButtonProps {
  phoneNumber: string;
  contactId?: string;
  contactName?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

export const CallButton = ({ 
  phoneNumber, 
  contactId, 
  contactName,
  variant = 'outline',
  size = 'sm',
  className 
}: CallButtonProps) => {
  const { toast } = useToast();

  const handleCall = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!phoneNumber) {
      toast({
        title: 'No Phone Number',
        description: 'This contact does not have a phone number',
        variant: 'destructive',
      });
      return;
    }

    const result = await telnyxService.makeCall(phoneNumber, contactId);
    
    if (result.success) {
      toast({
        title: 'Calling...',
        description: contactName ? `Calling ${contactName}` : `Calling ${phoneNumber}`,
      });
    } else {
      toast({
        title: 'Call Failed',
        description: 'Unable to place call. Please check your softphone is initialized.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleCall}
      className={className}
      title={`Call ${phoneNumber}`}
    >
      <Phone className="h-4 w-4" />
      {size !== 'icon' && <span className="ml-2">Call</span>}
    </Button>
  );
};
