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
  FileText
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useSearchParams } from 'react-router-dom';
import { LocationManagement } from '@/components/settings/LocationManagement';
import { WebsitePreview } from '@/components/settings/WebsitePreview';
import { activityTracker } from '@/services/activityTracker';

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
  const { toast } = useToast();
  const [searchParams] = useSearchParams();

  // Multi-location state
  const [locationCount, setLocationCount] = useState('1');
  const [locationNames, setLocationNames] = useState<string[]>(['']);
  const [websiteData, setWebsiteData] = useState<WebsiteData | null>(null);

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
    const validLocationNames = locationNames.filter(n => n.trim());
    
    if (!formData.name.trim()) {
      toast({
        title: "Validation Error",
        description: "Company name is required",
        variant: "destructive",
      });
      return;
    }
    
    if (validLocationNames.length === 0) {
      toast({
        title: "Validation Error",
        description: "At least one location name is required",
        variant: "destructive",
      });
      return;
    }

    try {
      // Auto-generate subdomain from company name
      const subdomain = formData.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

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

      if (tenantError) throw tenantError;

      // Create all locations
      const locationInserts = validLocationNames.map(name => ({
        tenant_id: tenant.id,
        name: name.trim(),
        is_active: true,
      }));
      
      await supabase.from('locations').insert(locationInserts);

      // Grant current user access
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await (supabase as any).from('user_company_access').insert({
          user_id: user.id,
          tenant_id: tenant.id,
          access_level: 'full',
          granted_by: user.id,
        });
      }

      // Track activity
      activityTracker.trackDataChange('tenants', 'create', tenant.id);

      toast({ title: `Company created with ${validLocationNames.length} location(s)` });
      resetForm();
      setCreateDialogOpen(false);
      fetchCompanies();
    } catch (error: any) {
      toast({
        title: "Error Creating Company",
        description: error.message,
        variant: "destructive",
      });
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
    });
    setLocationCount('1');
    setLocationNames(['']);
    setWebsiteData(null);
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
              Manage all companies, subscriptions, and access permissions
            </p>
          </div>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Company
          </Button>
        </div>

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
                <div className="space-y-2 text-sm text-muted-foreground">
                  {company.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-3 w-3" />
                      {company.phone}
                    </div>
                  )}
                  {company.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="h-3 w-3" />
                      {company.email}
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
                <Input
                  placeholder="Street Address"
                  value={formData.address_street}
                  onChange={(e) => setFormData({ ...formData, address_street: e.target.value })}
                  className="mb-2"
                />
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    placeholder="City"
                    value={formData.address_city}
                    onChange={(e) => setFormData({ ...formData, address_city: e.target.value })}
                  />
                  <Input
                    placeholder="State"
                    value={formData.address_state}
                    onChange={(e) => setFormData({ ...formData, address_state: e.target.value })}
                  />
                  <Input
                    placeholder="ZIP"
                    value={formData.address_zip}
                    onChange={(e) => setFormData({ ...formData, address_zip: e.target.value })}
                  />
                </div>
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
              <Button variant="outline" onClick={() => { resetForm(); setCreateDialogOpen(false); }}>
                Cancel
              </Button>
              <Button onClick={handleCreateCompany}>
                Create Company
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
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="profile">Profile</TabsTrigger>
                  <TabsTrigger value="locations">Locations</TabsTrigger>
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
                      <div className="flex items-center gap-4">
                        <div className="h-20 w-20 rounded-lg border-2 border-dashed border-muted-foreground/25 flex items-center justify-center bg-muted">
                          {selectedCompany.logo_url ? (
                            <img src={selectedCompany.logo_url} alt="" className="h-16 w-16 object-contain" />
                          ) : (
                            <Upload className="h-8 w-8 text-muted-foreground" />
                          )}
                        </div>
                        <Button variant="outline" size="sm">
                          <Upload className="h-4 w-4 mr-2" />
                          Upload Logo
                        </Button>
                      </div>
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

                  {/* Owner Info */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Owner Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>Owner Name</Label>
                        <Input
                          value={formData.owner_name}
                          onChange={(e) => setFormData({ ...formData, owner_name: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Owner Email</Label>
                          <Input
                            type="email"
                            value={formData.owner_email}
                            onChange={(e) => setFormData({ ...formData, owner_email: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Owner Phone</Label>
                          <Input
                            value={formData.owner_phone}
                            onChange={(e) => setFormData({ ...formData, owner_phone: e.target.value })}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Billing Address */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Billing Address</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <Input
                        placeholder="Street Address"
                        value={formData.address_street}
                        onChange={(e) => setFormData({ ...formData, address_street: e.target.value })}
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <Input
                          placeholder="City"
                          value={formData.address_city}
                          onChange={(e) => setFormData({ ...formData, address_city: e.target.value })}
                        />
                        <Input
                          placeholder="State"
                          value={formData.address_state}
                          onChange={(e) => setFormData({ ...formData, address_state: e.target.value })}
                        />
                        <Input
                          placeholder="ZIP"
                          value={formData.address_zip}
                          onChange={(e) => setFormData({ ...formData, address_zip: e.target.value })}
                        />
                      </div>
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
                </TabsContent>
              </Tabs>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </GlobalLayout>
  );
};

export default CompanyAdminPage;