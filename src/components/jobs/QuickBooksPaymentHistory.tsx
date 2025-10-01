import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Calendar } from "lucide-react";
import { format } from "date-fns";

interface QuickBooksPaymentHistoryProps {
  projectId: string;
  tenantId: string;
}

interface PaymentHistory {
  id: string;
  qbo_payment_id: string;
  payment_amount: number;
  payment_date: string;
  payment_method: string;
  metadata: {
    payment_ref_number?: string;
    total_amount?: number;
  };
}

export function QuickBooksPaymentHistory({ projectId, tenantId }: QuickBooksPaymentHistoryProps) {
  const { data: payments, isLoading } = useQuery<PaymentHistory[]>({
    queryKey: ['qbo-payment-history', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('qbo_payment_history')
        .select('*')
        .eq('project_id', projectId)
        .order('payment_date', { ascending: false });

      if (error) throw error;
      return data as PaymentHistory[];
    },
  });

  if (isLoading || !payments || payments.length === 0) {
    return null;
  }

  const totalPaid = payments.reduce((sum, p) => sum + p.payment_amount, 0);

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Payment History
          </h3>
          <Badge variant="secondary">
            Total Paid: ${totalPaid.toFixed(2)}
          </Badge>
        </div>

        <div className="space-y-3">
          {payments.map((payment) => (
            <div
              key={payment.id}
              className="flex items-center justify-between p-3 border rounded-lg"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {format(new Date(payment.payment_date), 'MMM dd, yyyy')}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {payment.payment_method}
                  {payment.metadata?.payment_ref_number && (
                    <span className="ml-2">
                      Ref: {payment.metadata.payment_ref_number}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold text-green-600">
                  ${payment.payment_amount.toFixed(2)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
