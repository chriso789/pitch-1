import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  CreditCard, 
  Loader2, 
  CheckCircle2, 
  Clock, 
  DollarSign,
  ExternalLink,
  ShieldCheck
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface Payment {
  id: string;
  amount: number;
  status: string;
  created_at: string;
  description?: string;
  payment_method?: string;
}

interface PaymentLink {
  id: string;
  amount: number;
  status: string;
  stripe_payment_link_url: string;
  description?: string;
  created_at: string;
}

interface Estimate {
  id: string;
  total_amount: number;
  status: string;
  estimate_number?: string;
}

interface CustomerPaymentSectionProps {
  projectId: string;
  contactId?: string;
  token: string;
  payments?: Payment[];
  paymentLinks?: PaymentLink[];
  estimates?: Estimate[];
  totalProjectValue?: number;
  amountPaid?: number;
  onPaymentComplete?: () => void;
}

export function CustomerPaymentSection({
  projectId,
  contactId,
  token,
  payments = [],
  paymentLinks = [],
  estimates = [],
  totalProjectValue = 0,
  amountPaid = 0,
  onPaymentComplete,
}: CustomerPaymentSectionProps) {
  const [generatingLink, setGeneratingLink] = useState(false);
  const { toast } = useToast();

  // Calculate balance due
  const approvedEstimate = estimates.find(e => e.status === 'approved' || e.status === 'accepted');
  const projectTotal = totalProjectValue || approvedEstimate?.total_amount || 0;
  const paidAmount = amountPaid || payments
    .filter(p => p.status === 'completed' || p.status === 'paid')
    .reduce((sum, p) => sum + (p.amount || 0), 0);
  const balanceDue = Math.max(0, projectTotal - paidAmount);

  // Get active payment links
  const activePaymentLinks = paymentLinks.filter(pl => pl.status === 'active');

  const handlePayNow = async (paymentLinkUrl: string) => {
    window.open(paymentLinkUrl, '_blank');
  };

  const requestPaymentLink = async () => {
    if (balanceDue <= 0) {
      toast({
        title: 'No balance due',
        description: 'Your account is paid in full!',
      });
      return;
    }

    setGeneratingLink(true);
    try {
      const { data, error } = await supabase.functions.invoke('customer-portal-access', {
        body: {
          action: 'request_payment_link',
          token,
          project_id: projectId,
          amount: balanceDue,
        },
      });

      if (error || !data?.success) {
        throw new Error(data?.error || 'Failed to generate payment link');
      }

      if (data.payment_link_url) {
        toast({
          title: 'Payment link ready!',
          description: 'Opening secure payment page...',
        });
        window.open(data.payment_link_url, '_blank');
        onPaymentComplete?.();
      }
    } catch (error: any) {
      console.error('Payment link error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to generate payment link',
        variant: 'destructive',
      });
    } finally {
      setGeneratingLink(false);
    }
  };

  const getPaymentStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }> = {
      completed: { variant: 'default', icon: <CheckCircle2 className="w-3 h-3 mr-1" /> },
      paid: { variant: 'default', icon: <CheckCircle2 className="w-3 h-3 mr-1" /> },
      pending: { variant: 'secondary', icon: <Clock className="w-3 h-3 mr-1" /> },
      processing: { variant: 'secondary', icon: <Loader2 className="w-3 h-3 mr-1 animate-spin" /> },
      failed: { variant: 'destructive', icon: null },
    };

    const config = statusConfig[status.toLowerCase()] || { variant: 'outline' as const, icon: null };

    return (
      <Badge variant={config.variant} className="capitalize">
        {config.icon}
        {status}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      {/* Payment Summary Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <DollarSign className="w-5 h-5 text-primary" />
            Payment Summary
          </CardTitle>
          <CardDescription>
            View your project payment status and make payments
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Balance Summary */}
          <div className="grid grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Project Total</p>
              <p className="text-xl font-bold">${projectTotal.toLocaleString()}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Amount Paid</p>
              <p className="text-xl font-bold text-green-600">${paidAmount.toLocaleString()}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Balance Due</p>
              <p className={`text-xl font-bold ${balanceDue > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                ${balanceDue.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Pay Now Button */}
          {balanceDue > 0 && (
            <div className="space-y-3">
              {activePaymentLinks.length > 0 ? (
                // Show existing payment links
                activePaymentLinks.map((link) => (
                  <Button
                    key={link.id}
                    onClick={() => handlePayNow(link.stripe_payment_link_url)}
                    className="w-full h-14 text-lg"
                    size="lg"
                  >
                    <CreditCard className="w-5 h-5 mr-2" />
                    Pay ${link.amount.toLocaleString()} Now
                    <ExternalLink className="w-4 h-4 ml-2" />
                  </Button>
                ))
              ) : (
                // Request new payment link
                <Button
                  onClick={requestPaymentLink}
                  disabled={generatingLink}
                  className="w-full h-14 text-lg"
                  size="lg"
                >
                  {generatingLink ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Preparing secure payment...
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-5 h-5 mr-2" />
                      Pay ${balanceDue.toLocaleString()} Now
                    </>
                  )}
                </Button>
              )}

              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="w-4 h-4" />
                <span>Secure payment powered by Stripe</span>
              </div>
            </div>
          )}

          {balanceDue === 0 && projectTotal > 0 && (
            <div className="flex items-center justify-center gap-2 p-4 bg-success/10 rounded-lg text-success">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-medium">Paid in Full - Thank You!</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment History */}
      {payments.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Payment History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {payments.map((payment, index) => (
                <React.Fragment key={payment.id}>
                  {index > 0 && <Separator />}
                  <div className="flex items-center justify-between py-2">
                    <div className="space-y-1">
                      <p className="font-medium">
                        {payment.description || 'Payment'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(payment.created_at), { addSuffix: true })}
                        {payment.payment_method && ` • ${payment.payment_method}`}
                      </p>
                    </div>
                    <div className="text-right space-y-1">
                      <p className="font-bold text-lg text-foreground">${payment.amount.toLocaleString()}</p>
                      {getPaymentStatusBadge(payment.status)}
                    </div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
