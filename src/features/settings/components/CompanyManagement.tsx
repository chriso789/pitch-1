import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Building2, MapPin, Users, Plus, Info, Settings as SettingsIcon } from 'lucide-react';
import { LocationManagement } from '@/components/settings/LocationManagement';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';

interface Company {
  id: string;
  name: string;
  subdomain: string;
  is_active: boolean;
  created_at: string;
  settings: any;
}

export const CompanyManagement = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const { toast } = useToast();
  const { activeCompanyId, refetch: refetchCompanies } = useCompanySwitcher();

  // Form state for creating new company
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanySubdomain, setNewCompanySubdomain] = useState('');
  const [newLocationName, setNewLocationName] = useState('');

  useEffect(() => {
    fetchCompanies();
  }, []);

  const fetchCompanies = async () => {
    try {
      // @ts-ignore - Column not yet in generated types
      const { data, error }: any = await supabase
        .from('tenants')
        .select('id, name, subdomain, is_active, created_at, settings')
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

  const handleCreateCompany = async () => {
    if (!newCompanyName.trim() || !newLocationName.trim()) {
      toast({
        title: "Validation Error",
        description: "Company name and initial location are required",
        variant: "destructive",
      });
      return;
    }

    try {
      // Generate subdomain from name if not provided
      const subdomain = newCompanySubdomain.trim() || 
        newCompanyName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

      // Create tenant
      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .insert({
          name: newCompanyName.trim(),
          subdomain: subdomain,
          is_active: true,
        })
        .select()
        .single();

      if (tenantError) throw tenantError;

      // Create initial location
      const { error: locationError } = await supabase
        .from('locations')
        .insert({
          tenant_id: tenant.id,
          name: newLocationName.trim(),
          is_active: true,
        });

      if (locationError) throw locationError;

      // Grant current user full access to new company
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // @ts-ignore - Table not yet in generated types
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
        description: `${newCompanyName} has been created successfully`,
      });

      // Reset form and close dialog
      setNewCompanyName('');
      setNewCompanySubdomain('');
      setNewLocationName('');
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
          <DialogContent>
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
                <Label htmlFor="subdomain">Subdomain</Label>
                <Input
                  id="subdomain"
                  placeholder="abc-roofing (optional, auto-generated)"
                  value={newCompanySubdomain}
                  onChange={(e) => setNewCompanySubdomain(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location-name">Initial Location Name *</Label>
                <Input
                  id="location-name"
                  placeholder="Main Office"
                  value={newLocationName}
                  onChange={(e) => setNewLocationName(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateCompany}>
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
              <CardDescription>{company.subdomain}</CardDescription>
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
                  <div>
                    <Label>Subdomain</Label>
                    <p className="text-sm text-muted-foreground mt-1">{selectedCompany.subdomain}</p>
                  </div>
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
