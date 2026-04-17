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

  const { data: docs, isLoading } = useQuery({
    queryKey: ["smart-doc-templates-picker", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from("smart_doc_templates")
        .select("id, title, description, content, category, status, updated_at")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!tenantId,
  });

  const filtered = (docs || []).filter((d) =>
    !search ||
    d.title?.toLowerCase().includes(search.toLowerCase()) ||
    d.description?.toLowerCase().includes(search.toLowerCase()) ||
    d.category?.toLowerCase().includes(search.toLowerCase())
  );

  const handlePick = async (doc: { id: string; title: string; description: string | null; content: string | null }) => {
    setPreparing(doc.id);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!tenantId) throw new Error("No tenant");

      // Create a smart_doc instance for this homeowner from the template
      const { data: instance, error } = await supabase
        .from("smart_doc_instances")
        .insert({
          tenant_id: tenantId,
          template_id: doc.id,
          title: doc.title,
          rendered_html: doc.content || "",
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
            Pick a built SmartDoc template. The homeowner will receive a link to open, fill, and sign it.
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
              No SmartDocs found. Build one in the SmartDocs section first.
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
