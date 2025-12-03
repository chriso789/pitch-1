import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, MapPin, Users, Plus, Info, Settings as SettingsIcon, Globe, Loader2 } from 'lucide-react';
import { LocationManagement } from '@/components/settings/LocationManagement';
import { WebsitePreview } from '@/components/settings/WebsitePreview';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';

interface Company {
  id: string;
  name: string;
  subdomain: string;
  website?: string;
  website_verified?: boolean;
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
  const [locationNames, setLocationNames] = useState<string[]>(['Main Office']);

  useEffect(() => {
    fetchCompanies();
  }, []);

  // Update location names array when count changes
  useEffect(() => {
    const count = parseInt(locationCount);
    setLocationNames(prev => {
      const newNames = [...prev];
      while (newNames.length < count) {
        newNames.push(`Office ${newNames.length + 1}`);
      }
      return newNames.slice(0, count);
    });
  }, [locationCount]);

  const fetchCompanies = async () => {
    try {
      const { data, error }: any = await supabase
        .from('tenants')
        .select('id, name, subdomain, website, website_verified, is_active, created_at, settings')
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

    const validLocations = locationNames.filter(name => name.trim());
    if (validLocations.length === 0) {
      toast({
        title: "Validation Error",
        description: "At least one location is required",
        variant: "destructive",
      });
      return;
    }

    setCreating(true);
    try {
      // Generate subdomain from name
      const subdomain = newCompanyName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

      // Create tenant
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

      if (tenantError) throw tenantError;

      // Create all locations
      const locationInserts = validLocations.map(name => ({
        tenant_id: tenant.id,
        name: name.trim(),
        is_active: true,
      }));

      const { error: locationError } = await supabase
        .from('locations')
        .insert(locationInserts);

      if (locationError) throw locationError;

      // Grant current user full access to new company
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
        
        if (accessError) console.error('Error granting access:', accessError);
      }

      toast({
        title: "Company Created",
        description: `${newCompanyName} has been created with ${validLocations.length} location(s)`,
      });

      // Reset form and close dialog
      setNewCompanyName('');
      setNewCompanyWebsite('');
      setWebsiteData(null);
      setLocationCount('1');
      setLocationNames(['Main Office']);
      setCreateDialogOpen(false);

      // Refresh lists
      fetchCompanies();
      refetchCompanies();
    } catch (error: any) {
      toast({
        title: "Error Creating Company",
        description: error.message,
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
                <Label htmlFor="location-count">Number of Locations *</Label>
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
              </div>

              <div className="space-y-3">
                <Label>Location Names *</Label>
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

              <TabsContent value="info" className="space-y-4">
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
