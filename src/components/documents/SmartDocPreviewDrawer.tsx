import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface SmartDocPreviewDrawerProps {
  open: boolean;
  onClose: () => void;
  instanceId?: string;
  html?: string;
  defaultFilename?: string;
  contactEmail?: string;
}

type Status = "HTML_ONLY" | "GENERATING" | "READY" | "EMAILING" | "ERROR";

export default function SmartDocPreviewDrawer({
  open,
  onClose,
  instanceId,
  html,
  defaultFilename = "document.pdf",
  contactEmail = "",
}: SmartDocPreviewDrawerProps) {
  const [status, setStatus] = useState<Status>("HTML_ONLY");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState(defaultFilename);
  const [toEmail, setToEmail] = useState(contactEmail);
  const [subject, setSubject] = useState("Your Document is Ready");
  const [message, setMessage] = useState("Please find your document attached.");
  const [errorMsg, setErrorMsg] = useState("");

  const createPDF = async () => {
    if (!instanceId) {
      toast.error("No document instance available");
      return;
    }

    setStatus("GENERATING");
    setErrorMsg("");

    try {
      const { data, error } = await supabase.functions.invoke("smart-docs-pdf", {
        body: {
          instance_id: instanceId,
          upload: "signed",
          filename,
        },
      });

      if (error) throw error;

      if (!data.ok) {
        throw new Error(data.error || "PDF generation failed");
      }

      setStatus("READY");
      setPdfUrl(data.pdf_url);
      toast.success(`PDF generated successfully (${data.size_kb}KB)`);
    } catch (err: any) {
      console.error("PDF generation error:", err);
      setStatus("ERROR");
      setErrorMsg(err.message || "Failed to generate PDF");
      toast.error(err.message || "Failed to generate PDF");
    }
  };

  const emailPDF = async () => {
    if (!instanceId || status !== "READY" || !toEmail) {
      toast.error("PDF must be generated and email must be provided");
      return;
    }

    setStatus("EMAILING");
    setErrorMsg("");

    try {
      const { data, error } = await supabase.functions.invoke("smart-docs-pdf", {
        body: {
          instance_id: instanceId,
          upload: "signed",
          filename,
          to_email: toEmail,
          subject,
          message,
          attach: false,
        },
      });

      if (error) throw error;

      if (!data.ok) {
        throw new Error(data.error || "Email sending failed");
      }

      setStatus("READY");
      if (data.emailed) {
        toast.success(`Email sent successfully to ${toEmail}`);
      } else {
        toast.info("PDF generated but email not sent");
      }
    } catch (err: any) {
      console.error("Email sending error:", err);
      setStatus("ERROR");
      setErrorMsg(err.message || "Failed to send email");
      toast.error(err.message || "Failed to send email");
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case "HTML_ONLY":
        return <Badge variant="secondary">HTML only</Badge>;
      case "GENERATING":
        return <Badge variant="outline" className="border-amber-500 text-amber-600">Generating PDF…</Badge>;
      case "READY":
        return <Badge variant="outline" className="border-green-500 text-green-600">PDF ready</Badge>;
      case "EMAILING":
        return <Badge variant="outline" className="border-blue-500 text-blue-600">Emailing…</Badge>;
      case "ERROR":
        return <Badge variant="destructive">Error</Badge>;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-4xl overflow-y-auto" aria-modal="true">
        <SheetHeader>
          <SheetTitle>Document Preview</SheetTitle>
          <SheetDescription>
            Preview the generated document and create a PDF version
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted p-2 flex items-center justify-between">
              <span className="text-sm font-medium">Preview</span>
              {getStatusBadge()}
            </div>
            <iframe
              srcDoc={html || "<p>No content available</p>"}
              className="w-full h-96 bg-white"
              title="Document Preview"
            />
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Label htmlFor="filename">PDF Filename</Label>
                <Input
                  id="filename"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="document.pdf"
                  disabled={status === "GENERATING" || status === "EMAILING"}
                />
              </div>
              <div className="pt-6">
                <Button
                  onClick={createPDF}
                  disabled={status === "GENERATING" || status === "EMAILING" || !instanceId}
                  aria-busy={status === "GENERATING"}
                >
                  {status === "GENERATING" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create PDF
                </Button>
              </div>
            </div>

            {pdfUrl && status === "READY" && (
              <div className="flex items-center gap-2">
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open PDF
                </a>
              </div>
            )}
          </div>

          <div className="border-t pt-4 space-y-4">
            <h3 className="font-medium">Email PDF</h3>
            <div className="grid gap-4">
              <div>
                <Label htmlFor="to-email">To</Label>
                <Input
                  id="to-email"
                  type="email"
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  placeholder="customer@example.com"
                  disabled={status === "EMAILING"}
                />
              </div>
              <div>
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={status === "EMAILING"}
                />
              </div>
              <div>
                <Label htmlFor="message">Message</Label>
                <Textarea
                  id="message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  disabled={status === "EMAILING"}
                />
              </div>
              <Button
                onClick={emailPDF}
                disabled={status !== "READY" || !toEmail}
                aria-busy={status === "EMAILING"}
              >
                {status === "EMAILING" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Email PDF
              </Button>
            </div>
          </div>

          {errorMsg && (
            <div className="bg-destructive/10 text-destructive p-3 rounded-lg text-sm">
              {errorMsg}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
