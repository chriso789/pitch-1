import { useState } from 'react';
import { 
  Building2, Palette, MapPin, Users, Settings, CheckCircle2, 
  ChevronRight, ChevronLeft, Check, Loader2, Eye, EyeOff
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LogoUploader } from './LogoUploader';
import { AddressValidation } from '@/shared/components/forms/AddressValidation';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface OnboardingLocation {
  name: string;
  address: string;
  verificationData: any | null;
}

interface OnboardingAdminUser {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  password_confirm: string;
  role: string;
  title: string;
}

interface OnboardingSettings {
  timezone: string;
  features_enabled: string[];
  auto_assign_leads: boolean;
  notifications_enabled: boolean;
}

interface CompanyData {
  name: string;
  website: string;
  phone: string;
  email: string;
  license_number: string;
}

interface BrandingData {
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
}

const STEPS = [
  { key: 'company', label: 'Company Info', icon: Building2 },
  { key: 'branding', label: 'Branding', icon: Palette },
  { key: 'locations', label: 'Locations', icon: MapPin },
  { key: 'team', label: 'Team Setup', icon: Users },
  { key: 'settings', label: 'Settings', icon: Settings },
  { key: 'review', label: 'Review', icon: CheckCircle2 },
] as const;

type StepKey = typeof STEPS[number]['key'];

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Phoenix', label: 'Arizona (MST)' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
];

const FEATURES = [
  { key: 'crm', label: 'CRM & Contacts' },
  { key: 'estimates', label: 'Estimates & Proposals' },
  { key: 'calendar', label: 'Calendar & Scheduling' },
  { key: 'pipeline', label: 'Sales Pipeline' },
  { key: 'measurements', label: 'Roof Measurements' },
  { key: 'canvass', label: 'Storm Canvass Pro' },
];

interface EnhancedCompanyOnboardingProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (tenantId: string) => void;
}

