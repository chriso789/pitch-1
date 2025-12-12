import React, { useState, useEffect } from 'react';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { 
  Building2, 
  Plus, 
  Search, 
  MapPin, 
  Users, 
  Settings,
  CreditCard,
  Upload,
  Check,
  X,
  ExternalLink,
  Phone,
  Mail,
  Globe,
  FileText,
  Loader2,
  AlertTriangle,
  Trash2,
  Send,
  UserCheck,
  ToggleRight
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useSearchParams } from 'react-router-dom';
import { LocationManagement } from '@/components/settings/LocationManagement';
import { WebsitePreview } from '@/components/settings/WebsitePreview';
import { AddressValidation } from '@/shared/components/forms/AddressValidation';
import { LogoUploader } from '@/components/settings/LogoUploader';
import { EmailTemplateManager } from '@/components/settings/EmailTemplateManager';
import { activityTracker } from '@/services/activityTracker';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { DemoRequestsPanel } from '@/components/settings/DemoRequestsPanel';
import { CompanyFeatureControl } from '@/components/admin/CompanyFeatureControl';

interface Company {
  id: string;
  name: string;
  subdomain: string | null;
  is_active: boolean;
  created_at: string;
  logo_url?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  license_number?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  owner_phone?: string | null;
  subscription_tier?: string | null;
  subscription_status?: string | null;
  features_enabled?: string[] | null;
  settings?: any;
}

interface WebsiteData {
  verified: boolean;
  url?: string;
  domain?: string;
  title?: string;
  favicon?: string;
  description?: string;
  error?: string;
}

