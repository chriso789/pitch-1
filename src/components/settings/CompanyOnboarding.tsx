import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { 
  Building2, 
  Palette, 
  MapPin, 
  User,
  ChevronRight,
  ChevronLeft,
  Check,
  Upload
} from "lucide-react";

interface CompanyOnboardingProps {
  onComplete: () => void;
}

type Step = 'company' | 'branding' | 'location' | 'admin' | 'review';

export const CompanyOnboarding = ({ onComplete }: CompanyOnboardingProps) => {
  const { user: currentUser } = useCurrentUser();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState<Step>('company');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Company Info
  const [companyName, setCompanyName] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  
  // Branding
  const [primaryColor, setPrimaryColor] = useState("#2563eb");
  const [secondaryColor, setSecondaryColor] = useState("#1e40af");
  const [logoUrl, setLogoUrl] = useState("");
  
  // Address
  const [addressStreet, setAddressStreet] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [addressZip, setAddressZip] = useState("");
  
  // Initial Location
  const [locationName, setLocationName] = useState("Main Office");
  
  // Admin User
  const [adminFirstName, setAdminFirstName] = useState("");
  const [adminLastName, setAdminLastName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");

  const steps: { key: Step; label: string; icon: React.ReactNode }[] = [
    { key: 'company', label: 'Company Info', icon: <Building2 className="h-4 w-4" /> },
    { key: 'branding', label: 'Branding', icon: <Palette className="h-4 w-4" /> },
    { key: 'location', label: 'Location', icon: <MapPin className="h-4 w-4" /> },
    { key: 'admin', label: 'Admin User', icon: <User className="h-4 w-4" /> },
    { key: 'review', label: 'Review', icon: <Check className="h-4 w-4" /> },
  ];

  const currentStepIndex = steps.findIndex(s => s.key === currentStep);

  const canProceed = () => {
    switch (currentStep) {
      case 'company':
        return companyName.trim().length > 0;
      case 'branding':
        return true; // Optional
      case 'location':
        return locationName.trim().length > 0;
      case 'admin':
        return adminEmail.trim().length > 0 && adminFirstName.trim().length > 0;
      case 'review':
        return true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex].key);
    }
  };

  const handleBack = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex].key);
    }
  };

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);

      // Generate subdomain from company name
      const subdomain = companyName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

      // 1. Create the tenant (company)
      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .insert({
          name: companyName,
          subdomain: subdomain,
          settings: {
            license_number: licenseNumber || null,
            phone: phone || null,
            email: email || null,
            website: website || null,
            logo_url: logoUrl || null,
            primary_color: primaryColor,
            secondary_color: secondaryColor,
            address_street: addressStreet || null,
            address_city: addressCity || null,
            address_state: addressState || null,
            address_zip: addressZip || null,
            onboarded_at: new Date().toISOString(),
            onboarded_by: currentUser?.id
          }
        } as any)
        .select()
        .single();

      if (tenantError) throw tenantError;

      // 2. Create the initial location
      const { error: locationError } = await supabase
        .from('locations')
        .insert({
          tenant_id: tenant.id,
          name: locationName,
          address_street: addressStreet || null,
          address_city: addressCity || null,
          address_state: addressState || null,
          address_zip: addressZip || null,
          is_active: true
        });

      if (locationError) throw locationError;

      // 3. Log admin user info for invitation
      console.log('Admin user to invite:', adminEmail, adminFirstName, adminLastName);

      toast({
        title: "Company onboarded successfully!",
        description: `${companyName} has been created with initial location.`
      });

      onComplete();
    } catch (error: any) {
      console.error('Error onboarding company:', error);
      toast({
        title: "Error onboarding company",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Progress Steps */}
      <div className="flex items-center justify-between mb-8">
        {steps.map((step, index) => (
          <div key={step.key} className="flex items-center">
            <div 
              className={`flex items-center justify-center h-10 w-10 rounded-full border-2 transition-colors ${
                index <= currentStepIndex 
                  ? 'bg-primary border-primary text-primary-foreground' 
                  : 'border-muted-foreground/30 text-muted-foreground'
              }`}
            >
              {index < currentStepIndex ? (
                <Check className="h-5 w-5" />
              ) : (
                step.icon
              )}
            </div>
            <span className={`ml-2 text-sm hidden sm:block ${
              index <= currentStepIndex ? 'text-foreground' : 'text-muted-foreground'
            }`}>
              {step.label}
            </span>
            {index < steps.length - 1 && (
              <ChevronRight className="h-4 w-4 mx-2 text-muted-foreground" />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          {currentStep === 'company' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="companyName">Company Name *</Label>
                <Input
                  id="companyName"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Enter company name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="licenseNumber">License Number</Label>
                  <Input
                    id="licenseNumber"
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                    placeholder="e.g., CCC1234567"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="info@company.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://company.com"
                  />
                </div>
              </div>
            </>
          )}

          {currentStep === 'branding' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="logoUrl">Logo URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="logoUrl"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://example.com/logo.png"
                    className="flex-1"
                  />
                  <Button variant="outline" disabled>
                    <Upload className="h-4 w-4 mr-1" />
                    Upload
                  </Button>
                </div>
                {logoUrl && (
                  <img src={logoUrl} alt="Logo preview" className="h-16 mt-2 rounded" />
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="primaryColor">Primary Color</Label>
                  <div className="flex gap-2">
                    <Input
                      id="primaryColor"
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="w-12 h-10 p-1"
                    />
                    <Input
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="flex-1"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="secondaryColor">Secondary Color</Label>
                  <div className="flex gap-2">
                    <Input
                      id="secondaryColor"
                      type="color"
                      value={secondaryColor}
                      onChange={(e) => setSecondaryColor(e.target.value)}
                      className="w-12 h-10 p-1"
                    />
                    <Input
                      value={secondaryColor}
                      onChange={(e) => setSecondaryColor(e.target.value)}
                      className="flex-1"
                    />
                  </div>
                </div>
              </div>
              <div className="p-4 rounded-lg border" style={{ backgroundColor: primaryColor + '10' }}>
                <p className="font-medium" style={{ color: primaryColor }}>Preview</p>
                <p className="text-sm text-muted-foreground">This is how your brand colors will appear</p>
              </div>
            </>
          )}

          {currentStep === 'location' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="locationName">Location Name *</Label>
                <Input
                  id="locationName"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  placeholder="Main Office"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="addressStreet">Street Address</Label>
                <Input
                  id="addressStreet"
                  value={addressStreet}
                  onChange={(e) => setAddressStreet(e.target.value)}
                  placeholder="123 Main St"
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="addressCity">City</Label>
                  <Input
                    id="addressCity"
                    value={addressCity}
                    onChange={(e) => setAddressCity(e.target.value)}
                    placeholder="Tampa"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addressState">State</Label>
                  <Input
                    id="addressState"
                    value={addressState}
                    onChange={(e) => setAddressState(e.target.value)}
                    placeholder="FL"
                    maxLength={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addressZip">ZIP Code</Label>
                  <Input
                    id="addressZip"
                    value={addressZip}
                    onChange={(e) => setAddressZip(e.target.value)}
                    placeholder="33601"
                  />
                </div>
              </div>
            </>
          )}

          {currentStep === 'admin' && (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                Create the initial admin user for this company. They will receive an invitation to set up their account.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="adminFirstName">First Name *</Label>
                  <Input
                    id="adminFirstName"
                    value={adminFirstName}
                    onChange={(e) => setAdminFirstName(e.target.value)}
                    placeholder="John"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adminLastName">Last Name</Label>
                  <Input
                    id="adminLastName"
                    value={adminLastName}
                    onChange={(e) => setAdminLastName(e.target.value)}
                    placeholder="Smith"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="adminEmail">Email *</Label>
                <Input
                  id="adminEmail"
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="admin@company.com"
                />
              </div>
            </>
          )}

          {currentStep === 'review' && (
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">Review & Confirm</h3>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-muted-foreground">Company Name</Label>
                  <p className="font-medium">{companyName}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">License Number</Label>
                  <p className="font-medium">{licenseNumber || "Not provided"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Phone</Label>
                  <p className="font-medium">{phone || "Not provided"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Email</Label>
                  <p className="font-medium">{email || "Not provided"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Initial Location</Label>
                  <p className="font-medium">{locationName}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Address</Label>
                  <p className="font-medium">
                    {addressStreet ? `${addressStreet}, ${addressCity}, ${addressState} ${addressZip}` : "Not provided"}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Admin User</Label>
                  <p className="font-medium">{adminFirstName} {adminLastName}</p>
                  <p className="text-muted-foreground">{adminEmail}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Brand Colors</Label>
                  <div className="flex gap-2 mt-1">
                    <div className="h-6 w-6 rounded" style={{ backgroundColor: primaryColor }} />
                    <div className="h-6 w-6 rounded" style={{ backgroundColor: secondaryColor }} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation Buttons */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={currentStepIndex === 0}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        
        {currentStep === 'review' ? (
          <Button 
            onClick={handleSubmit} 
            disabled={isSubmitting}
          >
            {isSubmitting ? "Creating..." : "Create Company"}
            <Check className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button 
            onClick={handleNext} 
            disabled={!canProceed()}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
};
