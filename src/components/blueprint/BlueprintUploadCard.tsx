import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { uploadBlueprintDocument, parseBlueprintDocument } from "@/integrations/blueprintApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export function BlueprintUploadCard({ onUploaded }: { onUploaded: () => void }) {
  const { activeTenantId: tenantId } = useActiveTenantId();
  const [uploading, setUploading] = useState(false);
  const [propertyAddress, setPropertyAddress] = useState("");

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!tenantId) {
      toast({ title: "No active company", variant: "destructive" });
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast({ title: "PDF only", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const docId = crypto.randomUUID();
      const path = `${tenantId}/${docId}/${file.name}`;
      const { error: upErr } = await supabase.storage
        .from("blueprint-documents")
        .upload(path, file, { contentType: "application/pdf", upsert: false });
      if (upErr) {
        // Fallback to existing 'blueprints' bucket if blueprint-documents isn't writable
        const { error: upErr2 } = await supabase.storage
          .from("blueprints")
          .upload(path, file, { contentType: "application/pdf", upsert: false });
        if (upErr2) throw upErr2;
      }

      const result = await uploadBlueprintDocument({
        file_name: file.name,
        file_path: path,
        property_address: propertyAddress || undefined,
      });
      // Kick off the actual parser pipeline (rasterize + classify chain)
      await parseBlueprintDocument(result.document.id).catch(() => {});
      toast({ title: "Uploaded", description: "Parsing queued" });
      setPropertyAddress("");
      onUploaded();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" /> Upload blueprint PDF
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="addr">Property address (optional)</Label>
          <Input id="addr" value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} />
        </div>
        <div className="flex items-center gap-3">
          <Input type="file" accept="application/pdf" disabled={uploading} onChange={handleFileChange} />
          {uploading && <Loader2 className="h-5 w-5 animate-spin" />}
        </div>
      </CardContent>
    </Card>
  );
}
