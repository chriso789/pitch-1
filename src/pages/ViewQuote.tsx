import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Download, Phone, Mail, CheckCircle, Loader2, ExternalLink } from "lucide-react";
import { MobilePDFViewer } from "@/components/ui/MobilePDFViewer";
import { isMobileDevice } from "@/utils/mobileDetection";

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
    <div className="min-h-screen bg-gradient-to-br from-background to-muted">
      {/* Header */}
      <header
        className="py-6 px-4"
        style={{ background: `linear-gradient(135deg, ${primaryColor} 0%, #1a1a2e 100%)` }}
      >
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            {company?.logo_url && (
              <img src={company.logo_url} alt={company.name} className="h-10 rounded" />
            )}
            <div>
              <h1 className="text-white font-semibold">{company?.name || "Your Quote"}</h1>
              <p className="text-white/70 text-sm">Quote #{quote?.estimate_number}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto p-4 -mt-4">
        <Card className="shadow-2xl">
          <CardContent className="p-6">
            {/* Welcome Message */}
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold mb-2">
                Hi {quote?.recipient_name?.split(" ")[0] || "there"}!
              </h2>
              <p className="text-muted-foreground">
                Thank you for your interest. Here's your personalized quote.
              </p>
            </div>

            {/* Quote Summary */}
            {quote?.selling_price && (
              <div
                className="rounded-xl p-6 mb-6 text-center"
                style={{ background: `linear-gradient(135deg, ${primaryColor}20 0%, ${primaryColor}10 100%)` }}
              >
                <p className="text-sm text-muted-foreground mb-1">Total Investment</p>
                <p className="text-4xl font-bold" style={{ color: primaryColor }}>
                  ${Number(quote.selling_price).toLocaleString()}
                </p>
              </div>
            )}

            {/* PDF Viewer - Mobile Optimized */}
            {quote?.pdf_url ? (
              <div className="mb-6">
                <MobilePDFViewer
                  url={quote.pdf_url}
                  title={`Quote #${quote.estimate_number}`}
                  filename={`quote-${quote.estimate_number}.pdf`}
                  className="rounded-lg border min-h-[50vh] md:min-h-[60vh]"
                />
              </div>
            ) : (
              <div className="bg-muted rounded-lg p-12 text-center mb-6">
                <FileText className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Quote document will be displayed here.</p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Button
                size="lg"
                className="h-14 text-lg"
                style={{ background: `linear-gradient(135deg, ${primaryColor} 0%, #ea580c 100%)` }}
              >
                <CheckCircle className="w-5 h-5 mr-2" />
                Accept Quote
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

            {/* Contact Info */}
            <div className="mt-8 pt-6 border-t text-center">
              <p className="text-sm text-muted-foreground mb-4">
                Have questions? We're here to help!
              </p>
              <div className="flex justify-center gap-4">
                <Button variant="ghost" size="sm">
                  <Phone className="w-4 h-4 mr-2" />
                  Call Us
                </Button>
                <Button variant="ghost" size="sm">
                  <Mail className="w-4 h-4 mr-2" />
                  Email Us
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <footer className="text-center py-8 text-sm text-muted-foreground">
          <p>Powered by PITCH CRM</p>
        </footer>
      </main>
    </div>
  );
}
