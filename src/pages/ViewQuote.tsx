import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Download, Phone, Mail, CheckCircle, Loader2, AlertCircle } from "lucide-react";
import { MobilePDFViewer } from "@/components/ui/MobilePDFViewer";
import { toast } from "sonner";

interface QuoteData {
  estimate_number: string;
  selling_price: number;
  pdf_url: string;
  recipient_name: string;
  contact: {
    first_name: string;
    last_name: string;
    email: string;
  } | null;
}

interface CompanyData {
  name: string;
  logo_url: string;
  primary_color: string;
  secondary_color: string;
}

export default function ViewQuote() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [company, setCompany] = useState<CompanyData | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isCreatingSignature, setIsCreatingSignature] = useState(false);
  const startTimeRef = useRef<number>(Date.now());
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (token) {
      trackView();
      loadQuote();
    }

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [token]);

  const trackView = async () => {
    try {
      const response = await supabase.functions.invoke("track-quote-view", {
        body: { token, action: "view" }
      });

      if (response.data?.success) {
        setSessionId(response.data.session_id);
        startHeartbeat(response.data.session_id);
      }
    } catch (err) {
      console.error("Error tracking view:", err);
    }
  };

  const startHeartbeat = (sid: string) => {
    heartbeatIntervalRef.current = setInterval(async () => {
      const duration = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const scrollDepth = Math.floor(
        (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100
      ) || 0;

      await supabase.functions.invoke("track-quote-view", {
        body: {
          token,
          action: "heartbeat",
          session_id: sid,
          duration_seconds: duration,
          scroll_depth_percent: scrollDepth
        }
      });
    }, 30000); // Every 30 seconds
  };

  const loadQuote = async () => {
    try {
      const response = await supabase.functions.invoke("track-quote-view", {
        body: { token, action: "get_quote" }
      });

      if (response.data?.success) {
        setQuote(response.data.quote);
        setCompany(response.data.company);
      } else {
        setError(response.data?.error || "Quote not found");
      }
    } catch (err: any) {
      setError(err.message || "Failed to load quote");
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptQuote = async () => {
    if (!token) return;

    setIsCreatingSignature(true);
    try {
      const { data, error } = await supabase.functions.invoke("request-quote-signature", {
        body: { token }
      });

      if (error) {
        console.error("Signature request error:", error);
        throw new Error(error.message || "Failed to create signature request");
      }

      if (!data?.success) {
        throw new Error(data?.error || "Failed to create signature request");
      }

      // Redirect to signature page
      if (data.access_token) {
        window.location.href = `/sign/${data.access_token}`;
      } else {
        throw new Error("No signing URL returned");
      }
    } catch (err: any) {
      console.error("Accept quote error:", err);
      toast.error(err.message || "Failed to prepare signature request. Please try again.");
    } finally {
      setIsCreatingSignature(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading your quote...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <FileText className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <h1 className="text-xl font-semibold mb-2">Quote Unavailable</h1>
            <p className="text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const primaryColor = company?.primary_color || "#f97316";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Pinned Header */}
      <header
        className="shrink-0 py-4 px-4 shadow-md"
        style={{ background: `linear-gradient(135deg, ${primaryColor} 0%, #1a1a2e 100%)` }}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {company?.logo_url && (
              <img src={company.logo_url} alt={company.name} className="h-8 rounded" />
            )}
            <div>
              <h1 className="text-white font-semibold text-sm md:text-base">{company?.name || "Your Quote"}</h1>
              <p className="text-white/70 text-xs">Quote #{quote?.estimate_number}</p>
            </div>
          </div>
          {quote?.selling_price && (
            <div className="text-right">
              <p className="text-white/70 text-xs">Total Investment</p>
              <p className="text-white font-bold text-lg">${Number(quote.selling_price).toLocaleString()}</p>
            </div>
          )}
        </div>
      </header>

      {/* Full-height PDF Container */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {quote?.pdf_url ? (
          <div className="flex-1 min-h-0">
            <MobilePDFViewer
              url={quote.pdf_url}
              title={`Quote #${quote.estimate_number}`}
              filename={`quote-${quote.estimate_number}.pdf`}
              className="h-full w-full"
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="bg-muted rounded-lg p-12 text-center max-w-md">
              <AlertCircle className="w-16 h-16 text-amber-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Document Unavailable</h3>
              <p className="text-muted-foreground mb-4">
                We couldn't load the quote document at this time. Please contact us for assistance.
              </p>
              <div className="flex justify-center gap-3">
                <Button variant="outline" size="sm">
                  <Phone className="w-4 h-4 mr-2" />
                  Call Us
                </Button>
                <Button variant="outline" size="sm">
                  <Mail className="w-4 h-4 mr-2" />
                  Email Us
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Pinned Action Footer */}
      <footer className="shrink-0 bg-background border-t p-4 shadow-lg">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button
              size="lg"
              className="h-14 text-lg font-semibold"
              style={{ background: `linear-gradient(135deg, ${primaryColor} 0%, #ea580c 100%)` }}
              onClick={handleAcceptQuote}
              disabled={isCreatingSignature}
            >
              {isCreatingSignature ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Preparing...
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5 mr-2" />
                  Accept Quote
                </>
              )}
            </Button>
            {quote?.pdf_url && (
              <Button variant="outline" size="lg" className="h-14 text-lg" asChild>
                <a href={quote.pdf_url} download>
                  <Download className="w-5 h-5 mr-2" />
                  Download PDF
                </a>
              </Button>
            )}
          </div>

          {/* Contact Row */}
          <div className="mt-3 flex justify-center gap-4 text-sm">
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <Phone className="w-4 h-4 mr-1" />
              Call Us
            </Button>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <Mail className="w-4 h-4 mr-1" />
              Email Us
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground mt-2">
            Powered by PITCH CRM
          </p>
        </div>
      </footer>
    </div>
  );
}
