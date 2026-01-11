import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PresentationContext } from "@/lib/presentation-variables";
import { VisibilityContext, buildVisibilityContext } from "@/lib/presentation-visibility";

interface UsePresentationContextOptions {
  pipelineEntryId?: string;
  contactId?: string;
  projectId?: string;
  jobId?: string;
}

interface UsePresentationContextReturn {
  context: PresentationContext;
  visibilityContext: VisibilityContext;
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook to load presentation context data from CRM
 * Pulls contact, job, estimate, insurance, and company data
 */
export function usePresentationContext(
  options: UsePresentationContextOptions
): UsePresentationContextReturn {
  const [context, setContext] = useState<PresentationContext>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadContext() {
      setIsLoading(true);
      setError(null);

      try {
        const newContext: PresentationContext = {};

        // Get current user's tenant for company info
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("tenant_id")
            .eq("id", user.id)
            .single();

          if (profile?.tenant_id) {
            const { data: tenant } = await supabase
              .from("tenants")
              .select("name, phone, website, logo_url, settings")
              .eq("id", profile.tenant_id)
              .single();

            if (tenant) {
              const settings = tenant.settings as Record<string, any> | null;
              newContext.company = {
                name: tenant.name,
                phone: tenant.phone || undefined,
                website: tenant.website || undefined,
                logo_url: tenant.logo_url || undefined,
                license: settings?.license_number,
                email: settings?.email,
                address: settings?.address,
              };
            }
          }
        }

        // Load pipeline entry data if provided
        if (options.pipelineEntryId) {
          const { data: entry } = await supabase
            .from("pipeline_entries")
            .select(`
              *,
              contact:contacts(*),
              project:projects(*)
            `)
            .eq("id", options.pipelineEntryId)
            .single();

          if (entry) {
            // Contact data - use correct column names from schema
            if (entry.contact) {
              const c = entry.contact as Record<string, any>;
              newContext.contact = {
                id: c.id,
                first_name: c.first_name,
                last_name: c.last_name,
                full_name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
                email: c.email || undefined,
                phone: c.phone || undefined,
                address: c.address_street || undefined,
                city: c.address_city || undefined,
                state: c.address_state || undefined,
                zip: c.address_zip || undefined,
              };
            }

            // Project data - use correct column names from schema
            if (entry.project) {
              const p = entry.project as Record<string, any>;
              newContext.project = {
                id: p.id,
                name: p.name,
                address: p.property_address,
                start_date: p.start_date,
                end_date: p.actual_completion_date,
              };

              // Job data from project
              newContext.job = {
                id: p.id,
                job_type: p.job_type,
                roof_type: p.roof_material,
                roof_squares: p.total_squares,
                estimated_value: p.contract_value,
                is_insurance: p.insurance_claim_id != null,
                status: p.status,
                description: p.notes,
              };
            }
          }
        }

        // Load contact directly if provided
        if (options.contactId && !newContext.contact) {
          const { data: contact } = await supabase
            .from("contacts")
            .select("*")
            .eq("id", options.contactId)
            .single();

          if (contact) {
            newContext.contact = {
              id: contact.id,
              first_name: contact.first_name,
              last_name: contact.last_name,
              full_name: `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
              email: contact.email || undefined,
              phone: contact.phone || undefined,
              address: contact.address_street || undefined,
              city: contact.address_city || undefined,
              state: contact.address_state || undefined,
              zip: contact.address_zip || undefined,
            };
          }
        }

        // Load estimate data if we have a project
        if (newContext.project?.id) {
          const { data: estimates } = await supabase
            .from("estimates")
            .select("*")
            .eq("project_id", newContext.project.id)
            .order("created_at", { ascending: false })
            .limit(1);

          if (estimates && estimates.length > 0) {
            const e = estimates[0];
            newContext.estimate = {
              id: e.id,
              total: e.selling_price,
              materials_total: e.material_cost,
              labor_total: e.labor_cost,
              // Good/Better/Best would come from estimate options if available
            };
          }
        }

        setContext(newContext);
      } catch (err: any) {
        console.error("Error loading presentation context:", err);
        setError(err.message || "Failed to load presentation data");
      } finally {
        setIsLoading(false);
      }
    }

    loadContext();
  }, [options.pipelineEntryId, options.contactId, options.projectId, options.jobId]);

  // Build visibility context from loaded data
  const visibilityContext = useMemo(() => {
    return buildVisibilityContext({
      job: context.job,
      estimate: context.estimate,
    });
  }, [context]);

  return {
    context,
    visibilityContext,
    isLoading,
    error,
  };
}