const CompanyAdminPage = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [seedingOwners, setSeedingOwners] = useState(false);
  const { toast } = useToast();
  const { user: currentUser } = useCurrentUser();
  const [searchParams] = useSearchParams();

  // Multi-location state
  const [locationCount, setLocationCount] = useState('1');
  const [locationNames, setLocationNames] = useState<string[]>(['']);
  const [websiteData, setWebsiteData] = useState<WebsiteData | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [billingAddressData, setBillingAddressData] = useState<any>(null);
  const [isSendingOnboarding, setIsSendingOnboarding] = useState(false);

  // Form state (removed subdomain)
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    website: '',
    address_street: '',
    address_city: '',
    address_state: '',
    address_zip: '',
    license_number: '',
    owner_name: '',
    owner_email: '',
    owner_phone: '',
    subscription_tier: 'starter',
    logo_url: '',
  });

  // Update location names array when count changes
  useEffect(() => {
    const count = parseInt(locationCount);
    setLocationNames(prev => {
      const newNames = [...prev];
      while (newNames.length < count) {
        newNames.push('');
      }
      return newNames.slice(0, count);
    });
  }, [locationCount]);

  useEffect(() => {
    fetchCompanies();
    // Check if we should open create dialog
    if (searchParams.get('action') === 'create') {
      setCreateDialogOpen(true);
    }
  }, [searchParams]);

  const fetchCompanies = async () => {
    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .eq('is_active', true)  // Only show active companies (soft-deleted companies are filtered out)
        .order('name');

      if (error) throw error;
      setCompanies((data as Company[]) || []);
    } catch (error: any) {
      toast({
        title: "Error Loading Companies",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCompany = async () => {
    if (!formData.name.trim()) {
      toast({
        title: "Validation Error",
        description: "Company name is required",
        variant: "destructive",
      });
      return;
    }

    // Auto-create default location if none provided
    const validLocationNames = locationNames.filter(n => n.trim());
    const locationsToCreate = validLocationNames.length > 0 ? validLocationNames : ['Main Office'];

    setIsCreating(true);
    
    // Timeout protection - 30 seconds max
    const timeoutId = setTimeout(() => {
      console.error('[CompanyAdmin] Operation timed out after 30 seconds');
      setIsCreating(false);
      toast({
        title: "Operation Timed Out",
        description: "Company creation is taking too long. Please try again.",
        variant: "destructive",
      });
    }, 30000);

    try {
      // Auto-generate subdomain from company name
      const subdomain = formData.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
      console.log('[CompanyAdmin] Creating company:', { name: formData.name, subdomain, locations: locationsToCreate });

      // Check if subdomain already exists
      const { data: existingTenant, error: checkError } = await supabase
        .from('tenants')
        .select('id')
        .eq('subdomain', subdomain)
        .maybeSingle();

      if (checkError) {
        console.error('[CompanyAdmin] Error checking subdomain:', checkError);
        throw checkError;
      }

      if (existingTenant) {
        console.warn('[CompanyAdmin] Subdomain already exists:', subdomain);
        clearTimeout(timeoutId);
        setIsCreating(false);
        toast({
          title: "Subdomain Already Exists",
          description: `A company with subdomain "${subdomain}" already exists. Please use a different company name.`,
          variant: "destructive",
        });
        return;
      }

      console.log('[CompanyAdmin] Inserting tenant...');
      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .insert({
          name: formData.name.trim(),
          subdomain: subdomain,
          is_active: true,
          phone: formData.phone || null,
          email: formData.email || null,
          website: formData.website || null,
          website_verified: websiteData?.verified || false,
          website_metadata: websiteData ? {
            title: websiteData.title,
            favicon: websiteData.favicon,
            domain: websiteData.domain,
            description: websiteData.description,
          } : null,
          address_street: formData.address_street || null,
          address_city: formData.address_city || null,
          address_state: formData.address_state || null,
          address_zip: formData.address_zip || null,
          license_number: formData.license_number || null,
        })
        .select()
        .single();

      if (tenantError) {
        console.error('[CompanyAdmin] Tenant insert error:', tenantError);
        // Check for RLS policy error
        if (tenantError.message.includes('row-level security') || tenantError.code === '42501') {
          throw new Error('Permission denied. You do not have permission to create companies. Please contact an administrator.');
        }
        throw tenantError;
      }
      console.log('[CompanyAdmin] Tenant created:', tenant.id);

      // Create all locations (uses locationsToCreate which defaults to 'Main Office')
      console.log('[CompanyAdmin] Creating locations...');
      const locationInserts = locationsToCreate.map(name => ({
        tenant_id: tenant.id,
        name: name.trim(),
        is_active: true,
      }));
      
      const { error: locationsError } = await supabase.from('locations').insert(locationInserts);
      if (locationsError) {
        console.error('[CompanyAdmin] Error creating locations:', locationsError);
      } else {
        console.log('[CompanyAdmin] Locations created:', locationsToCreate.length);
      }

      // Grant current user access
      console.log('[CompanyAdmin] Granting user access...');
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { error: accessError } = await (supabase as any).from('user_company_access').insert({
          user_id: user.id,
          tenant_id: tenant.id,
          access_level: 'full',
          granted_by: user.id,
        });
        if (accessError) {
          console.error('[CompanyAdmin] Error granting access:', accessError);
        } else {
          console.log('[CompanyAdmin] User access granted');
        }
      }

      // Initialize CRM skeleton with timeout to prevent hanging
      console.log('[CompanyAdmin] Initializing CRM skeleton for tenant:', tenant.id);
      try {
        const initPromise = supabase.functions.invoke('initialize-company', {
          body: { 
            tenant_id: tenant.id,
            created_by: user?.id 
          }
        });
        const initTimeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Initialization timeout')), 10000)
        );
        const { data: initResult, error: initError } = await Promise.race([initPromise, initTimeoutPromise]) as any;

        if (initError) {
          console.error('[CompanyAdmin] Error initializing company:', initError);
        } else {
          console.log('[CompanyAdmin] Company initialization result:', initResult);
        }
      } catch (timeoutErr) {
        console.warn('[CompanyAdmin] CRM initialization timed out, company created but skeleton may be incomplete');
      }

      // Track activity
      activityTracker.trackDataChange('tenants', 'create', tenant.id);

      clearTimeout(timeoutId);
      
      toast({ 
        title: "Company Created Successfully",
        description: `${formData.name} created with ${locationsToCreate.length} location(s).`
      });
      resetForm();
      setCreateDialogOpen(false);
      fetchCompanies();
    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error('[CompanyAdmin] Error creating company:', error);
      toast({
        title: "Error Creating Company",
        description: error.message || error.code || 'Unknown error occurred. Check console for details.',
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateCompany = async () => {
    if (!selectedCompany) return;

    try {
      const { error } = await supabase
        .from('tenants')
        .update({
          name: formData.name,
          phone: formData.phone || null,
          email: formData.email || null,
          website: formData.website || null,
          address_street: formData.address_street || null,
          address_city: formData.address_city || null,
          address_state: formData.address_state || null,
          address_zip: formData.address_zip || null,
          license_number: formData.license_number || null,
          owner_name: formData.owner_name || null,
          owner_email: formData.owner_email || null,
          owner_phone: formData.owner_phone || null,
          subscription_tier: formData.subscription_tier || 'starter',
          logo_url: formData.logo_url || null,
        })
        .eq('id', selectedCompany.id);

      if (error) throw error;

      toast({ title: "Company updated successfully" });
      setEditDialogOpen(false);
      fetchCompanies();
    } catch (error: any) {
      toast({
        title: "Error Updating Company",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const toggleCompanyStatus = async (company: Company) => {
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ is_active: !company.is_active })
        .eq('id', company.id);

      if (error) throw error;
      toast({ title: `Company ${company.is_active ? 'deactivated' : 'activated'}` });
      fetchCompanies();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const openEditDialog = (company: Company) => {
    setSelectedCompany(company);
    setFormData({
      name: company.name || '',
      phone: company.phone || '',
      email: company.email || '',
      website: company.website || '',
      address_street: company.address_street || '',
      address_city: company.address_city || '',
      address_state: company.address_state || '',
      address_zip: company.address_zip || '',
      license_number: company.license_number || '',
      owner_name: company.owner_name || '',
      owner_email: company.owner_email || '',
      owner_phone: company.owner_phone || '',
      subscription_tier: company.subscription_tier || 'starter',
      logo_url: company.logo_url || '',
    });
    setEditDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      phone: '',
      email: '',
      website: '',
      address_street: '',
      address_city: '',
      address_state: '',
      address_zip: '',
      license_number: '',
      owner_name: '',
      owner_email: '',
      owner_phone: '',
      subscription_tier: 'starter',
      logo_url: '',
    });
    setLocationCount('1');
    setLocationNames(['']);
    setWebsiteData(null);
    setBillingAddressData(null);
  };

  const handleDeleteCompany = async () => {
    if (!selectedCompany || deleteConfirmation !== selectedCompany.name) return;
    
    setIsDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-company', {
        body: { 
          company_id: selectedCompany.id,
          company_name: selectedCompany.name 
        }
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      toast({
        title: "Company Deleted",
        description: `${selectedCompany.name} has been deleted. Backup created and stored.`,
      });
      
      setDeleteDialogOpen(false);
      setEditDialogOpen(false);
      fetchCompanies();
    } catch (error: any) {
      toast({
        title: "Deletion Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setDeleteConfirmation('');
    }
  };

  const handleLocationNameChange = (index: number, value: string) => {
    setLocationNames(prev => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  };

  const filteredCompanies = companies.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.subdomain?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const seedCompanyOwners = async () => {
    setSeedingOwners(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Not authenticated", variant: "destructive" });
        return;
      }

      const { data, error } = await supabase.functions.invoke('seed-company-owners', {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });

      if (error) throw error;

      toast({
        title: "Owners Seeded Successfully",
        description: `Created ${data?.created?.length || 0} owner profiles.`,
      });
      
      console.log('[SeedOwners] Results:', data);
    } catch (error: any) {
      console.error('[SeedOwners] Error:', error);
      toast({
        title: "Error Seeding Owners",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSeedingOwners(false);
    }
  };

  const stats = {
    total: companies.length,
    active: companies.filter(c => c.is_active).length,
    inactive: companies.filter(c => !c.is_active).length,
  };

  return (
    <GlobalLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Building2 className="h-8 w-8 text-primary" />
              Company Administration
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage companies, demo requests, and feature access
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline"
              onClick={seedCompanyOwners}
              disabled={seedingOwners}
            >
              <Users className="h-4 w-4 mr-2" />
              {seedingOwners ? "Creating Owners..." : "Seed Missing Owners"}
            </Button>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Company
            </Button>
          </div>
        </div>

        {/* Main Tabs */}
        <Tabs defaultValue="companies" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="companies" className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Companies
            </TabsTrigger>
            <TabsTrigger value="demos" className="flex items-center gap-2">
              <UserCheck className="h-4 w-4" />
              Demo Requests
            </TabsTrigger>
            <TabsTrigger value="features" className="flex items-center gap-2">
              <ToggleRight className="h-4 w-4" />
              Feature Control
            </TabsTrigger>
          </TabsList>

          {/* Companies Tab */}
          <TabsContent value="companies" className="space-y-6">
            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Total Companies</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.total}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-green-600">Active</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">{stats.active}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Inactive</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-muted-foreground">{stats.inactive}</div>
                </CardContent>
              </Card>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search companies..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Companies Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredCompanies.map((company) => (
            <Card 
              key={company.id} 
              className={`cursor-pointer hover:shadow-lg transition-shadow ${!company.is_active ? 'opacity-60' : ''}`}
              onClick={() => openEditDialog(company)}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                    {company.logo_url ? (
                      <img src={company.logo_url} alt="" className="h-8 w-8 object-contain" />
                    ) : (
                      <Building2 className="h-6 w-6 text-primary" />
                    )}
                  </div>
                  <Badge variant={company.is_active ? "default" : "secondary"}>
                    {company.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <CardTitle className="text-lg mt-2">{company.name}</CardTitle>
                <CardDescription>{company.subdomain}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm text-muted-foreground overflow-hidden">
                  {company.phone && (
                    <div className="flex items-center gap-2 overflow-hidden">
                      <Phone className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{company.phone}</span>
                    </div>
                  )}
                  {company.email && (
                    <div className="flex items-center gap-2 overflow-hidden">
                      <Mail className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{company.email}</span>
                    </div>
                  )}
                  {company.subscription_tier && (
                    <Badge variant="outline" className="mt-2">
                      <CreditCard className="h-3 w-3 mr-1" />
                      {company.subscription_tier}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

            {filteredCompanies.length === 0 && !loading && (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-10">
                  <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No companies found</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Demo Requests Tab */}
          <TabsContent value="demos">
            <DemoRequestsPanel />
          </TabsContent>

          {/* Feature Control Tab */}
          <TabsContent value="features">
            <CompanyFeatureControl />
          </TabsContent>
        </Tabs>

        {/* Create Company Dialog */}
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Company</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Company Name *</Label>
                <Input
                  placeholder="ABC Roofing Co."
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              {/* Website with live verification */}
              <div className="space-y-2">
                <Label>Website</Label>
                <Input
                  placeholder="www.company.com"
                  value={formData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                />
                <WebsitePreview 
                  url={formData.website} 
                  onVerified={setWebsiteData}
                />
              </div>

              {/* Number of Locations Dropdown */}
              <div className="space-y-2">
                <Label>Number of Locations *</Label>
                <Select value={locationCount} onValueChange={setLocationCount}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select number of locations" />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
                      <SelectItem key={num} value={num.toString()}>
                        {num} Location{num > 1 ? 's' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Dynamic Location Name Inputs */}
              <div className="space-y-2">
                <Label>Location Names *</Label>
                <div className="space-y-2">
                  {locationNames.map((name, index) => (
                    <Input
                      key={index}
                      placeholder={`Location ${index + 1} Name (e.g., Main Office, Tampa Branch)`}
                      value={name}
                      onChange={(e) => handleLocationNameChange(index, e.target.value)}
                    />
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input
                    placeholder="(555) 123-4567"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    placeholder="info@company.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Billing Address</Label>
                <AddressValidation
                  label=""
                  placeholder="Start typing billing address..."
                  onAddressSelected={(structuredAddress) => {
                    setBillingAddressData(structuredAddress);
                    if (structuredAddress) {
                      setFormData({
                        ...formData,
                        address_street: `${structuredAddress.street_number || ''} ${structuredAddress.route || ''}`.trim(),
                        address_city: structuredAddress.locality || '',
                        address_state: structuredAddress.administrative_area_level_1 || '',
                        address_zip: structuredAddress.postal_code || '',
                      });
                    }
                  }}
                />
                {billingAddressData && (
                  <Badge variant="outline" className="text-green-600 border-green-600">
                    <Check className="h-3 w-3 mr-1" />
                    Address Verified
                  </Badge>
                )}
              </div>

              <div className="space-y-2">
                <Label>License Number</Label>
                <Input
                  placeholder="CCC1234567"
                  value={formData.license_number}
                  onChange={(e) => setFormData({ ...formData, license_number: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => { resetForm(); setCreateDialogOpen(false); }}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button onClick={handleCreateCompany} disabled={isCreating}>
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating Company...
                  </>
                ) : (
                  'Create Company'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Company Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                {selectedCompany?.name}
              </DialogTitle>
            </DialogHeader>
            
            {selectedCompany && (
              <Tabs defaultValue="profile" className="w-full">
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="profile">Profile</TabsTrigger>
                  <TabsTrigger value="locations">Locations</TabsTrigger>
                  <TabsTrigger value="emails">Emails</TabsTrigger>
                  <TabsTrigger value="subscription">Subscription</TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>

                <TabsContent value="profile" className="space-y-4 mt-4">
                  {/* Logo Section */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Company Logo</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <LogoUploader
                        logoUrl={formData.logo_url || null}
                        onLogoUploaded={(url) => setFormData({ ...formData, logo_url: url })}
                        onLogoRemoved={() => setFormData({ ...formData, logo_url: '' })}
                      />
                    </CardContent>
                  </Card>

                  {/* Company Info */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Company Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Company Name</Label>
                          <Input
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>License Number</Label>
                          <Input
                            value={formData.license_number}
                            onChange={(e) => setFormData({ ...formData, license_number: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Phone</Label>
                          <Input
                            value={formData.phone}
                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Email</Label>
                          <Input
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Website</Label>
                        <Input
                          value={formData.website}
                          onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                        />
                      </div>
                    </CardContent>
                  </Card>

                  {/* Owner Info - IMPORTANT: Platform announcements go here */}
                  <Card className="border-primary/20 bg-primary/5">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Mail className="h-4 w-4 text-primary" />
                        Owner Information
                      </CardTitle>
                      <CardDescription className="text-primary/80">
                        Platform announcements and important updates will be sent to the owner email below
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>Owner Name</Label>
                        <Input
                          value={formData.owner_name}
                          onChange={(e) => setFormData({ ...formData, owner_name: e.target.value })}
                          placeholder="John Smith"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                          Owner Email
                          <Badge variant="secondary" className="text-xs">
                            📢 Receives Announcements
                          </Badge>
                        </Label>
                        <Input
                          type="email"
                          value={formData.owner_email}
                          onChange={(e) => setFormData({ ...formData, owner_email: e.target.value })}
                          placeholder="owner@company.com"
                          className="border-primary/30"
                        />
                        <p className="text-xs text-muted-foreground">
                          This email receives platform updates, new feature announcements, and important maintenance notices.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label>Owner Phone</Label>
                        <Input
                          value={formData.owner_phone}
                          onChange={(e) => setFormData({ ...formData, owner_phone: e.target.value })}
                          placeholder="(555) 123-4567"
                        />
                      </div>
                    </CardContent>
                  </Card>

                  {/* Billing Address - Google Verified */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Billing Address</CardTitle>
                      <CardDescription>Start typing to search and verify with Google</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <AddressValidation
                        label=""
                        placeholder="Start typing billing address..."
                        defaultValue={formData.address_street ? 
                          `${formData.address_street}, ${formData.address_city}, ${formData.address_state} ${formData.address_zip}` : ''}
                        onAddressSelected={(addr) => {
                          setFormData({
                            ...formData,
                            address_street: `${addr.street_number} ${addr.route}`.trim(),
                            address_city: addr.locality,
                            address_state: addr.administrative_area_level_1,
                            address_zip: addr.postal_code,
                          });
                          setBillingAddressData(addr);
                        }}
                      />
                      {billingAddressData?.validated && (
                        <Badge variant="outline" className="text-green-600 border-green-600">
                          <Check className="h-3 w-3 mr-1" />
                          Google Verified
                        </Badge>
                      )}
                    </CardContent>
                  </Card>

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleUpdateCompany}>
                      Save Changes
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="locations" className="mt-4">
                  <LocationManagement tenantId={selectedCompany.id} />
                </TabsContent>

                <TabsContent value="emails" className="space-y-4 mt-4">
                  {/* Send Onboarding Email Section */}
                  <Card className="border-primary/20">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Send className="h-4 w-4" />
                        Send Onboarding Email
                      </CardTitle>
                      <CardDescription>
                        Send the welcome and setup email to the company owner
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                        <div>
                          <p className="font-medium">{formData.owner_name || 'No owner set'}</p>
                          <p className="text-sm text-muted-foreground">
                            {formData.owner_email || 'No email configured'}
                          </p>
                        </div>
                        <Button 
                          onClick={async () => {
                            if (!selectedCompany) return;
                            
                            const ownerEmail = formData.owner_email || selectedCompany.owner_email;
                            const ownerName = formData.owner_name || selectedCompany.owner_name || 'Team';
                            
                            if (!ownerEmail) {
                              toast({
                                title: "Missing Owner Email",
                                description: "Please add an owner email address in the Profile tab first",
                                variant: "destructive"
                              });
                              return;
                            }

                            setIsSendingOnboarding(true);
                            try {
                              const { data, error } = await supabase.functions.invoke('send-company-onboarding', {
                                body: {
                                  tenant_id: selectedCompany.id,
                                  email: ownerEmail,
                                  first_name: ownerName.split(' ')[0] || 'Team',
                                  company_name: selectedCompany.name
                                }
                              });

                              if (error) throw error;

                              toast({
                                title: "Onboarding Email Sent!",
                                description: `Email sent to ${ownerEmail}`,
                              });
                            } catch (error: any) {
                              toast({
                                title: "Failed to Send",
                                description: error.message || 'An error occurred',
                                variant: "destructive"
                              });
                            } finally {
                              setIsSendingOnboarding(false);
                            }
                          }}
                          disabled={!formData.owner_email || isSendingOnboarding}
                        >
                          {isSendingOnboarding ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Sending...
                            </>
                          ) : (
                            <>
                              <Send className="h-4 w-4 mr-2" />
                              Send Onboarding Email
                            </>
                          )}
                        </Button>
                      </div>
                      {!formData.owner_email && (
                        <p className="text-xs text-amber-600 mt-2">
                          ⚠️ Add an owner email in the Profile tab to send onboarding emails
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  {/* Email Templates Section */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Email Templates</CardTitle>
                      <CardDescription>
                        Customize email templates used for platform communications
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <EmailTemplateManager />
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="subscription" className="space-y-4 mt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Subscription Status</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                        <div>
                          <p className="font-medium">Current Plan</p>
                          <p className="text-2xl font-bold text-primary">
                            {selectedCompany.subscription_tier || 'Starter'}
                          </p>
                        </div>
                        <Badge variant={selectedCompany.is_active ? "default" : "destructive"}>
                          {selectedCompany.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      
                      <div className="space-y-2">
                        <Label>Change Subscription Tier</Label>
                        <Select 
                          value={formData.subscription_tier}
                          onValueChange={(val) => setFormData({ ...formData, subscription_tier: val })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="starter">Starter</SelectItem>
                            <SelectItem value="pro">Pro</SelectItem>
                            <SelectItem value="enterprise">Enterprise</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex gap-2 pt-4">
                        <Button 
                          variant={selectedCompany.is_active ? "destructive" : "default"}
                          onClick={() => toggleCompanyStatus(selectedCompany)}
                        >
                          {selectedCompany.is_active ? (
                            <>
                              <X className="h-4 w-4 mr-2" />
                              Deactivate Company
                            </>
                          ) : (
                            <>
                              <Check className="h-4 w-4 mr-2" />
                              Activate Company
                            </>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="settings" className="space-y-4 mt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Feature Access</CardTitle>
                      <CardDescription>Control which features this company can access</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-muted-foreground text-center py-8">
                        Feature access management coming soon
                      </div>
                    </CardContent>
                  </Card>

                  {/* Company Status */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Company Status</CardTitle>
                      <CardDescription>Activate or deactivate this company</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between p-4 border rounded-lg">
                        <div>
                          <p className="font-medium">Current Status</p>
                          <p className="text-sm text-muted-foreground">
                            {selectedCompany.is_active 
                              ? 'This company is currently active and can use all features'
                              : 'This company is deactivated and cannot access the system'
                            }
                          </p>
                        </div>
                        <Badge variant={selectedCompany.is_active ? "default" : "secondary"}>
                          {selectedCompany.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <Button 
                        variant={selectedCompany.is_active ? "outline" : "default"}
                        className="mt-4"
                        onClick={() => toggleCompanyStatus(selectedCompany)}
                      >
                        {selectedCompany.is_active ? (
                          <>
                            <X className="h-4 w-4 mr-2" />
                            Deactivate Company
                          </>
                        ) : (
                          <>
                            <Check className="h-4 w-4 mr-2" />
                            Activate Company
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Danger Zone - Delete Company */}
                  <Card className="border-destructive/50">
                    <CardHeader>
                      <CardTitle className="text-base text-destructive flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" />
                        Danger Zone
                      </CardTitle>
                      <CardDescription>
                        Irreversible actions - proceed with extreme caution
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="p-4 border border-destructive/30 rounded-lg bg-destructive/5">
                        <p className="font-medium text-destructive">Delete this company</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Once deleted, all company data (contacts, projects, estimates, photos) 
                          will be permanently removed. A backup will be created and emailed before deletion.
                        </p>
                        <Button 
                          variant="destructive" 
                          className="mt-4"
                          onClick={() => setDeleteDialogOpen(true)}
                          disabled={currentUser?.role !== 'master'}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Company
                        </Button>
                        {currentUser?.role !== 'master' && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Only master administrators can delete companies
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-destructive flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Delete {selectedCompany?.name}?
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                This action cannot be undone. All data including:
              </p>
              <ul className="text-sm list-disc list-inside text-muted-foreground">
                <li>Contacts and leads</li>
                <li>Projects and estimates</li>
                <li>Photos and documents</li>
                <li>All user associations</li>
              </ul>
              <p className="text-sm font-medium">
                A backup will be created and stored before deletion.
              </p>
              <div className="space-y-2">
                <Label>Type "{selectedCompany?.name}" to confirm:</Label>
                <Input 
                  value={deleteConfirmation}
                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                  placeholder="Company name"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setDeleteDialogOpen(false);
                setDeleteConfirmation('');
              }}>
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleDeleteCompany}
                disabled={deleteConfirmation !== selectedCompany?.name || isDeleting}
              >
                {isDeleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                Delete Forever
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </GlobalLayout>
  );
};

export default CompanyAdminPage;