export function EnhancedCompanyOnboarding({ open, onOpenChange, onComplete }: EnhancedCompanyOnboardingProps) {
  const [currentStep, setCurrentStep] = useState<StepKey>('company');
  const [isCreating, setIsCreating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Form state
  const [company, setCompany] = useState<CompanyData>({
    name: '',
    website: '',
    phone: '',
    email: '',
    license_number: '',
  });

  const [branding, setBranding] = useState<BrandingData>({
    logo_url: null,
    primary_color: '#16a34a',
    secondary_color: '#ca8a04',
  });

  const [locations, setLocations] = useState<OnboardingLocation[]>([
    { name: 'Main Office', address: '', verificationData: null }
  ]);

  const [adminUser, setAdminUser] = useState<OnboardingAdminUser>({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    password_confirm: '',
    role: 'office_admin',
    title: 'Administrator',
  });

  const [settings, setSettings] = useState<OnboardingSettings>({
    timezone: 'America/Chicago',
    features_enabled: ['crm', 'estimates', 'calendar', 'pipeline'],
    auto_assign_leads: false,
    notifications_enabled: true,
  });

  const currentStepIndex = STEPS.findIndex(s => s.key === currentStep);

  const goToStep = (step: StepKey) => {
    const targetIndex = STEPS.findIndex(s => s.key === step);
    if (targetIndex <= currentStepIndex) {
      setCurrentStep(step);
    }
  };

  const nextStep = () => {
    if (currentStepIndex < STEPS.length - 1) {
      setCurrentStep(STEPS[currentStepIndex + 1].key);
    }
  };

  const prevStep = () => {
    if (currentStepIndex > 0) {
      setCurrentStep(STEPS[currentStepIndex - 1].key);
    }
  };

  const addLocation = () => {
    if (locations.length < 10) {
      setLocations([...locations, { name: '', address: '', verificationData: null }]);
    }
  };

  const removeLocation = (index: number) => {
    if (locations.length > 1) {
      setLocations(locations.filter((_, i) => i !== index));
    }
  };

  const updateLocation = (index: number, field: keyof OnboardingLocation, value: any) => {
    const updated = [...locations];
    updated[index] = { ...updated[index], [field]: value };
    setLocations(updated);
  };

  const toggleFeature = (feature: string) => {
    if (settings.features_enabled.includes(feature)) {
      setSettings({
        ...settings,
        features_enabled: settings.features_enabled.filter(f => f !== feature)
      });
    } else {
      setSettings({
        ...settings,
        features_enabled: [...settings.features_enabled, feature]
      });
    }
  };

  const validatePassword = (password: string) => {
    const errors: string[] = [];
    if (password.length < 8) errors.push('At least 8 characters');
    if (!/[A-Z]/.test(password)) errors.push('One uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('One lowercase letter');
    if (!/[0-9]/.test(password)) errors.push('One number');
    return errors;
  };

  const canProceed = () => {
    switch (currentStep) {
      case 'company':
        return company.name.trim().length > 0;
      case 'branding':
        return true; // Optional step
      case 'locations':
        return locations.every(loc => loc.name.trim().length > 0);
      case 'team':
        return (
          adminUser.first_name.trim().length > 0 &&
          adminUser.last_name.trim().length > 0 &&
          adminUser.email.includes('@') &&
          adminUser.password.length >= 8 &&
          adminUser.password === adminUser.password_confirm &&
          validatePassword(adminUser.password).length === 0
        );
      case 'settings':
        return settings.features_enabled.length > 0;
      case 'review':
        return true;
      default:
        return false;
    }
  };

  const handleCreateCompany = async () => {
    setIsCreating(true);

    try {
      // 1. Create tenant
      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .insert({
          name: company.name,
          subdomain: company.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          logo_url: branding.logo_url,
          primary_color: branding.primary_color,
          secondary_color: branding.secondary_color,
          phone: company.phone || null,
          email: company.email || null,
          website: company.website || null,
          license_number: company.license_number || null,
          settings: {
            timezone: settings.timezone,
            features_enabled: settings.features_enabled,
            auto_assign_leads: settings.auto_assign_leads,
            notifications_enabled: settings.notifications_enabled,
          },
        })
        .select()
        .single();

      if (tenantError) throw tenantError;

      const tenantId = tenant.id;

      // 2. Create locations
      for (const loc of locations) {
        const locationData: any = {
          tenant_id: tenantId,
          name: loc.name,
          is_primary: locations.indexOf(loc) === 0,
        };

        if (loc.verificationData) {
          locationData.address_street = loc.verificationData.streetNumber && loc.verificationData.route 
            ? `${loc.verificationData.streetNumber} ${loc.verificationData.route}`
            : loc.address;
          locationData.address_city = loc.verificationData.city || '';
          locationData.address_state = loc.verificationData.state || '';
          locationData.address_zip = loc.verificationData.postalCode || '';
          locationData.latitude = loc.verificationData.latitude;
          locationData.longitude = loc.verificationData.longitude;
          locationData.verified_address = loc.verificationData;
        }

        await supabase.from('locations').insert(locationData);
      }

      // 3. Create admin user via edge function
      const { data: userData, error: userError } = await supabase.functions.invoke('admin-create-user', {
        body: {
          email: adminUser.email,
          password: adminUser.password,
          first_name: adminUser.first_name,
          last_name: adminUser.last_name,
          role: adminUser.role,
          title: adminUser.title,
          tenant_id: tenantId,
        }
      });

      if (userError) {
        console.error('User creation error:', userError);
        // Continue even if user creation fails - company is created
      }

      // 4. Initialize CRM skeleton
      const { error: initError } = await supabase.functions.invoke('initialize-company', {
        body: {
          tenant_id: tenantId,
          created_by: userData?.user?.id || null,
        }
      });

      if (initError) {
        console.error('Initialization error:', initError);
      }

      toast({
        title: 'Company created successfully!',
        description: `${company.name} has been set up with ${locations.length} location(s) and CRM initialized.`,
      });

      onOpenChange(false);
      onComplete?.(tenantId);

      // Reset form
      setCurrentStep('company');
      setCompany({ name: '', website: '', phone: '', email: '', license_number: '' });
      setBranding({ logo_url: null, primary_color: '#16a34a', secondary_color: '#ca8a04' });
      setLocations([{ name: 'Main Office', address: '', verificationData: null }]);
      setAdminUser({ first_name: '', last_name: '', email: '', password: '', password_confirm: '', role: 'office_admin', title: 'Administrator' });
      setSettings({ timezone: 'America/Chicago', features_enabled: ['crm', 'estimates', 'calendar', 'pipeline'], auto_assign_leads: false, notifications_enabled: true });

    } catch (error: any) {
      console.error('Company creation error:', error);
      toast({
        title: 'Creation failed',
        description: error.message || 'Failed to create company',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 'company':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company-name">Company Name *</Label>
              <Input
                id="company-name"
                placeholder="ABC Roofing & Restoration"
                value={company.name}
                onChange={(e) => setCompany({ ...company, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="company-phone">Phone</Label>
                <Input
                  id="company-phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={company.phone}
                  onChange={(e) => setCompany({ ...company, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-email">Email</Label>
                <Input
                  id="company-email"
                  type="email"
                  placeholder="info@company.com"
                  value={company.email}
                  onChange={(e) => setCompany({ ...company, email: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-website">Website</Label>
              <Input
                id="company-website"
                placeholder="www.company.com"
                value={company.website}
                onChange={(e) => setCompany({ ...company, website: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-license">License Number</Label>
              <Input
                id="company-license"
                placeholder="CCC123456"
                value={company.license_number}
                onChange={(e) => setCompany({ ...company, license_number: e.target.value })}
              />
            </div>
          </div>
        );

      case 'branding':
        return (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label>Company Logo</Label>
              <LogoUploader
                logoUrl={branding.logo_url}
                onLogoUploaded={(url) => setBranding({ ...branding, logo_url: url })}
                onLogoRemoved={() => setBranding({ ...branding, logo_url: null })}
              />
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="primary-color">Primary Color</Label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    id="primary-color"
                    value={branding.primary_color}
                    onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })}
                    className="h-10 w-14 rounded border cursor-pointer"
                  />
                  <Input
                    value={branding.primary_color}
                    onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })}
                    className="flex-1"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="secondary-color">Secondary Color</Label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    id="secondary-color"
                    value={branding.secondary_color}
                    onChange={(e) => setBranding({ ...branding, secondary_color: e.target.value })}
                    className="h-10 w-14 rounded border cursor-pointer"
                  />
                  <Input
                    value={branding.secondary_color}
                    onChange={(e) => setBranding({ ...branding, secondary_color: e.target.value })}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>
            <div className="p-4 rounded-lg border bg-card">
              <p className="text-sm text-muted-foreground mb-2">Preview</p>
              <div className="flex items-center gap-3">
                {branding.logo_url && (
                  <img src={branding.logo_url} alt="Logo" className="h-10 w-10 object-contain rounded" />
                )}
                <span className="font-semibold" style={{ color: branding.primary_color }}>
                  {company.name || 'Company Name'}
                </span>
                <Badge style={{ backgroundColor: branding.secondary_color, color: 'white' }}>
                  Sample Badge
                </Badge>
              </div>
            </div>
          </div>
        );

      case 'locations':
        return (
          <div className="space-y-4">
            {locations.map((loc, index) => (
              <Card key={index}>
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Location {index + 1}</Label>
                    {locations.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLocation(index)}
                        className="text-destructive hover:text-destructive"
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <Input
                    placeholder="Location Name (e.g., Main Office, Tampa Branch)"
                    value={loc.name}
                    onChange={(e) => updateLocation(index, 'name', e.target.value)}
                  />
                  <AddressValidation
                    label="Address"
                    placeholder="Start typing address..."
                    onAddressSelected={(structuredAddress) => {
                      updateLocation(index, 'address', structuredAddress?.formatted_address || '');
                      updateLocation(index, 'verificationData', structuredAddress);
                    }}
                  />
                  {loc.verificationData && (
                    <Badge variant="outline" className="text-green-600 border-green-600">
                      <Check className="h-3 w-3 mr-1" />
                      Address Verified
                    </Badge>
                  )}
                </CardContent>
              </Card>
            ))}
            {locations.length < 10 && (
              <Button variant="outline" onClick={addLocation} className="w-full">
                <MapPin className="h-4 w-4 mr-2" />
                Add Another Location
              </Button>
            )}
          </div>
        );

      case 'team':
        const passwordErrors = validatePassword(adminUser.password);
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Create the initial administrator account for this company.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="admin-first">First Name *</Label>
                <Input
                  id="admin-first"
                  placeholder="John"
                  value={adminUser.first_name}
                  onChange={(e) => setAdminUser({ ...adminUser, first_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-last">Last Name *</Label>
                <Input
                  id="admin-last"
                  placeholder="Smith"
                  value={adminUser.last_name}
                  onChange={(e) => setAdminUser({ ...adminUser, last_name: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-email">Email *</Label>
              <Input
                id="admin-email"
                type="email"
                placeholder="admin@company.com"
                value={adminUser.email}
                onChange={(e) => setAdminUser({ ...adminUser, email: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="admin-role">Role</Label>
                <Select
                  value={adminUser.role}
                  onValueChange={(value) => setAdminUser({ ...adminUser, role: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="office_admin">Office Admin</SelectItem>
                    <SelectItem value="regional_manager">Regional Manager</SelectItem>
                    <SelectItem value="sales_manager">Sales Manager</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-title">Title</Label>
                <Input
                  id="admin-title"
                  placeholder="Administrator"
                  value={adminUser.title}
                  onChange={(e) => setAdminUser({ ...adminUser, title: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-password">Password *</Label>
              <div className="relative">
                <Input
                  id="admin-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={adminUser.password}
                  onChange={(e) => setAdminUser({ ...adminUser, password: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {adminUser.password && passwordErrors.length > 0 && (
                <div className="text-xs text-destructive space-y-1">
                  {passwordErrors.map((err, i) => (
                    <p key={i}>• {err}</p>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-password-confirm">Confirm Password *</Label>
              <Input
                id="admin-password-confirm"
                type="password"
                placeholder="••••••••"
                value={adminUser.password_confirm}
                onChange={(e) => setAdminUser({ ...adminUser, password_confirm: e.target.value })}
              />
              {adminUser.password_confirm && adminUser.password !== adminUser.password_confirm && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
            </div>
          </div>
        );

      case 'settings':
        return (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Select
                value={settings.timezone}
                onValueChange={(value) => setSettings({ ...settings, timezone: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-3">
              <Label>Features to Enable</Label>
              <div className="grid grid-cols-2 gap-3">
                {FEATURES.map((feature) => (
                  <div
                    key={feature.key}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                      settings.features_enabled.includes(feature.key)
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    )}
                    onClick={() => toggleFeature(feature.key)}
                  >
                    <Switch
                      checked={settings.features_enabled.includes(feature.key)}
                      onCheckedChange={() => toggleFeature(feature.key)}
                    />
                    <span className="text-sm">{feature.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Auto-assign Leads</Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically assign new leads to available reps
                  </p>
                </div>
                <Switch
                  checked={settings.auto_assign_leads}
                  onCheckedChange={(checked) => setSettings({ ...settings, auto_assign_leads: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Enable Notifications</Label>
                  <p className="text-xs text-muted-foreground">
                    Send email/SMS notifications for important events
                  </p>
                </div>
                <Switch
                  checked={settings.notifications_enabled}
                  onCheckedChange={(checked) => setSettings({ ...settings, notifications_enabled: checked })}
                />
              </div>
            </div>
          </div>
        );

      case 'review':
        return (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Company Info
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-1">
                  <p><strong>Name:</strong> {company.name}</p>
                  {company.phone && <p><strong>Phone:</strong> {company.phone}</p>}
                  {company.email && <p><strong>Email:</strong> {company.email}</p>}
                  {company.website && <p><strong>Website:</strong> {company.website}</p>}
                  {company.license_number && <p><strong>License:</strong> {company.license_number}</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Palette className="h-4 w-4" />
                    Branding
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    {branding.logo_url ? (
                      <img src={branding.logo_url} alt="Logo" className="h-12 w-12 object-contain rounded border" />
                    ) : (
                      <div className="h-12 w-12 rounded border bg-muted flex items-center justify-center text-xs text-muted-foreground">
                        No logo
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded" style={{ backgroundColor: branding.primary_color }} />
                      <span className="text-xs text-muted-foreground">Primary</span>
                      <div className="w-6 h-6 rounded ml-2" style={{ backgroundColor: branding.secondary_color }} />
                      <span className="text-xs text-muted-foreground">Secondary</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Locations ({locations.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-2">
                  {locations.map((loc, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span>{loc.name}</span>
                      {loc.verificationData && (
                        <Badge variant="outline" className="text-green-600 text-xs">Verified</Badge>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Admin User
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-1">
                  <p><strong>Name:</strong> {adminUser.first_name} {adminUser.last_name}</p>
                  <p><strong>Email:</strong> {adminUser.email}</p>
                  <p><strong>Role:</strong> {adminUser.role}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-2">
                  <p><strong>Timezone:</strong> {TIMEZONES.find(t => t.value === settings.timezone)?.label}</p>
                  <div className="flex flex-wrap gap-1">
                    {settings.features_enabled.map((f) => (
                      <Badge key={f} variant="secondary" className="text-xs">
                        {FEATURES.find(feat => feat.key === f)?.label}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Create New Company</DialogTitle>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center justify-between mb-6 px-2">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            const isCompleted = index < currentStepIndex;
            const isCurrent = index === currentStepIndex;

            return (
              <div key={step.key} className="flex items-center">
                <button
                  onClick={() => goToStep(step.key)}
                  disabled={index > currentStepIndex}
                  className={cn(
                    "flex flex-col items-center gap-1 transition-all",
                    index > currentStepIndex && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center justify-center h-10 w-10 rounded-full border-2 transition-all",
                      isCompleted && "bg-green-500 border-green-500 text-white",
                      isCurrent && "bg-primary border-primary text-primary-foreground",
                      !isCompleted && !isCurrent && "border-muted-foreground/30 text-muted-foreground"
                    )}
                  >
                    {isCompleted ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                  </div>
                  <span className={cn(
                    "text-xs",
                    isCurrent ? "text-primary font-medium" : "text-muted-foreground"
                  )}>
                    {step.label}
                  </span>
                </button>
                {index < STEPS.length - 1 && (
                  <div className={cn(
                    "h-0.5 w-8 mx-1 mt-[-20px]",
                    index < currentStepIndex ? "bg-green-500" : "bg-muted-foreground/30"
                  )} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step Content */}
        <div className="min-h-[300px]">
          {renderStepContent()}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between pt-4 border-t">
          <Button
            variant="outline"
            onClick={prevStep}
            disabled={currentStepIndex === 0}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>

          {currentStep === 'review' ? (
            <Button onClick={handleCreateCompany} disabled={isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Create Company
                </>
              )}
            </Button>
          ) : (
            <Button onClick={nextStep} disabled={!canProceed()}>
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
