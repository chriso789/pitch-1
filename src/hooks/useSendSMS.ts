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
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-sms', {
        body: params
      });
      
      if (error) throw error;
      
      toast({
        title: "SMS Sent",
        description: "Your message has been delivered successfully."
      });
      
      return data;
    } catch (error: any) {
      console.error('Error sending SMS:', error);
      toast({
        title: "Failed to send SMS",
        description: error.message || "Please try again.",
        variant: "destructive"
      });
      throw error;
    } finally {
      setSending(false);
    }
  };

  return { sendSMS, sending };
};
