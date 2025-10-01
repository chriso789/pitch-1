import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ExternalLink, CreditCard } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface EnhancedPaymentFormProps {
  selectedJob?: any;
  contactId?: string;
  projectId?: string;
  onSuccess?: () => void;
}

export default function EnhancedPaymentForm({ 
  selectedJob, 
  contactId,
  projectId,
  onSuccess 
}: EnhancedPaymentFormProps) {
  const [amount, setAmount] = useState(selectedJob?.total || "");
  const [description, setDescription] = useState(
    selectedJob ? `Payment for ${selectedJob.project_name}` : ""
  );
  const [paymentType, setPaymentType] = useState<"link" | "portal">("link");
  const [loading, setLoading] = useState(false);

  const handleGeneratePaymentLink = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setLoading(true);

    try {
      // Create payment record first
      const { data: payment, error: paymentError } = await supabase
        .from("payments")
        .insert({
          contact_id: contactId || selectedJob?.contact_id,
          project_id: projectId || selectedJob?.id,
          amount: parseFloat(amount),
          status: "pending",
          payment_method: "credit_card",
          description: description || undefined,
        })
        .select()
        .single();

      if (paymentError) throw paymentError;

      // Generate Stripe payment link
      const { data, error } = await supabase.functions.invoke(
        "stripe-create-payment-link",
        {
          body: {
            amount: parseFloat(amount),
            currency: "usd",
            description: description || "Payment",
            contactId: contactId || selectedJob?.contact_id,
            projectId: projectId || selectedJob?.id,
            paymentId: payment.id,
            metadata: {
              job_number: selectedJob?.job_number,
            },
          },
        }
      );

      if (error) throw error;

      if (data?.paymentLink?.url) {
        // Copy to clipboard
        await navigator.clipboard.writeText(data.paymentLink.url);
        
        toast.success("Payment link generated and copied to clipboard!", {
          action: {
            label: "Open Link",
            onClick: () => window.open(data.paymentLink.url, "_blank"),
          },
        });

        // Open in new tab
        window.open(data.paymentLink.url, "_blank");

        onSuccess?.();
      }
    } catch (error: any) {
      console.error("Error generating payment link:", error);
      toast.error(error.message || "Failed to generate payment link");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCustomerPortal = async () => {
    if (!contactId && !selectedJob?.contact_id) {
      toast.error("Contact information is required for customer portal");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        "stripe-customer-portal",
        {
          body: {
            contactId: contactId || selectedJob?.contact_id,
            returnUrl: window.location.href,
          },
        }
      );

      if (error) throw error;

      if (data?.url) {
        window.open(data.url, "_blank");
        toast.success("Opening customer portal...");
      }
    } catch (error: any) {
      console.error("Error opening customer portal:", error);
      toast.error(error.message || "Failed to open customer portal");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Process Payment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {selectedJob && (
          <div className="bg-muted p-4 rounded-lg space-y-2">
            <p className="text-sm font-medium">Payment For:</p>
            <p className="text-sm">{selectedJob.project_name}</p>
            <p className="text-xs text-muted-foreground">
              Job #{selectedJob.job_number}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="paymentType">Payment Method</Label>
          <Select value={paymentType} onValueChange={(v) => setPaymentType(v as "link" | "portal")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="link">
                <div className="flex items-center gap-2">
                  <ExternalLink className="h-4 w-4" />
                  <span>Generate Payment Link</span>
                </div>
              </SelectItem>
              <SelectItem value="portal">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  <span>Customer Portal</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {paymentType === "link"
              ? "Send a secure payment link to the customer"
              : "Open Stripe customer portal for payment management"}
          </p>
        </div>

        {paymentType === "link" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (USD)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                placeholder="Payment description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </>
        )}

        <Button
          onClick={paymentType === "link" ? handleGeneratePaymentLink : handleOpenCustomerPortal}
          disabled={loading || (paymentType === "link" && !amount)}
          className="w-full"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : paymentType === "link" ? (
            <>
              <ExternalLink className="h-4 w-4 mr-2" />
              Generate Payment Link
            </>
          ) : (
            <>
              <CreditCard className="h-4 w-4 mr-2" />
              Open Customer Portal
            </>
          )}
        </Button>

        <p className="text-xs text-muted-foreground text-center">
          Payments are securely processed by Stripe
        </p>
      </CardContent>
    </Card>
  );
}
