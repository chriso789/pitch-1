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
      console.log('🔵 useSendSMS: Invoking send-sms function...');
      const { data, error } = await supabase.functions.invoke('send-sms', {
        body: params
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
        description: "Your message has been delivered successfully."
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
