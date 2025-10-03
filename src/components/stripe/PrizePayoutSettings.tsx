import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, DollarSign, Clock, CheckCircle2, XCircle } from "lucide-react";
import { format } from "date-fns";
import StripeConnectOnboarding from "./StripeConnectOnboarding";

interface PayoutTransaction {
  id: string;
  amount: number;
  currency: string;
  status: string;
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
}

export default function PrizePayoutSettings() {
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<PayoutTransaction[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    loadPayoutHistory();
  }, []);

  const loadPayoutHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('payout_transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      
      setTransactions(data || []);
    } catch (error) {
      console.error('Error loading payout history:', error);
      toast({
        title: "Error",
        description: "Failed to load payout history.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'pending':
      case 'processing':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusText = (status: string) => {
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  return (
    <div className="space-y-6">
      <StripeConnectOnboarding />

      <Card>
        <CardHeader>
          <CardTitle>Payout History</CardTitle>
          <CardDescription>
            View your recent prize payouts and their status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <DollarSign className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No payouts yet</p>
              <p className="text-sm mt-1">Win competitions to earn cash prizes!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {transactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-4">
                    {getStatusIcon(transaction.status)}
                    <div>
                      <p className="font-medium">
                        ${transaction.amount.toFixed(2)} {transaction.currency.toUpperCase()}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(transaction.created_at), 'MMM d, yyyy')}
                      </p>
                      {transaction.failure_reason && (
                        <p className="text-sm text-red-500 mt-1">
                          {transaction.failure_reason}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-medium">
                      {getStatusText(transaction.status)}
                    </span>
                    {transaction.completed_at && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Completed {format(new Date(transaction.completed_at), 'MMM d')}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
