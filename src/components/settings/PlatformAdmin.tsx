import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Building2, 
  Users, 
  MapPin, 
  Plus, 
  Search,
  Eye,
  Power,
  Shield,
  ExternalLink,
  BarChart3,
  Megaphone,
  Mail,
  UserCog,
  UserPlus,
  Loader2,
  RefreshCw
} from "lucide-react";
import { EnhancedCompanyOnboarding } from "./EnhancedCompanyOnboarding";
import { LocationUserAssignment } from "./LocationUserAssignment";
import { DeletionHistoryTab } from "./DeletionHistoryTab";
import { PatentResearchDashboard } from "./PatentResearchDashboard";
import { BackupStatusDashboard } from "./BackupStatusDashboard";
import { BackupRestorePanel } from "./BackupRestorePanel";
import { OnboardingAnalyticsDashboard } from "./OnboardingAnalyticsDashboard";
import { PlatformCommunications } from "./PlatformCommunications";
import { EmailDiagnosticsPanel } from "./EmailDiagnosticsPanel";
import { PlatformOperatorsPanel } from "./PlatformOperatorsPanel";

interface Company {
  id: string;
  name: string;
  subdomain: string;
  is_active?: boolean;
  logo_url?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  phone?: string | null;
  email?: string | null;
  owner_email?: string | null;
  owner_name?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  website?: string | null;
  license_number?: string | null;
  onboarded_at?: string | null;
  created_at: string;
  user_count?: number;
  location_count?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings?: any;
}

