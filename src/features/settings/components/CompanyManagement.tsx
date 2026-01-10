import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, MapPin, Users, Plus, Info, Settings as SettingsIcon, Globe, Loader2, Image } from 'lucide-react';
import { LocationManagement } from '@/components/settings/LocationManagement';
import { WebsitePreview } from '@/components/settings/WebsitePreview';
import { LogoUploader } from '@/components/settings/LogoUploader';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';

interface Company {
  id: string;
  name: string;
  subdomain: string;
  website?: string;
  website_verified?: boolean;
  logo_url?: string;
  is_active: boolean;
  created_at: string;
  settings: any;
}

interface WebsiteData {
  verified: boolean;
  url?: string;
  domain?: string;
  title?: string;
  favicon?: string;
  description?: string;
}

export const CompanyManagement = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const { toast } = useToast();
  const { activeCompanyId, refetch: refetchCompanies } = useCompanySwitcher();

  // Form state for creating new company
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyWebsite, setNewCompanyWebsite] = useState('');
  const [websiteData, setWebsiteData] = useState<WebsiteData | null>(null);
  const [locationCount, setLocationCount] = useState('1');
  const [locationNames, setLocationNames] = useState<string[]>(['']);

  useEffect(() => {
    fetchCompanies();
  }, []);

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

  const fetchCompanies = async () => {
    try {
      const { data, error }: any = await supabase
        .from('tenants')
        .select('id, name, subdomain, website, website_verified, logo_url, is_active, created_at, settings')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setCompanies(data || []);
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

  const handleLocationNameChange = (index: number, value: string) => {
    setLocationNames(prev => {
      const newNames = [...prev];
      newNames[index] = value;
      return newNames;
    });
  };

  const handleCreateCompany = async () => {
    if (!newCompanyName.trim()) {
      toast({
        title: "Validation Error",
        description: "Company name is required",
        variant: "destructive",
      });
      return;
    }

    // Auto-create default location if none provided
    const validLocations = locationNames.filter(name => name.trim());
    const locationsToCreate = validLocations.length > 0 ? validLocations : ['Main Office'];

    setCreating(true);
    
    // Timeout protection - 30 seconds max
    const timeoutId = setTimeout(() => {
      console.error('[CompanyManagement] Operation timed out after 30 seconds');
      setCreating(false);
      toast({
        title: "Operation Timed Out",
        description: "Company creation is taking too long. Please try again.",
        variant: "destructive",
      });
    }, 30000);

    try {
      // Generate subdomain from name
      const subdomain = newCompanyName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
      console.log('[CompanyManagement] Creating company:', { name: newCompanyName, subdomain, locations: locationsToCreate });

      // Check if subdomain already exists
      const { data: existingTenant, error: checkError } = await supabase
        .from('tenants')
        .select('id')
        .eq('subdomain', subdomain)
        .maybeSingle();

      if (checkError) {
        console.error('[CompanyManagement] Error checking subdomain:', checkError);
        throw checkError;
      }

      if (existingTenant) {
        console.warn('[CompanyManagement] Subdomain already exists:', subdomain);
        clearTimeout(timeoutId);
        setCreating(false);
        toast({
          title: "Subdomain Already Exists",
          description: `A company with subdomain "${subdomain}" already exists. Please use a different company name.`,
          variant: "destructive",
        });
        return;
      }

      // Create tenant
      console.log('[CompanyManagement] Inserting tenant...');
      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .insert({
          name: newCompanyName.trim(),
          subdomain: subdomain,
          website: websiteData?.url || newCompanyWebsite || null,
          website_verified: websiteData?.verified || false,
          website_metadata: websiteData ? {
            title: websiteData.title,
            favicon: websiteData.favicon,
            domain: websiteData.domain,
          } : {},
          is_active: true,
        })
        .select()
        .single();

      if (tenantError) {
        console.error('[CompanyManagement] Tenant insert error:', tenantError);
        throw tenantError;
      }
      console.log('[CompanyManagement] Tenant created:', tenant.id);

      // Create all locations (uses locationsToCreate which defaults to 'Main Office')
      console.log('[CompanyManagement] Creating locations...');
      const locationInserts = locationsToCreate.map(name => ({
        tenant_id: tenant.id,
        name: name.trim(),
        is_active: true,
      }));

      const { error: locationError } = await supabase
        .from('locations')
        .insert(locationInserts);

      if (locationError) {
        console.error('[CompanyManagement] Location insert error:', locationError);
        throw locationError;
      }
      console.log('[CompanyManagement] Locations created:', locationsToCreate.length);

      // Grant current user full access to new company
      console.log('[CompanyManagement] Granting user access...');
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { error: accessError } = await (supabase as any)
          .from('user_company_access')
          .insert({
            user_id: user.id,
            tenant_id: tenant.id,
            access_level: 'full',
            granted_by: user.id,
          });
        
        if (accessError) {
          console.error('[CompanyManagement] Error granting access:', accessError);
        } else {
          console.log('[CompanyManagement] User access granted');
        }
      }

      clearTimeout(timeoutId);
      
      toast({
        title: "Company Created",
        description: `${newCompanyName} has been created with ${locationsToCreate.length} location(s)`,
      });

      // Reset form and close dialog
      setNewCompanyName('');
      setNewCompanyWebsite('');
      setWebsiteData(null);
      setLocationCount('1');
      setLocationNames(['']);
      setCreateDialogOpen(false);

      // Refresh lists
      fetchCompanies();
      refetchCompanies();
    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error('[CompanyManagement] Error creating company:', error);
      toast({
        title: "Error Creating Company",
        description: error.message || error.code || 'Unknown error occurred. Check console for details.',
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const openCompanyDetails = (company: Company) => {
    setSelectedCompany(company);
    setDetailsDialogOpen(true);
  };

  if (loading) {
    return <div className="text-muted-foreground">Loading companies...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Company Management</h3>
          <p className="text-sm text-muted-foreground">
            Manage companies and their office locations
          </p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Company
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create New Company</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="company-name">Company Name *</Label>
                <Input
                  id="company-name"
                  placeholder="ABC Roofing Co."
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="website">
                  <Globe className="h-4 w-4 inline mr-1" />
                  Company Website
                </Label>
                <Input
                  id="website"
                  placeholder="www.example.com"
                  value={newCompanyWebsite}
                  onChange={(e) => setNewCompanyWebsite(e.target.value)}
                />
                <WebsitePreview 
                  url={newCompanyWebsite} 
                  onVerified={setWebsiteData}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="location-count">Number of Locations</Label>
                <Select value={locationCount} onValueChange={setLocationCount}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select number of locations" />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
                      <SelectItem key={num} value={num.toString()}>
                        {num} {num === 1 ? 'Location' : 'Locations'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Leave blank to create a default "Main Office" location</p>
              </div>

              <div className="space-y-3">
                <Label>Location Names <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {locationNames.map((name, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                        {index + 1}
                      </div>
                      <Input
                        placeholder={`Location ${index + 1} Name`}
                        value={name}
                        onChange={(e) => handleLocationNameChange(index, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateCompany} disabled={creating}>
                {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Company
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {companies.map((company) => (
          <Card
            key={company.id}
            className={`cursor-pointer transition-colors hover:border-primary ${
              company.id === activeCompanyId ? 'border-primary' : ''
            }`}
            onClick={() => openCompanyDetails(company)}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <Building2 className="h-5 w-5 text-muted-foreground" />
                {company.id === activeCompanyId && (
                  <Badge variant="default">Active</Badge>
                )}
              </div>
              <CardTitle className="text-lg">{company.name}</CardTitle>
              {company.website && (
                <CardDescription className="flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  {company.website.replace(/^https?:\/\//, '')}
                  {company.website_verified && (
                    <Badge variant="secondary" className="text-xs ml-1">Verified</Badge>
                  )}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  <span>Locations</span>
                </div>
                <div className="flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  <span>Users</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {companies.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10">
            <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-center">
              No companies found. Create your first company to get started.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Company Details Dialog */}
      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedCompany?.name}</DialogTitle>
          </DialogHeader>
          {selectedCompany && (
            <Tabs defaultValue="info" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="info">
                  <Info className="h-4 w-4 mr-2" />
                  Info
                </TabsTrigger>
                <TabsTrigger value="locations">
                  <MapPin className="h-4 w-4 mr-2" />
                  Locations
                </TabsTrigger>
                <TabsTrigger value="users">
                  <Users className="h-4 w-4 mr-2" />
                  Users
                </TabsTrigger>
                <TabsTrigger value="settings">
                  <SettingsIcon className="h-4 w-4 mr-2" />
                  Settings
                </TabsTrigger>
              </TabsList>

              <TabsContent value="info" className="space-y-6">
                {/* Company Branding Section */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Image className="h-4 w-4" />
                      Company Branding
                    </CardTitle>
                    <CardDescription>
                      Upload your company logo for estimates, proposals, and documents
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <LogoUploader
                      logoUrl={selectedCompany.logo_url}
                      tenantIdOverride={selectedCompany.id}
                      onLogoUploaded={async (url) => {
                        const { error } = await supabase
                          .from('tenants')
                          .update({ logo_url: url })
                          .eq('id', selectedCompany.id);
                        
                        if (error) {
                          toast({
                            title: "Error",
                            description: "Failed to save logo",
                            variant: "destructive",
                          });
                        } else {
                          toast({
                            title: "Logo Updated",
                            description: "Company logo has been saved",
                          });
                          fetchCompanies();
                          setSelectedCompany({ ...selectedCompany, logo_url: url });
                        }
                      }}
                      onLogoRemoved={async () => {
                        const { error } = await supabase
                          .from('tenants')
                          .update({ logo_url: null })
                          .eq('id', selectedCompany.id);
                        
                        if (error) {
                          toast({
                            title: "Error",
                            description: "Failed to remove logo",
                            variant: "destructive",
                          });
                        } else {
                          toast({
                            title: "Logo Removed",
                            description: "Company logo has been removed",
                          });
                          fetchCompanies();
                          setSelectedCompany({ ...selectedCompany, logo_url: undefined });
                        }
                      }}
                    />
                  </CardContent>
                </Card>

                {/* Company Details Section */}
                <div className="grid gap-4">
                  <div>
                    <Label>Company Name</Label>
                    <p className="text-sm text-muted-foreground mt-1">{selectedCompany.name}</p>
                  </div>
                  {selectedCompany.website && (
                    <div>
                      <Label>Website</Label>
                      <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        <a href={selectedCompany.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                          {selectedCompany.website}
                        </a>
                        {selectedCompany.website_verified && (
                          <Badge variant="secondary" className="text-xs">Verified</Badge>
                        )}
                      </p>
                    </div>
                  )}
                  <div>
                    <Label>Created</Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      {new Date(selectedCompany.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <Label>Status</Label>
                    <Badge variant={selectedCompany.is_active ? "default" : "secondary"} className="mt-1">
                      {selectedCompany.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="locations">
                <LocationManagement tenantId={selectedCompany.id} />
              </TabsContent>

              <TabsContent value="users">
                <div className="text-muted-foreground text-center py-8">
                  User management coming soon
                </div>
              </TabsContent>

              <TabsContent value="settings">
                <div className="text-muted-foreground text-center py-8">
                  Company settings coming soon
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
