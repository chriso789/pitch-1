import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface SendSMSParams {
  to: string;
  message: string;
  contactId?: string;
  jobId?: string;
}

export const useSendSMS = () => {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);

  const sendSMS = async (params: SendSMSParams) => {
    console.log('🔵 useSendSMS: Starting SMS send with params:', params);
    setSending(true);
    
    try {
      console.log('🔵 useSendSMS: Invoking telnyx-send-sms function...');
      // Routed via messaging-api (Edge Function consolidation Phase 1).
      const { data, error } = await supabase.functions.invoke('messaging-api', {
        body: {
          __route: '/sms/send',
          to: params.to,
          message: params.message,
          contactId: params.contactId,
          jobId: params.jobId
        },
        headers: { 'x-route': '/sms/send' }
      });
      
      console.log('🔵 useSendSMS: Response received:', { data, error });
      
      if (error) {
        console.error('🔴 useSendSMS: Supabase function error:', error);
        throw error;
      }
      
      if (!data?.success) {
        console.error('🔴 useSendSMS: SMS failed:', data);
        throw new Error(data?.message || 'Failed to send SMS');
      }
      
      console.log('✅ useSendSMS: SMS sent successfully:', data);
      
      toast({
        title: "SMS Sent",
        description: "Message sent. Delivery status will update shortly."
      });
      
      return data;
    } catch (error: any) {
      console.error('🔴 useSendSMS: Caught error:', error);
      toast({
        title: "Failed to send SMS",
        description: error.message || "Please try again.",
        variant: "destructive"
      });
      throw error;
    } finally {
      setSending(false);
      console.log('🔵 useSendSMS: Send operation completed');
    }
  };

  return { sendSMS, sending };
};
