import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertCircle, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DocResponse {
  id: string;
  filename: string;
  mime_type: string | null;
  signed_url: string;
}

const ViewDocumentTracked: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [doc, setDoc] = useState<DocResponse | null>(null);
  const [recipient, setRecipient] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const { data, error: invokeError } = await supabase.functions.invoke("track-document-view", {
          body: { token },
        });
        if (invokeError) throw invokeError;
        if (!data?.success) throw new Error(data?.error || "Invalid link");
        setDoc(data.document);
        setRecipient(data.recipient_name || "");
      } catch (err: any) {
        console.error(err);
        setError(err.message || "Could not load document");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <h1 className="text-2xl font-semibold">Link Unavailable</h1>
          <p className="text-muted-foreground">{error || "This link is invalid or has expired."}</p>
        </div>
      </div>
    );
  }

  const isPdf = (doc.mime_type === "application/pdf") || doc.filename.toLowerCase().endsWith(".pdf");
  const isImage = (doc.mime_type || "").startsWith("image/");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-5 w-5 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="font-medium truncate">{doc.filename}</h1>
            {recipient && <p className="text-xs text-muted-foreground truncate">Shared with {recipient}</p>}
          </div>
        </div>
        <Button asChild size="sm" variant="outline">
          <a href={doc.signed_url} download={doc.filename} target="_blank" rel="noopener noreferrer">
            <Download className="h-4 w-4 mr-2" /> Download
          </a>
        </Button>
      </header>

      <main className="flex-1 bg-muted/40">
        {isPdf ? (
          <iframe
            src={doc.signed_url}
            title={doc.filename}
            className="w-full h-[calc(100vh-57px)] border-0"
          />
        ) : isImage ? (
          <div className="flex items-center justify-center p-6">
            <img src={doc.signed_url} alt={doc.filename} className="max-w-full max-h-[80vh] rounded shadow" />
          </div>
        ) : (
          <div className="flex items-center justify-center p-12">
            <Button asChild size="lg">
              <a href={doc.signed_url} target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4 mr-2" /> Open {doc.filename}
              </a>
            </Button>
          </div>
        )}
      </main>
    </div>
  );
};

export default ViewDocumentTracked;
