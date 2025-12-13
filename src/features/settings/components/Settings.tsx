import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useCompanySwitcher } from "@/hooks/useCompanySwitcher";
import { AutomationManager } from "@/components/AutomationManager";
import { SmartDocumentEditor } from "@/components/SmartDocumentEditor";
import { DynamicTagManager } from "@/components/DynamicTagManager";
import { ApprovalManager } from "@/components/ApprovalManager";
import * as LucideIcons from "lucide-react";
import { MaterialCatalogManager } from "@/components/MaterialCatalogManager";
import { EstimateBuilder } from "@/features/estimates/components/EstimateBuilder";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { UserManagement } from "@/components/settings/UserManagement";
import { DeveloperAccess } from "@/components/settings/DeveloperAccess";
import { LocationManagement } from "@/components/settings/LocationManagement";
import { LocationUserDetails } from "@/components/settings/LocationUserDetails";
import { CommissionManagement } from "@/components/settings/CommissionManagement";
import { ProductCatalogManager } from "@/components/settings/ProductCatalogManager";
import SupplierManagement from "./SupplierManagement";
import { VoiceAssistantSettings } from "@/components/settings/VoiceAssistantSettings";
import ErrorReportsManager from "./ErrorReportsManager";
import EnhancedErrorReportsManager from "./EnhancedErrorReportsManager";
import ManagerApprovalQueue from "@/components/ManagerApprovalQueue";
import QuickBooksSettings from "@/components/settings/QuickBooksSettings";
import { JobTypeQBOMapping } from "@/components/settings/JobTypeQBOMapping";
import { SystemHealthCheck } from "@/components/settings/SystemHealthCheck";
import { SettingsTabEditor } from "@/components/settings/SettingsTabEditor";
import { LeadSources } from "@/features/leads/components/LeadSources";
import { IntegrationsSettings } from "@/components/settings/IntegrationsSettings";
import { SecurityAudit } from "@/components/settings/SecurityAudit";
import { TrustedDevices } from "@/components/settings/TrustedDevices";
import { CacheManagement } from "@/components/settings/CacheManagement";
import { CompanyManagement } from "@/features/settings/components/CompanyManagement";
import { CompanyActivityLog } from "@/features/settings/components/CompanyActivityLog";
import { PriceManagementDashboard } from "@/components/pricing/PriceManagementDashboard";
import { PlatformAdmin } from "@/components/settings/PlatformAdmin";
import { BatchRegenerationPanel } from "@/components/measurements/BatchRegenerationPanel";
import { MeasurementQualityDashboard } from "@/components/measurements/MeasurementQualityDashboard";
import { EdgeFunctionHealthDashboard } from "@/components/settings/EdgeFunctionHealthDashboard";
import { SubscriptionManagement } from "@/components/settings/SubscriptionManagement";
import { DemoRequestsPanel } from "@/components/settings/DemoRequestsPanel";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface SettingsTab {
  id: string;
  tab_key: string;
  label: string;
  description: string | null;
  icon_name: string;
  order_index: number;
  is_active: boolean;
  required_role: string[] | null;
}

interface TabCategory {
  name: string;
  icon: keyof typeof LucideIcons;
  tabs: SettingsTab[];
}

const TAB_CATEGORIES: Record<string, { name: string; icon: keyof typeof LucideIcons; order: number }> = {
  general: { name: "General", icon: "Settings", order: 1 },
  business: { name: "Business", icon: "Briefcase", order: 2 },
  products: { name: "Products & Pricing", icon: "Package", order: 3 },
  communications: { name: "Communications", icon: "MessageSquare", order: 4 },
  system: { name: "System", icon: "Server", order: 5 },
  platform: { name: "Platform", icon: "Shield", order: 6 },
};

const TAB_TO_CATEGORY: Record<string, string> = {
  general: "general",
  "lead-sources": "general",
  automations: "general",
  company: "business",
  users: "business",
  commissions: "business",
  quickbooks: "business",
  materials: "products",
  products: "products",
  suppliers: "products",
  estimates: "products",
  pricing: "products",
  "voice-assistant": "communications",
  integrations: "communications",
  developer: "system",
  health: "system",
  security: "system",
  "edge-functions": "system",
  cache: "system",
  "platform-admin": "platform",
  "demo-requests": "platform",
  subscription: "platform",
  "quality-monitoring": "platform",
  portals: "general",
  reports: "system",
  measurements: "products",
  companies: "business",
  "company-activity": "business",
};

