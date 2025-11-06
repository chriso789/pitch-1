import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface SendOrderEmailParams {
  orderId: string;
  action: 'submit' | 'status_change' | 'reminder';
}

export const useMaterialOrderEmail = () => {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);

  const sendOrderEmail = async (params: SendOrderEmailParams) => {
    console.log('📧 Sending material order email:', params);
    setSending(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('material-order-send-email', {
        body: {
          orderId: params.orderId,
          action: params.action
        }
      });
      
      if (error) {
        console.error('❌ Email send error:', error);
        throw error;
      }
      
      if (!data?.success) {
        throw new Error('Failed to send email');
      }
      
      console.log('✅ Email sent successfully:', data);
      
      toast({
        title: "Email Sent",
        description: "Order notification has been sent to the vendor."
      });
      
      return data;
    } catch (error: any) {
      console.error('❌ Email send failed:', error);
      toast({
        title: "Failed to send email",
        description: error.message || "Please try again.",
        variant: "destructive"
      });
      throw error;
    } finally {
      setSending(false);
    }
  };

  return { sendOrderEmail, sending };
};
