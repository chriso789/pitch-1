import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, DollarSign, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import StripeConnectOnboarding from "./StripeConnectOnboarding";

interface ClaimPrizeButtonProps {
  rewardId: string;
  rewardValue: number;
  rewardStatus: string;
  onSuccess?: () => void;
}

export default function ClaimPrizeButton({
  rewardId,
  rewardValue,
  rewardStatus,
  onSuccess,
}: ClaimPrizeButtonProps) {
  const [claiming, setClaiming] = useState(false);
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [needsConnection, setNeedsConnection] = useState(false);
  const { toast } = useToast();

  const handleClaimPrize = async () => {
    setClaiming(true);
    try {
      // First check if user has connected Stripe account
      const { data: statusData, error: statusError } = await supabase.functions.invoke(
        'stripe-connect-account-status'
      );

      if (statusError) throw statusError;

      if (!statusData.connected || !statusData.account?.payouts_enabled) {
        setNeedsConnection(true);
        setShowConnectDialog(true);
        setClaiming(false);
        return;
      }

      // Distribute the prize
      const { data, error } = await supabase.functions.invoke('stripe-distribute-prize', {
        body: { reward_id: rewardId },
      });

      if (error) throw error;

      if (data.success) {
        toast({
          title: "Prize Claimed! 🎉",
          description: `$${rewardValue.toFixed(2)} is on its way to your bank account. Funds typically arrive in 2-3 business days.`,
        });
        onSuccess?.();
      } else {
        throw new Error(data.error || 'Failed to claim prize');
      }
    } catch (error: any) {
      console.error('Error claiming prize:', error);
      
      // Check if error is about missing Stripe account
      if (error.message?.includes('No Stripe account') || error.message?.includes('not ready for payouts')) {
        setNeedsConnection(true);
        setShowConnectDialog(true);
        toast({
          title: "Bank Account Required",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: error.message || "Failed to claim prize. Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setClaiming(false);
    }
  };

  if (rewardStatus === 'completed') {
    return (
      <Button variant="outline" disabled>
        <DollarSign className="h-4 w-4 mr-2" />
        Prize Delivered
      </Button>
    );
  }

  if (rewardStatus === 'processing') {
    return (
      <Button variant="outline" disabled>
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        Processing...
      </Button>
    );
  }

  return (
    <>
      <Button onClick={handleClaimPrize} disabled={claiming}>
        {claiming ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Claiming...
          </>
        ) : (
          <>
            <DollarSign className="h-4 w-4 mr-2" />
            Claim ${rewardValue.toFixed(2)}
          </>
        )}
      </Button>

      <Dialog open={showConnectDialog} onOpenChange={setShowConnectDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-500" />
              Connect Bank Account Required
            </DialogTitle>
            <DialogDescription>
              To claim your ${rewardValue.toFixed(2)} prize, you need to connect your bank account for secure payouts.
            </DialogDescription>
          </DialogHeader>
          <StripeConnectOnboarding />
        </DialogContent>
      </Dialog>
    </>
  );
}
