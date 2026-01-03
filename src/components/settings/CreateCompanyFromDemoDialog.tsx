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
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Building2, Loader2, CheckCircle, ExternalLink } from "lucide-react";

interface DemoRequest {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  company_name: string;
  job_title: string | null;
}

interface CreateCompanyFromDemoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  demoRequest: DemoRequest | null;
  onSuccess: (companyId: string) => void;
}

export const CreateCompanyFromDemoDialog: React.FC<CreateCompanyFromDemoDialogProps> = ({
  open,
  onOpenChange,
  demoRequest,
  onSuccess,
}) => {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [createdCompanyId, setCreatedCompanyId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    companyName: "",
    ownerName: "",
    ownerEmail: "",
    ownerPhone: "",
    locationName: "Main Office",
  });
  const { toast } = useToast();

  // Update form when demo request changes
  React.useEffect(() => {
    if (demoRequest) {
      setFormData({
        companyName: demoRequest.company_name || "",
        ownerName: `${demoRequest.first_name} ${demoRequest.last_name}`.trim(),
        ownerEmail: demoRequest.email || "",
        ownerPhone: demoRequest.phone || "",
        locationName: "Main Office",
      });
      setSuccess(false);
      setCreatedCompanyId(null);
    }
  }, [demoRequest]);

  const handleSubmit = async () => {
    if (!demoRequest) return;

    setLoading(true);
    try {
      // 1. Create the tenant (company)
      const { data: tenant, error: tenantError } = await supabase
        .from("tenants")
        .insert({
          name: formData.companyName,
          slug: formData.companyName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, ""),
          owner_email: formData.ownerEmail,
          owner_name: formData.ownerName,
          owner_phone: formData.ownerPhone,
          status: "active",
          settings: {
            created_from_demo_request: demoRequest.id,
            job_title: demoRequest.job_title,
          },
        })
        .select()
        .single();

      if (tenantError) throw tenantError;

      // 2. Create the default location
      const { error: locationError } = await supabase
        .from("locations")
        .insert({
          tenant_id: tenant.id,
          name: formData.locationName,
          address: "",
          is_primary: true,
        });

      if (locationError) {
        console.error("Location creation error:", locationError);
      }

      // 3. Update demo request status to converted
      const { error: updateError } = await supabase
        .from("demo_requests")
        .update({
          status: "converted",
          converted_to_company_id: tenant.id,
        } as any)
        .eq("id", demoRequest.id);

      if (updateError) {
        console.error("Demo request update error:", updateError);
      }

      // 4. Send onboarding email
      try {
        await supabase.functions.invoke("send-company-onboarding", {
          body: {
            tenantId: tenant.id,
            companyName: formData.companyName,
            ownerEmail: formData.ownerEmail,
            ownerName: formData.ownerName,
          },
        });
      } catch (emailError) {
        console.error("Onboarding email error:", emailError);
      }

      setCreatedCompanyId(tenant.id);
      setSuccess(true);
      
      toast({
        title: "Company Created Successfully",
        description: `${formData.companyName} has been created and the demo request has been marked as converted.`,
      });

      onSuccess(tenant.id);
    } catch (error: any) {
      console.error("Error creating company:", error);
      toast({
        title: "Error Creating Company",
        description: error.message || "Failed to create company. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSuccess(false);
    setCreatedCompanyId(null);
    onOpenChange(false);
  };

  if (!demoRequest) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Create Company Account
          </DialogTitle>
          <DialogDescription>
            Create a new company account from the demo request. This will set up the
            tenant, create a default location, and send an onboarding email.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="py-6 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Company Created!</h3>
              <p className="text-muted-foreground text-sm mt-1">
                {formData.companyName} has been successfully created.
              </p>
            </div>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
              <Button
                onClick={() => {
                  window.open(`/admin/companies/${createdCompanyId}`, "_blank");
                }}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View Company
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="companyName">Company Name</Label>
                <Input
                  id="companyName"
                  value={formData.companyName}
                  onChange={(e) =>
                    setFormData({ ...formData, companyName: e.target.value })
                  }
                  placeholder="Enter company name"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ownerName">Owner Name</Label>
                  <Input
                    id="ownerName"
                    value={formData.ownerName}
                    onChange={(e) =>
                      setFormData({ ...formData, ownerName: e.target.value })
                    }
                    placeholder="Owner full name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ownerPhone">Owner Phone</Label>
                  <Input
                    id="ownerPhone"
                    value={formData.ownerPhone}
                    onChange={(e) =>
                      setFormData({ ...formData, ownerPhone: e.target.value })
                    }
                    placeholder="Phone number"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ownerEmail">Owner Email</Label>
                <Input
                  id="ownerEmail"
                  type="email"
                  value={formData.ownerEmail}
                  onChange={(e) =>
                    setFormData({ ...formData, ownerEmail: e.target.value })
                  }
                  placeholder="email@company.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="locationName">Default Location Name</Label>
                <Input
                  id="locationName"
                  value={formData.locationName}
                  onChange={(e) =>
                    setFormData({ ...formData, locationName: e.target.value })
                  }
                  placeholder="Main Office"
                />
              </div>

              <div className="text-xs text-muted-foreground bg-muted p-3 rounded-lg">
                <p>
                  <strong>Note:</strong> This will create a new company account with an
                  active subscription. An onboarding email will be sent to the owner.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose} disabled={loading}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={loading || !formData.companyName || !formData.ownerEmail}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Building2 className="h-4 w-4 mr-2" />
                    Create Company
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CreateCompanyFromDemoDialog;
