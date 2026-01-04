import { useState } from 'react';
import { AlertCircle, UserPlus, Loader2, CheckCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface OwnerProvisioningBannerProps {
  tenantId: string;
  onProvisioned?: () => void;
}

export const OwnerProvisioningBanner = ({ tenantId, onProvisioned }: OwnerProvisioningBannerProps) => {
  const [isProvisioning, setIsProvisioning] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Check if owner is provisioned for this tenant
  const { data, isLoading } = useQuery({
    queryKey: ['owner-provisioned', tenantId],
    queryFn: async () => {
      // Get tenant owner_email
      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .select('owner_email, owner_name, name')
        .eq('id', tenantId)
        .single();

      if (tenantError || !tenant?.owner_email) {
        return { needsProvisioning: false, ownerEmail: null, ownerName: null, companyName: null };
      }

      // Check if owner exists in user_roles for this tenant
      const { data: ownerRole, error: roleError } = await supabase
        .from('user_roles')
        .select('id, user_id')
        .eq('tenant_id', tenantId)
        .eq('role', 'owner')
        .maybeSingle();

      // Also check if profile exists with this email
      const { data: ownerProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', tenant.owner_email)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      const isProvisioned = !!ownerRole || !!ownerProfile;

      return {
        needsProvisioning: !isProvisioned,
        ownerEmail: tenant.owner_email,
        ownerName: tenant.owner_name,
        companyName: tenant.name,
      };
    },
    staleTime: 30 * 1000,
    enabled: !!tenantId,
  });

  const handleProvisionOwner = async () => {
    if (!tenantId) return;

    setIsProvisioning(true);
    try {
      const { data: result, error } = await supabase.functions.invoke('provision-tenant-owner', {
        body: { tenant_id: tenantId, send_email: true }
      });

      if (error) throw new Error(error.message);

      if (result?.error) throw new Error(result.error);

      toast({
        title: "Owner Provisioned",
        description: (
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span>
              {result?.is_new_user 
                ? `Created account for ${result.email}. Setup email sent.` 
                : `Updated account for ${result.email}.`}
            </span>
          </div>
        ),
      });

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['owner-provisioned', tenantId] });
      queryClient.invalidateQueries({ queryKey: ['user-management-data'] });
      onProvisioned?.();

    } catch (err: any) {
      console.error('Provisioning error:', err);
      toast({
        title: "Provisioning Failed",
        description: err.message || "Could not provision owner account",
        variant: "destructive",
      });
    } finally {
      setIsProvisioning(false);
    }
  };

  if (isLoading || !data?.needsProvisioning) {
    return null;
  }

  return (
    <Alert variant="default" className="mb-6 border-amber-500/50 bg-amber-500/10">
      <AlertCircle className="h-5 w-5 text-amber-500" />
      <AlertTitle className="text-amber-700 dark:text-amber-300">
        Owner Account Not Set Up
      </AlertTitle>
      <AlertDescription className="mt-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="text-sm text-muted-foreground">
            <p>
              The owner account for <strong>{data.ownerName || data.ownerEmail}</strong> has not been provisioned yet.
            </p>
            <p className="mt-1">
              Click the button to create the account and send a setup email to{' '}
              <span className="font-medium">{data.ownerEmail}</span>.
            </p>
          </div>
          <Button 
            onClick={handleProvisionOwner}
            disabled={isProvisioning}
            className="shrink-0"
          >
            {isProvisioning ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Provisioning...
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4 mr-2" />
                Provision Owner
              </>
            )}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
};
