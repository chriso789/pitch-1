/**
 * Add Portal User Dialog
 * Search current projects and grant portal access to the project's contact.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Check, FolderKanban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";
import { DEFAULT_PERMISSIONS } from "@/hooks/usePortalAdmin";

interface AddPortalUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ProjectSearchResult {
  id: string;
  name: string | null;
  clj_formatted_number: string | null;
  contact_id: string | null;
  lead_name: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  portal_access_enabled: boolean | null;
}

export const AddPortalUserDialog: React.FC<AddPortalUserDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const debounced = useDebounce(query, 250);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelectedId(null);
      setSubmitting(false);
    }
  }, [open]);

  const { data: results, isLoading } = useQuery({
    queryKey: ["portal-add-project-search", tenantId, debounced],
    queryFn: async (): Promise<ProjectSearchResult[]> => {
      if (!tenantId) return [];
      const term = debounced.trim();

      // Pull pipeline entries that have an associated project, scoped to tenant
      let q = supabase
        .from("pipeline_entries")
        .select(
          `id, lead_name, contact_id,
           projects!inner(id, name, clj_formatted_number, tenant_id),
           contact:contacts!pipeline_entries_contact_id_fkey(
             id, first_name, last_name, email, phone, portal_access_enabled
           )`
        )
        .eq("tenant_id", tenantId)
        .limit(25);

      if (term.length > 0) {
        const like = `%${term}%`;
        q = q.or(
          `lead_name.ilike.${like},projects.name.ilike.${like},projects.clj_formatted_number.ilike.${like}`
        );
      }

      const { data, error } = await q;
      if (error) throw error;

      return (data || []).flatMap((row: any) => {
        const projects = Array.isArray(row.projects) ? row.projects : [row.projects];
        const contact = row.contact;
        return projects
          .filter((p: any) => p && p.tenant_id === tenantId)
          .map((p: any) => ({
            id: p.id,
            name: p.name || row.lead_name,
            clj_formatted_number: p.clj_formatted_number,
            contact_id: contact?.id || row.contact_id,
            lead_name: row.lead_name,
            contact_first_name: contact?.first_name || null,
            contact_last_name: contact?.last_name || null,
            contact_email: contact?.email || null,
            contact_phone: contact?.phone || null,
            portal_access_enabled: contact?.portal_access_enabled ?? false,
          }));
      });
    },
    enabled: open && !!tenantId,
  });

  const selected = useMemo(
    () => results?.find((r) => r.id === selectedId) || null,
    [results, selectedId]
  );

  const handleGrant = async () => {
    if (!selected || !tenantId) return;
    if (!selected.contact_id) {
      toast({
        title: "No contact on project",
        description: "This project has no linked homeowner contact.",
        variant: "destructive",
      });
      return;
    }
    if (!selected.contact_email) {
      toast({
        title: "Contact missing email",
        description: "Add an email to the contact before granting portal access.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      // 1) Enable portal access on the contact
      const { error: contactErr } = await supabase
        .from("contacts")
        .update({
          portal_access_enabled: true,
          portal_access_granted_at: new Date().toISOString(),
        })
        .eq("id", selected.contact_id)
        .eq("tenant_id", tenantId);
      if (contactErr) throw contactErr;

      // 2) Seed default permissions (idempotent upsert)
      const { error: permErr } = await supabase
        .from("homeowner_portal_permissions")
        .upsert(
          {
            tenant_id: tenantId,
            contact_id: selected.contact_id,
            ...DEFAULT_PERMISSIONS,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "contact_id" }
        );
      if (permErr) throw permErr;

      toast({
        title: "Portal access granted",
        description: `${selected.contact_first_name ?? ""} ${
          selected.contact_last_name ?? ""
        }`.trim() + ` now has access to ${selected.name || "this project"}.`,
      });

      queryClient.invalidateQueries({ queryKey: ["portal-users"] });
      queryClient.invalidateQueries({ queryKey: ["portal-stats"] });
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Failed to grant access",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Portal User</DialogTitle>
          <DialogDescription>
            Search current projects and select one to grant the homeowner portal
            access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Search by project name or CLJ number..."
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="border rounded-lg max-h-80 overflow-y-auto">
            {isLoading ? (
              <div className="p-3 space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : !results || results.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No projects found
              </div>
            ) : (
              <ul className="divide-y">
                {results.map((r) => {
                  const isSel = r.id === selectedId;
                  const contactName = `${r.contact_first_name ?? ""} ${
                    r.contact_last_name ?? ""
                  }`.trim();
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(r.id)}
                        className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/50 transition-colors ${
                          isSel ? "bg-muted" : ""
                        }`}
                      >
                        <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                          <FolderKanban className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium truncate">
                              {r.name || r.lead_name || "Untitled project"}
                            </p>
                            {r.clj_formatted_number && (
                              <Badge variant="outline" className="text-xs">
                                {r.clj_formatted_number}
                              </Badge>
                            )}
                            {r.portal_access_enabled && (
                              <Badge className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
                                Already enabled
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground truncate">
                            {contactName || "No contact"}
                            {r.contact_email ? ` • ${r.contact_email}` : ""}
                          </p>
                        </div>
                        {isSel && <Check className="h-4 w-4 text-primary" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleGrant} disabled={!selected || submitting}>
            {submitting ? "Granting..." : "Grant Portal Access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddPortalUserDialog;
