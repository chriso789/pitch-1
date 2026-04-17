/**
 * SmartDoc Picker Dialog
 * Lets an admin pick a built SmartDoc template, create an instance for the homeowner,
 * and hand it off to the signature request flow so the homeowner can sign / fill it.
 */
import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { FileSignature, Search, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";

interface TaggedDocumentRow {
  document_id: string;
  documents: {
    id: string;
    filename: string;
    description: string | null;
    file_path: string;
    created_at: string | null;
    updated_at: string | null;
  } | {
    id: string;
    filename: string;
    description: string | null;
    file_path: string;
    created_at: string | null;
    updated_at: string | null;
  }[];
}

interface PickerSmartDoc {
  id: string;
  title: string;
  description: string | null;
  filePath: string;
  tagCount: number;
  updated_at?: string | null;
}

interface SmartDocPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  projectId?: string | null;
  recipientName: string;
  /** Called once an instance has been created and is ready for signature. */
  onInstanceReady?: (instance: { id: string; title: string }) => void;
}

export const SmartDocPickerDialog: React.FC<SmartDocPickerDialogProps> = ({
  open,
  onOpenChange,
  contactId,
  projectId,
  recipientName,
  onInstanceReady,
}) => {
  const { toast } = useToast();
  const tenantId = useEffectiveTenantId();
  const [search, setSearch] = useState("");
  const [preparing, setPreparing] = useState<string | null>(null);

  const { data: docs, isLoading } = useQuery<PickerSmartDoc[]>({
    queryKey: ["smart-doc-picker", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from("document_tag_placements")
        .select(`
          document_id,
          documents!inner(id, filename, description, file_path, created_at, updated_at)
        `)
        .eq("documents.tenant_id", tenantId)
        .eq("documents.document_type", "company_resource")
        .limit(200);
      if (error) throw error;

      const uniqueDocs = new Map<string, PickerSmartDoc>();

      for (const row of (data || []) as TaggedDocumentRow[]) {
        const document = Array.isArray(row.documents) ? row.documents[0] : row.documents;
        if (!document) continue;

        const existing = uniqueDocs.get(document.id);
        if (existing) {
          existing.tagCount += 1;
          continue;
        }

        uniqueDocs.set(document.id, {
          id: document.id,
          title: document.filename,
          description: document.description,
          filePath: document.file_path,
          tagCount: 1,
          updated_at: document.updated_at ?? document.created_at,
        });
      }

      return Array.from(uniqueDocs.values()).sort((a, b) => {
        const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return bTime - aTime;
      });
    },
    enabled: open && !!tenantId,
  });

  const filtered = (docs || []).filter((d) =>
    !search ||
    d.title?.toLowerCase().includes(search.toLowerCase()) ||
    d.description?.toLowerCase().includes(search.toLowerCase())
  );

  const handlePick = async (doc: PickerSmartDoc) => {
    setPreparing(doc.id);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!tenantId) throw new Error("No tenant");

      let pipelineEntryId: string | null = null;

      if (projectId) {
        const { data: project, error: projectError } = await supabase
          .from("projects")
          .select("pipeline_entry_id")
          .eq("id", projectId)
          .maybeSingle();

        if (projectError) throw projectError;
        pipelineEntryId = project?.pipeline_entry_id ?? null;
      }

      if (!pipelineEntryId) {
        const { data: pipelineEntries, error: pipelineError } = await supabase
          .from("pipeline_entries")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("contact_id", contactId)
          .order("created_at", { ascending: false })
          .limit(1);

        if (pipelineError) throw pipelineError;
        pipelineEntryId = pipelineEntries?.[0]?.id ?? null;
      }

      if (!pipelineEntryId) {
        throw new Error("No linked lead or project was found for this homeowner");
      }

      const { data: renderedDoc, error: renderError } = await supabase.functions.invoke("render-tagged-pdf", {
        body: {
          document_id: doc.id,
          pipeline_entry_id: pipelineEntryId,
        },
      });

      if (renderError) throw renderError;
      if (!renderedDoc?.pdfBase64) throw new Error("Failed to render SmartDoc PDF");

      const binary = atob(renderedDoc.pdfBase64);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const pdfBlob = new Blob([bytes], { type: "application/pdf" });
      const safeName = doc.title.replace(/[^\w.-]/g, "_");
      const storagePath = `${tenantId}/${contactId}/${Date.now()}_${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(storagePath, pdfBlob, {
          contentType: "application/pdf",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: instance, error } = await supabase
        .from("smart_doc_instances")
        .insert({
          tenant_id: tenantId,
          template_id: null,
          title: doc.title,
          rendered_html: "",
          pdf_url: storagePath,
          storage_path: storagePath,
          lead_id: pipelineEntryId,
          created_by: authUser?.id,
        })
        .select()
        .single();
      if (error) throw error;

      toast({
        title: "SmartDoc ready",
        description: `Sending ${doc.title} to ${recipientName} for signature.`,
      });
      onInstanceReady?.({ id: instance.id, title: doc.title });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Failed to prepare SmartDoc", description: e.message, variant: "destructive" });
    } finally {
      setPreparing(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose a SmartDoc to Send</DialogTitle>
          <DialogDescription>
            Pick a tagged company document from Smart Docs. It will be auto-filled and sent for signature.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search SmartDocs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <ScrollArea className="h-[360px] pr-2">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No tagged Smart Docs found. Add smart tags to a company document in Smart Docs first.
            </p>
          ) : (
            <div className="space-y-2">
              {filtered.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <FileSignature className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{doc.title}</p>
                      {doc.description && (
                        <p className="text-xs text-muted-foreground truncate">
                          {doc.description}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {doc.tagCount} smart tag{doc.tagCount === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handlePick(doc)}
                    disabled={preparing !== null}
                  >
                    {preparing === doc.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Send"
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
