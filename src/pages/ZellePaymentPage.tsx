import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, DollarSign, Mail, Phone, CheckCircle2, AlertCircle, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface ZellePaymentData {
  amount: number;
  currency: string;
  description: string;
  status: string;
  company_name: string;
  zelle_email: string | null;
  zelle_phone: string | null;
  zelle_display_name: string | null;
  zelle_instructions: string | null;
  invoice_number: string | null;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

const getSupabaseUrl = () => {
  return import.meta.env.VITE_SUPABASE_URL;
};

export default function ZellePaymentPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ZellePaymentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notifying, setNotifying] = useState(false);
  const [notified, setNotified] = useState(false);

  useEffect(() => {
    if (!token) return;
    const load = async () => {
      try {
        const response = await fetch(
          `${getSupabaseUrl()}/functions/v1/zelle-payment-page?token=${token}`,
          {
            headers: {
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
          }
        );

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || "Payment link not found");
        }

        const result = await response.json();
        setData(result);
        if (result.status === "pending_verification") {
          setNotified(true);
        }
      } catch (err: any) {
        setError(err.message || "Failed to load payment details");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token]);

  const memoText = data?.invoice_number ? `${data.invoice_number}` : token?.slice(0, 8)?.toUpperCase() || "";

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied!`);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      toast.success(`${label} copied!`);
    }
  };

  const handleOpenZelle = () => {
    // Zelle doesn't have a universal deep link - open web fallback
    window.location.href = "https://www.zellepay.com";
  };

  const handleNotifyPayment = async () => {
    if (!token) return;
    setNotifying(true);
    try {
      const response = await fetch(
        `${getSupabaseUrl()}/functions/v1/zelle-payment-page`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ token, action: "notify_sent" }),
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to notify");
      }

      setNotified(true);
    } catch (err: any) {
      toast.error(err.message || "Failed to send notification");
    } finally {
      setNotifying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Payment Link Not Found</h2>
            <p className="text-sm text-muted-foreground">{error || "This payment link may have expired or been removed."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (data.status === "confirmed") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Payment Confirmed</h2>
            <p className="text-sm text-muted-foreground">
              Your payment of {formatCurrency(data.amount)} has been confirmed. Thank you!
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-xl">{data.company_name}</CardTitle>
          {data.invoice_number && (
            <p className="text-sm text-muted-foreground">Invoice: {data.invoice_number}</p>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Amount */}
          <div className="text-center bg-muted/50 rounded-xl p-6">
            <p className="text-sm text-muted-foreground mb-1">Amount Due</p>
            <p className="text-4xl font-bold">{formatCurrency(data.amount)}</p>
            {data.description && (
              <p className="text-sm text-muted-foreground mt-2">{data.description}</p>
            )}
          </div>

          {/* Zelle Details with copy buttons */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Pay via Zelle
            </h3>

            {data.zelle_display_name && (
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Send to</p>
                <p className="font-medium">{data.zelle_display_name}</p>
              </div>
            )}

            {data.zelle_email && (
              <button
                onClick={() => copyToClipboard(data.zelle_email!, "Email")}
                className="w-full bg-muted/30 rounded-lg p-3 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left"
              >
                <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Zelle Email</p>
                  <p className="font-medium text-sm truncate">{data.zelle_email}</p>
                </div>
                <Copy className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              </button>
            )}

            {data.zelle_phone && (
              <button
                onClick={() => copyToClipboard(data.zelle_phone!, "Phone")}
                className="w-full bg-muted/30 rounded-lg p-3 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left"
              >
                <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Zelle Phone</p>
                  <p className="font-medium text-sm">{data.zelle_phone}</p>
                </div>
                <Copy className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              </button>
            )}

            {/* Memo / Reference */}
            <button
              onClick={() => copyToClipboard(memoText, "Memo")}
              className="w-full bg-primary/5 border border-primary/20 rounded-lg p-3 flex items-center gap-3 hover:bg-primary/10 transition-colors text-left"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Memo (include with payment)</p>
                <p className="font-semibold text-sm">{memoText}</p>
              </div>
              <Copy className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            </button>

            {/* Amount copy */}
            <button
              onClick={() => copyToClipboard(data.amount.toFixed(2), "Amount")}
              className="w-full bg-muted/30 rounded-lg p-3 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left"
            >
              <DollarSign className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Amount to send</p>
                <p className="font-semibold text-sm">{formatCurrency(data.amount)}</p>
              </div>
              <Copy className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            </button>
          </div>

          {/* Instructions */}
          <div className="bg-muted/20 border border-border rounded-lg p-4">
            <h4 className="text-sm font-semibold mb-2">How to Pay</h4>
            {data.zelle_instructions ? (
              <p className="text-sm text-muted-foreground">{data.zelle_instructions}</p>
            ) : (
              <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
                <li>Open your banking app</li>
                <li>Go to <strong>Send Money with Zelle®</strong></li>
                <li>Search for <strong>{data.zelle_email || data.zelle_phone}</strong></li>
                <li>Enter <strong>{formatCurrency(data.amount)}</strong> as the amount</li>
                <li>Add memo: <strong>{memoText}</strong></li>
                <li>Send the payment</li>
              </ol>
            )}
          </div>

          {/* Open Zelle button */}
          <Button
            variant="outline"
            className="w-full"
            onClick={handleOpenZelle}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Open Zelle
          </Button>

          {/* Notify button */}
          {!notified ? (
            <Button
              className="w-full"
              size="lg"
              onClick={handleNotifyPayment}
              disabled={notifying}
            >
              {notifying ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              I've Sent the Payment
            </Button>
          ) : (
            <div className="text-center bg-green-500/10 rounded-lg p-4">
              <CheckCircle2 className="h-6 w-6 text-green-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-green-700">Thank you!</p>
              <p className="text-xs text-muted-foreground">
                {data.company_name} has been notified and will confirm your payment shortly.
              </p>
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center">
            Zelle® is a service of Early Warning Services, LLC.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
