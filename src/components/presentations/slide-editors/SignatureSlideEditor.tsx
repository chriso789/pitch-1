import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FileSignature } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface SignatureSlideEditorProps {
  slide: any;
  onUpdate: () => void;
}

export const SignatureSlideEditor = ({
  slide,
  onUpdate,
}: SignatureSlideEditorProps) => {
  const { toast } = useToast();
  const [documentTitle, setDocumentTitle] = useState(
    slide.content?.document_title || "Agreement"
  );
  const [legalText, setLegalText] = useState(slide.content?.legal_text || "");
  const [requireDate, setRequireDate] = useState(
    slide.content?.require_date ?? true
  );
  const [requirePrintedName, setRequirePrintedName] = useState(
    slide.content?.require_printed_name ?? true
  );

  useEffect(() => {
    setDocumentTitle(slide.content?.document_title || "Agreement");
    setLegalText(slide.content?.legal_text || "");
    setRequireDate(slide.content?.require_date ?? true);
    setRequirePrintedName(slide.content?.require_printed_name ?? true);
  }, [slide.id]);

  const handleUpdate = async (field: string, value: any) => {
    try {
      const updatedContent = {
        ...slide.content,
        [field]: value,
      };

      const { error } = await supabase
        .from("presentation_slides")
        .update({ content: updatedContent })
        .eq("id", slide.id);

      if (error) throw error;
      onUpdate();
    } catch (error: any) {
      console.error("Error updating slide:", error);
      toast({
        title: "Failed to update",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-8">
        <div className="space-y-6">
          <div className="text-center">
            <FileSignature className="h-16 w-16 mx-auto mb-4 text-primary" />
            <h2 className="text-3xl font-bold mb-2">{documentTitle}</h2>
          </div>

          {legalText && (
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm whitespace-pre-wrap">{legalText}</p>
            </div>
          )}

          <div className="border-t pt-6 space-y-4">
            <div className="text-center text-muted-foreground">
              <p>Customer signature will be captured here</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {requirePrintedName && (
                <div>
                  <Label className="text-xs">Printed Name</Label>
                  <div className="h-10 border-b border-muted-foreground/30 mt-1" />
                </div>
              )}
              {requireDate && (
                <div>
                  <Label className="text-xs">Date</Label>
                  <div className="h-10 border-b border-muted-foreground/30 mt-1" />
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="document-title">Document Title</Label>
          <Input
            id="document-title"
            value={documentTitle}
            onChange={(e) => setDocumentTitle(e.target.value)}
            onBlur={(e) => handleUpdate("document_title", e.target.value)}
            placeholder="Agreement"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="legal-text">Legal Text / Terms</Label>
          <Textarea
            id="legal-text"
            value={legalText}
            onChange={(e) => setLegalText(e.target.value)}
            onBlur={(e) => handleUpdate("legal_text", e.target.value)}
            placeholder="Enter any legal text or terms that should appear above the signature..."
            rows={6}
          />
        </div>

        <div className="space-y-3">
          <Label>Required Fields</Label>
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="require-printed-name"
                checked={requirePrintedName}
                onCheckedChange={(checked) => {
                  setRequirePrintedName(checked as boolean);
                  handleUpdate("require_printed_name", checked);
                }}
              />
              <label htmlFor="require-printed-name" className="text-sm">
                Require Printed Name
              </label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="require-date"
                checked={requireDate}
                onCheckedChange={(checked) => {
                  setRequireDate(checked as boolean);
                  handleUpdate("require_date", checked);
                }}
              />
              <label htmlFor="require-date" className="text-sm">
                Require Date
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
