/**
 * SmartDoc Picker Dialog
 * Lets an admin pick an existing SmartDoc and share it with a homeowner's portal folder.
 */
import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Search, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface SmartDocPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  projectId?: string | null;
  recipientName: string;
  onShared?: (doc: { id: string; title: string }) => void;
}

export const SmartDocPickerDialog: React.FC<SmartDocPickerDialogProps> = ({
  open,
  onOpenChange,
  contactId,
  projectId,
  recipientName,
  onShared,
}) => {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [sharing, setSharing] = useState<string | null>(null);

  const { data: docs, isLoading } = useQuery({
    queryKey: ["smart-docs-picker"],
    queryFn: async () => {
      // SmartDocs = company resource documents (what shows in /smart-docs UI)
      const { data, error } = await supabase
        .from("documents")
        .select("id, filename, description, file_path, mime_type, file_size, updated_at")
        .eq("document_type", "company_resource")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const filtered = (docs || []).filter((d) =>
    !search ||
    d.filename?.toLowerCase().includes(search.toLowerCase()) ||
    d.description?.toLowerCase().includes(search.toLowerCase())
  );

  const handleShare = async (doc: { id: string; filename: string; file_path: string; mime_type: string | null; file_size: number | null; description: string | null }) => {
    setSharing(doc.id);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id, active_tenant_id")
        .eq("id", authUser?.id || "")
        .single();
      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) throw new Error("No tenant");

      // Clone the company resource into a homeowner-visible document linked to this contact/project
      const { data: inserted, error } = await supabase
        .from("documents")
        .insert({
          tenant_id: tenantId,
          contact_id: contactId,
          project_id: projectId || null,
          filename: doc.filename,
          file_path: doc.file_path,
          mime_type: doc.mime_type,
          file_size: doc.file_size,
          document_type: "smart_doc_shared",
          is_visible_to_homeowner: true,
          uploaded_by: authUser?.id,
          description: `SmartDoc shared with ${recipientName}${doc.description ? ` — ${doc.description}` : ""}`,
        })
        .select()
        .single();
      if (error) throw error;

      toast({ title: "SmartDoc shared", description: `${doc.filename} added to portal folder.` });
      onShared?.({ id: inserted.id, title: doc.filename });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Share failed", description: e.message, variant: "destructive" });
    } finally {
      setSharing(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add SmartDoc to Portal Folder</DialogTitle>
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
              No SmartDocs found.
            </p>
          ) : (
            <div className="space-y-2">
              {filtered.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <FileText className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{doc.filename}</p>
                      {doc.description && (
                        <p className="text-xs text-muted-foreground truncate">
                          {doc.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleShare(doc)}
                    disabled={sharing !== null}
                  >
                    {sharing === doc.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Add"
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