export const Settings = () => {
  const { user: currentUser, loading } = useCurrentUser();
  const [tabConfig, setTabConfig] = useState<SettingsTab[]>([]);
  const [activeTab, setActiveTab] = useState<string>("general");
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const { toast } = useToast();
  const { companies, activeCompany, activeCompanyId, loading: companiesLoading, switchCompany } = useCompanySwitcher();

  useEffect(() => {
    if (currentUser?.profileLoaded === true && currentUser?.role) {
      loadTabConfiguration();
    }
  }, [currentUser?.role, currentUser?.profileLoaded, activeCompanyId]);

  const masterBackendTabs = [
    'platform-admin', 'developer', 'health', 'edge-functions', 
    'subscription', 'security', 'pricing', 'quality-monitoring', 'demo-requests'
  ];

  const isViewingDifferentCompany = currentUser?.tenant_id && activeCompanyId && 
    currentUser.tenant_id !== activeCompanyId;

  const loadTabConfiguration = async () => {
    try {
      const { data, error } = await supabase
        .from('settings_tabs')
        .select('*')
        .eq('is_active', true)
        .order('order_index', { ascending: true });

      if (error) throw error;

      let filteredTabs = (data || []).filter(tab => {
        if (!tab.required_role || tab.required_role.length === 0) return true;
        return tab.required_role.includes(currentUser?.role);
      });

      if (currentUser?.role === 'master' && isViewingDifferentCompany) {
        filteredTabs = filteredTabs.filter(tab => !masterBackendTabs.includes(tab.tab_key));
      }

      setTabConfig(filteredTabs);
      if (filteredTabs.length > 0 && !filteredTabs.find(t => t.tab_key === activeTab)) {
        setActiveTab(filteredTabs[0].tab_key);
      }
    } catch (error) {
      console.error('Error loading tab configuration:', error);
    }
  };

  // Group tabs by category
  const groupedTabs = React.useMemo(() => {
    const groups: Record<string, SettingsTab[]> = {};
    
    tabConfig.forEach(tab => {
      const category = TAB_TO_CATEGORY[tab.tab_key] || "general";
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(tab);
    });

    return Object.entries(TAB_CATEGORIES)
      .filter(([key]) => groups[key]?.length > 0)
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([key, config]) => ({
        key,
        ...config,
        tabs: groups[key] || [],
      }));
  }, [tabConfig]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="text-center py-8 text-muted-foreground">
          Loading settings...
        </div>
      </div>
    );
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case "general":
        return <GeneralSettings />;
      case "materials":
        return <MaterialCatalogManager />;
      case "estimates":
        return <EstimateBuilder />;
      case "commissions":
        return <CommissionManagement />;
      case "suppliers":
        return <SupplierManagement />;
      case "products":
        return <ProductCatalogManager />;
      case "lead-sources":
        return <LeadSources />;
      case "company":
        return (
          <div className="space-y-6">
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="py-6">
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-lg bg-primary/10 flex items-center justify-center">
                    <LucideIcons.Building2 className="h-8 w-8 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-2xl font-bold">{activeCompany?.tenant_name || 'No Company Selected'}</h2>
                    <p className="text-muted-foreground">{activeCompany?.tenant_subdomain || ''}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary">
                        <LucideIcons.MapPin className="h-3 w-3 mr-1" />
                        {activeCompany?.location_count || 0} Location{(activeCompany?.location_count || 0) !== 1 ? 's' : ''}
                      </Badge>
                      {activeCompany?.is_active && (
                        <Badge variant="default" className="bg-green-500/20 text-green-700 border-green-500/30">
                          Active
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <LocationManagement />
            <LocationUserDetails />
          </div>
        );
      case "users":
        return <UserManagement />;
      case "quickbooks":
        return (
          <div className="space-y-6">
            <QuickBooksSettings />
            <JobTypeQBOMapping />
          </div>
        );
      case "reports":
        return <EnhancedErrorReportsManager />;
      case "automations":
        return (
          <Tabs defaultValue="automations" className="w-full">
            <TabsList>
              <TabsTrigger value="automations">Automations</TabsTrigger>
              <TabsTrigger value="templates">Smart Documents</TabsTrigger>
              <TabsTrigger value="tags">Dynamic Tags</TabsTrigger>
            </TabsList>
            <TabsContent value="automations">
              <AutomationManager />
            </TabsContent>
            <TabsContent value="templates">
              <SmartDocumentEditor />
            </TabsContent>
            <TabsContent value="tags">
              <DynamicTagManager />
            </TabsContent>
          </Tabs>
        );
      case "health":
        return <SystemHealthCheck />;
      case "developer":
        return <DeveloperAccess />;
      case "integrations":
        return <IntegrationsSettings />;
      case "security":
        return (
          <div className="space-y-6">
            <SecurityAudit />
            <TrustedDevices />
          </div>
        );
      case "cache":
        return <CacheManagement />;
      case "companies":
        return <CompanyManagement />;
      case "company-activity":
        return <CompanyActivityLog />;
      case "pricing":
        return <PriceManagementDashboard />;
      case "measurements":
        return <BatchRegenerationPanel />;
      case "quality-monitoring":
        return <MeasurementQualityDashboard />;
      case "platform-admin":
        return <PlatformAdmin />;
      case "edge-functions":
        return <EdgeFunctionHealthDashboard />;
      case "voice-assistant":
        return <VoiceAssistantSettings />;
      case "subscription":
        return <SubscriptionManagement />;
      case "demo-requests":
        return <DemoRequestsPanel />;
      case "portals":
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LucideIcons.LayoutGrid className="h-5 w-5" />
                Portal Access
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Access the crew and homeowner portals to manage field work and customer-facing project views.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card 
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => window.location.href = '/crew'}
                >
                  <CardContent className="p-6 flex items-center gap-4">
                    <div className="h-12 w-12 rounded-lg bg-orange-500/10 flex items-center justify-center">
                      <LucideIcons.HardHat className="h-6 w-6 text-orange-500" />
                    </div>
                    <div>
                      <h3 className="font-semibold">Crew Portal</h3>
                      <p className="text-sm text-muted-foreground">
                        Access crew-specific features
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Card 
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => window.location.href = '/portal'}
                >
                  <CardContent className="p-6 flex items-center gap-4">
                    <div className="h-12 w-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <LucideIcons.Home className="h-6 w-6 text-blue-500" />
                    </div>
                    <div>
                      <h3 className="font-semibold">Homeowner Portal</h3>
                      <p className="text-sm text-muted-foreground">
                        Customer-facing project view
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        );
      default:
        return (
          <div className="text-center py-8 text-muted-foreground">
            Select a settings category from the sidebar
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            Settings
          </h1>
          <p className="text-muted-foreground">
            Configure your system preferences and templates
          </p>
        </div>
        <div className="flex items-center gap-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <LucideIcons.Building2 className="h-4 w-4" />
                <span className="max-w-[200px] truncate">
                  {companiesLoading ? 'Loading...' : (activeCompany?.tenant_name || 'Select Company')}
                </span>
                <LucideIcons.ChevronDown className="h-4 w-4 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Company Profile</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {companies.length === 0 ? (
                <DropdownMenuItem disabled>No companies available</DropdownMenuItem>
              ) : (
                companies.map((company) => (
                  <DropdownMenuItem 
                    key={company.tenant_id}
                    onClick={() => switchCompany(company.tenant_id)}
                    className="flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{company.tenant_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {company.location_count} location{company.location_count !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {company.tenant_id === activeCompanyId && (
                      <LucideIcons.Check className="h-4 w-4 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={() => window.location.href = '/admin/companies'}
                className="cursor-pointer"
              >
                <LucideIcons.Settings className="h-4 w-4 mr-2" />
                Manage All Companies
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => {
                  window.location.href = '/admin/companies?action=create';
                }}
                className="cursor-pointer text-primary"
              >
                <LucideIcons.Plus className="h-4 w-4 mr-2" />
                Add New Company
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {currentUser?.role === 'master' && (
            <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <LucideIcons.Settings className="h-4 w-4 mr-2" />
                  Configure Tabs
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Settings Tab Configuration</DialogTitle>
                </DialogHeader>
                <SettingsTabEditor 
                  onSave={() => {
                    loadTabConfiguration();
                    setConfigDialogOpen(false);
                    toast({ title: "Tab configuration updated" });
                  }}
                />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Main Content - Sidebar + Content Layout */}
      <div className="flex gap-6 min-h-[600px]">
        {/* Sidebar */}
        <Card className="w-64 shrink-0">
          <ScrollArea className="h-[calc(100vh-240px)]">
            <div className="p-4 space-y-6">
              {groupedTabs.map((category) => {
                const CategoryIcon = LucideIcons[category.icon] as React.ComponentType<{ className?: string }>;
                
                return (
                  <div key={category.key}>
                    <div className="flex items-center gap-2 px-2 mb-2">
                      <CategoryIcon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {category.name}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {category.tabs.map((tab) => {
                        const TabIcon = (LucideIcons[tab.icon_name as keyof typeof LucideIcons] || LucideIcons.Settings) as React.ComponentType<{ className?: string }>;
                        const isActive = activeTab === tab.tab_key;
                        
                        return (
                          <button
                            key={tab.tab_key}
                            onClick={() => setActiveTab(tab.tab_key)}
                            className={cn(
                              "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors text-left",
                              isActive 
                                ? "bg-primary text-primary-foreground" 
                                : "hover:bg-muted text-foreground"
                            )}
                          >
                            <TabIcon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{tab.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </Card>

        {/* Content Area */}
        <div className="flex-1 min-w-0">
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
};