export const PlatformAdmin = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("active");
  const { toast } = useToast();

  useEffect(() => {
    loadCompanies();
  }, []);

  const loadCompanies = async () => {
    try {
      setLoading(true);
      
      // Fetch all tenants (companies)
      const { data: tenants, error } = await supabase
        .from('tenants')
        .select('*')
        .order('name');

      if (error) throw error;

      // Get user counts per tenant
      const { data: userCounts } = await supabase
        .from('profiles')
        .select('tenant_id');

      // Get location counts per tenant
      const { data: locationCounts } = await supabase
        .from('locations')
        .select('tenant_id');

      // Map counts to companies
      const companiesWithCounts: Company[] = (tenants || []).map(tenant => ({
        ...tenant,
        is_active: (tenant as any).is_active ?? true,
        user_count: userCounts?.filter(u => u.tenant_id === tenant.id).length || 0,
        location_count: locationCounts?.filter(l => l.tenant_id === tenant.id).length || 0
      }));

      setCompanies(companiesWithCounts);
    } catch (error: any) {
      console.error('Error loading companies:', error);
      toast({
        title: "Error loading companies",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleCompanyStatus = async (company: Company) => {
    try {
      const newStatus = !(company.is_active ?? true);
      const { error } = await supabase
        .from('tenants')
        .update({ is_active: newStatus } as any)
        .eq('id', company.id);

      if (error) throw error;

      toast({
        title: company.is_active ? "Company deactivated" : "Company activated",
        description: `${company.name} has been ${company.is_active ? 'deactivated' : 'activated'}`
      });

      loadCompanies();
    } catch (error: any) {
      toast({
        title: "Error updating company",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  // Filter out demo tenants (like Acme Roofing) and apply search
  const filteredCompanies = companies.filter(company => {
    // Filter out demo tenants
    const isDemo = company.settings?.is_demo === true || 
      company.id === '550e8400-e29b-41d4-a716-446655440000'; // Acme Roofing demo UUID
    if (isDemo) return false;
    
    // Apply search filter
    return company.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      company.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      company.owner_email?.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const activeCompanies = filteredCompanies.filter(c => c.is_active !== false);
  const inactiveCompanies = filteredCompanies.filter(c => c.is_active === false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Platform Administration
          </h2>
          <p className="text-muted-foreground">
            Master-level access to manage all companies and onboarding
          </p>
        </div>
        <Button className="gap-2" onClick={() => setOnboardingOpen(true)}>
          <Plus className="h-4 w-4" />
          Onboard New Company
        </Button>
        <EnhancedCompanyOnboarding
          open={onboardingOpen}
          onOpenChange={setOnboardingOpen}
          onComplete={() => loadCompanies()}
        />
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeCompanies.length}</p>
                <p className="text-sm text-muted-foreground">Active Companies</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card 
          className="cursor-pointer hover:border-primary transition-colors"
          onClick={() => setActiveTab("inactive")}
        >
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-destructive/10 rounded-lg">
                <Power className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{inactiveCompanies.length}</p>
                <p className="text-sm text-muted-foreground">Inactive Companies</p>
                <p className="text-xs text-primary">Click to view</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <Users className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {companies.reduce((sum, c) => sum + (c.user_count || 0), 0)}
                </p>
                <p className="text-sm text-muted-foreground">Total Users</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <MapPin className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {companies.reduce((sum, c) => sum + (c.location_count || 0), 0)}
                </p>
                <p className="text-sm text-muted-foreground">Total Locations</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search companies by name or email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Companies Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="active">
            Active ({activeCompanies.length})
          </TabsTrigger>
          <TabsTrigger value="inactive">
            Inactive ({inactiveCompanies.length})
          </TabsTrigger>
          <TabsTrigger value="all">
            All ({filteredCompanies.length})
          </TabsTrigger>
          <TabsTrigger value="communications" className="gap-1">
            <Megaphone className="h-3 w-3" />
            Communications
          </TabsTrigger>
          <TabsTrigger value="email-diagnostics" className="gap-1">
            <Mail className="h-3 w-3" />
            Email Diagnostics
          </TabsTrigger>
          <TabsTrigger value="onboarding-analytics" className="gap-1">
            <BarChart3 className="h-3 w-3" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="deletion-history">
            Deletion History
          </TabsTrigger>
          <TabsTrigger value="backups">
            Backups
          </TabsTrigger>
          <TabsTrigger value="restore">
            Recovery
          </TabsTrigger>
          <TabsTrigger value="patents">
            Patents & IP
          </TabsTrigger>
          <TabsTrigger value="operators" className="gap-1">
            <UserCog className="h-3 w-3" />
            Operators
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4">
          <CompanyGrid 
            companies={activeCompanies} 
            loading={loading}
            onToggleStatus={toggleCompanyStatus}
            onViewDetails={(company) => {
              setSelectedCompany(company);
              setDetailsOpen(true);
            }}
          />
        </TabsContent>

        <TabsContent value="inactive" className="mt-4">
          <CompanyGrid 
            companies={inactiveCompanies} 
            loading={loading}
            onToggleStatus={toggleCompanyStatus}
            onViewDetails={(company) => {
              setSelectedCompany(company);
              setDetailsOpen(true);
            }}
          />
        </TabsContent>

        <TabsContent value="all" className="mt-4">
          <CompanyGrid 
            companies={filteredCompanies} 
            loading={loading}
            onToggleStatus={toggleCompanyStatus}
            onViewDetails={(company) => {
              setSelectedCompany(company);
              setDetailsOpen(true);
            }}
          />
        </TabsContent>

        <TabsContent value="communications" className="mt-4">
          <PlatformCommunications />
        </TabsContent>

        <TabsContent value="email-diagnostics" className="mt-4">
          <EmailDiagnosticsPanel />
        </TabsContent>

        <TabsContent value="onboarding-analytics" className="mt-4">
          <OnboardingAnalyticsDashboard />
        </TabsContent>

        <TabsContent value="deletion-history" className="mt-4">
          <DeletionHistoryTab />
        </TabsContent>

        <TabsContent value="backups" className="mt-4">
          <BackupStatusDashboard />
        </TabsContent>

        <TabsContent value="restore" className="mt-4">
          <BackupRestorePanel />
        </TabsContent>

        <TabsContent value="patents" className="mt-4">
          <PatentResearchDashboard />
        </TabsContent>

        <TabsContent value="operators" className="mt-4">
          <PlatformOperatorsPanel />
        </TabsContent>
      </Tabs>

      {/* Company Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedCompany?.logo_url && (
                <img src={selectedCompany.logo_url} alt="" className="h-8 w-8 rounded" />
              )}
              {selectedCompany?.name}
            </DialogTitle>
          </DialogHeader>
          {selectedCompany && (
            <CompanyDetailsPanel 
              company={selectedCompany} 
              onUpdate={loadCompanies}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Company Grid Component
interface CompanyGridProps {
  companies: Company[];
  loading: boolean;
  onToggleStatus: (company: Company) => void;
  onViewDetails: (company: Company) => void;
}

const CompanyGrid = ({ companies, loading, onToggleStatus, onViewDetails }: CompanyGridProps) => {
  const { toast } = useToast();
  const [provisioningId, setProvisioningId] = useState<string | null>(null);

  const handleProvisionOwner = async (company: Company) => {
    if (!company.owner_email) {
      toast({
        title: "No owner email",
        description: "This company doesn't have an owner email configured",
        variant: "destructive",
      });
      return;
    }

    setProvisioningId(company.id);
    try {
      const { data, error } = await supabase.functions.invoke('provision-tenant-owner', {
        body: { tenant_id: company.id, send_email: true },
      });

      if (error) throw error;

      toast({
        title: data.is_new_user ? "Owner Created" : "Owner Updated",
        description: data.email_sent 
          ? `Setup email sent to ${data.email}` 
          : `Account ready for ${data.email}. ${data.invite_link ? 'Invite link generated.' : ''}`,
      });
    } catch (error: any) {
      console.error('Provision owner error:', error);
      toast({
        title: "Error provisioning owner",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setProvisioningId(null);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <Card key={i} className="animate-pulse">
            <CardContent className="pt-6 h-48" />
          </Card>
        ))}
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No companies found
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {companies.map(company => (
        <Card key={company.id} className="hover:shadow-md transition-shadow overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2 w-full">
              <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
                {company.logo_url ? (
                  <img src={company.logo_url} alt="" className="h-10 w-10 rounded object-cover shrink-0" />
                ) : (
                  <div 
                    className="h-10 w-10 rounded flex items-center justify-center text-white font-bold shrink-0"
                    style={{ backgroundColor: company.primary_color || '#2563eb' }}
                  >
                    {company.name.charAt(0)}
                  </div>
                )}
                <div className="min-w-0 flex-1 overflow-hidden">
                  <CardTitle className="text-lg truncate block" title={company.name}>{company.name}</CardTitle>
                  {company.owner_email && (
                    <p className="text-xs text-muted-foreground truncate block" title={company.owner_email}>{company.owner_email}</p>
                  )}
                </div>
              </div>
              <Badge variant={company.is_active !== false ? "default" : "secondary"} className="shrink-0 ml-auto">
                {company.is_active !== false ? "Active" : "Inactive"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-4 text-sm flex-wrap">
              <div className="flex items-center gap-1 text-muted-foreground whitespace-nowrap">
                <Users className="h-4 w-4 shrink-0" />
                <span>{company.user_count} users</span>
              </div>
              <div className="flex items-center gap-1 text-muted-foreground whitespace-nowrap">
                <MapPin className="h-4 w-4 shrink-0" />
                <span>{company.location_count} locations</span>
              </div>
            </div>
            
            {company.address_city && company.address_state && (
              <p className="text-sm text-muted-foreground">
                {company.address_city}, {company.address_state}
              </p>
            )}

            <div className="flex gap-2 pt-2">
              <Button 
                variant="outline" 
                size="sm" 
                className="flex-1 min-w-0"
                onClick={() => onViewDetails(company)}
              >
                <Eye className="h-4 w-4 mr-1 shrink-0" />
                <span className="truncate">Details</span>
              </Button>
              {company.owner_email && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleProvisionOwner(company)}
                  disabled={provisioningId === company.id}
                  title="Create/update owner account and send setup email"
                >
                  {provisioningId === company.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                </Button>
              )}
              <Button
                variant={company.is_active !== false ? "destructive" : "default"}
                size="sm"
                onClick={() => onToggleStatus(company)}
                title={company.is_active !== false ? "Deactivate company" : "Reactivate company"}
              >
                <Power className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

// Company Details Panel
interface CompanyDetailsPanelProps {
  company: Company;
  onUpdate: () => void;
}

const CompanyDetailsPanel = ({ company, onUpdate }: CompanyDetailsPanelProps) => {
  const [locations, setLocations] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);

  useEffect(() => {
    loadCompanyDetails();
  }, [company.id]);

  const loadCompanyDetails = async () => {
    try {
      setLoading(true);
      
      const [locationsRes, usersRes] = await Promise.all([
        supabase.from('locations').select('*').eq('tenant_id', company.id),
        supabase.from('profiles').select('id, first_name, last_name, email, role, title').eq('tenant_id', company.id)
      ]);

      setLocations(locationsRes.data || []);
      setUsers(usersRes.data || []);
    } catch (error) {
      console.error('Error loading company details:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Tabs defaultValue="info">
      <TabsList className="w-full">
        <TabsTrigger value="info" className="flex-1">Company Info</TabsTrigger>
        <TabsTrigger value="locations" className="flex-1">Locations ({locations.length})</TabsTrigger>
        <TabsTrigger value="users" className="flex-1">Users ({users.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="info" className="space-y-4 mt-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-muted-foreground">License Number</Label>
            <p className="font-medium">{company.license_number || "Not set"}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">Phone</Label>
            <p className="font-medium">{company.phone || "Not set"}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">Email</Label>
            <p className="font-medium">{company.email || "Not set"}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">Website</Label>
            {company.website ? (
              <a href={company.website} target="_blank" rel="noopener noreferrer" className="font-medium text-primary flex items-center gap-1">
                {company.website} <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <p className="font-medium">Not set</p>
            )}
          </div>
          <div className="col-span-2">
            <Label className="text-muted-foreground">Address</Label>
            <p className="font-medium">
              {company.address_street ? (
                `${company.address_street}, ${company.address_city}, ${company.address_state} ${company.address_zip}`
              ) : "Not set"}
            </p>
          </div>
          <div>
            <Label className="text-muted-foreground">Onboarded</Label>
            <p className="font-medium">
              {company.onboarded_at 
                ? new Date(company.onboarded_at).toLocaleDateString()
                : new Date(company.created_at).toLocaleDateString()
              }
            </p>
          </div>
          <div>
            <Label className="text-muted-foreground">Brand Colors</Label>
            <div className="flex gap-2 mt-1">
              <div 
                className="h-6 w-6 rounded border"
                style={{ backgroundColor: company.primary_color || '#2563eb' }}
              />
              <div 
                className="h-6 w-6 rounded border"
                style={{ backgroundColor: company.secondary_color || '#1e40af' }}
              />
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="locations" className="mt-4">
        {loading ? (
          <div className="text-center py-4 text-muted-foreground">Loading...</div>
        ) : locations.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No locations found for this company
          </div>
        ) : (
          <div className="space-y-3">
            {locations.map(location => (
              <Card key={location.id}>
                <CardContent className="py-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium flex items-center gap-2">
                      {location.name}
                      {location.is_primary && (
                        <Badge variant="outline" className="text-xs">Primary</Badge>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {location.address_street}, {location.address_city}, {location.address_state}
                    </p>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setSelectedLocationId(location.id)}
                  >
                    <Users className="h-4 w-4 mr-1" />
                    Assign Users
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Location User Assignment Dialog */}
        <Dialog open={!!selectedLocationId} onOpenChange={() => setSelectedLocationId(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Assign Users to Location</DialogTitle>
            </DialogHeader>
            {selectedLocationId && (
              <LocationUserAssignment 
                locationId={selectedLocationId}
                tenantId={company.id}
                onClose={() => setSelectedLocationId(null)}
              />
            )}
          </DialogContent>
        </Dialog>
      </TabsContent>

      <TabsContent value="users" className="mt-4">
        {loading ? (
          <div className="text-center py-4 text-muted-foreground">Loading...</div>
        ) : users.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No users found for this company
          </div>
        ) : (
          <div className="space-y-2">
            {users.map(user => (
              <Card key={user.id}>
                <CardContent className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{user.first_name} {user.last_name}</p>
                    <p className="text-sm text-muted-foreground">{user.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{user.role}</Badge>
                    {user.title && (
                      <span className="text-sm text-muted-foreground">{user.title}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
};
