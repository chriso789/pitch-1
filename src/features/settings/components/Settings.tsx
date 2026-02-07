import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { EmailDomainSettings } from "./EmailDomainSettings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCompanySwitcher } from "@/hooks/useCompanySwitcher";
import { AutomationManager } from "@/components/AutomationManager";
import { SmartDocumentEditor } from "@/components/SmartDocumentEditor";
import { DynamicTagManager } from "@/components/DynamicTagManager";
import { ApprovalManager } from "@/components/ApprovalManager";
import * as LucideIcons from "lucide-react";
import { MaterialCatalogManager } from "@/components/MaterialCatalogManager";
import { EstimateBuilder } from "@/features/estimates/components/EstimateBuilder";
import { EstimateTemplateList } from "@/components/settings/EstimateTemplateList";
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
import { RoofTrainingLab } from "@/components/settings/RoofTrainingLab";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ApprovalRequirementsSettings } from "@/components/settings/ApprovalRequirementsSettings";
import { EstimateFinePrintSettings } from "@/components/settings/EstimateFinePrintSettings";
import { PipelineStageManager } from "@/components/settings/PipelineStageManager";

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
  email: "communications",
  developer: "system",
  health: "system",
  security: "system",
  "edge-functions": "system",
  cache: "system",
  "platform-admin": "platform",
  "demo-requests": "platform",
  subscription: "platform",
  "quality-monitoring": "platform",
  "company-activity": "platform",
  "roof-training": "platform",
  portals: "general",
  reports: "system",
  measurements: "products",
  companies: "business",
};

export const Settings = () => {
  const { user: currentUser, loading } = useCurrentUser();
  const [tabConfig, setTabConfig] = useState<SettingsTab[]>([]);
  const [activeTab, setActiveTab] = useState<string>("general");
  const [activeSubTab, setActiveSubTab] = useState<string>("settings");
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { toast } = useToast();
  const { activeCompany, activeCompanyId } = useCompanySwitcher();
  const isMobile = useIsMobile();
  
  // URL query param support for deep linking (e.g., /settings?tab=estimates)
  const [searchParams] = useSearchParams();
  
  // Check for navigation state (e.g., from Sidebar "Homeowner Portal" click)
  const locationState = window.history.state?.usr as { activeTab?: string } | undefined;
  
  // Set active tab from URL param or navigation state on mount
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    if (tabFromUrl) {
      setActiveTab(tabFromUrl);
    } else if (locationState?.activeTab) {
      setActiveTab(locationState.activeTab);
      // Clear the state so it doesn't persist on refresh
      window.history.replaceState({}, document.title);
    }
  }, [searchParams, locationState?.activeTab]);

  // Reset sub-tab when main tab changes
  useEffect(() => {
    if (activeTab === "general") {
      setActiveSubTab("settings");
    } else if (activeTab === "automations") {
      setActiveSubTab("automations");
    }
  }, [activeTab]);

  useEffect(() => {
    if (currentUser?.profileLoaded === true && currentUser?.role) {
      loadTabConfiguration();
    }
  }, [currentUser?.role, currentUser?.profileLoaded, activeCompanyId]);

  const masterBackendTabs = [
    'platform-admin', 'developer', 'health', 'edge-functions', 
    'subscription', 'security', 'pricing', 'quality-monitoring', 'demo-requests',
    'company-activity'
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
        return (
          <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="settings">General Settings</TabsTrigger>
              <TabsTrigger value="pipeline-stages">Pipeline Stages</TabsTrigger>
              <TabsTrigger value="lead-sources">Lead Sources</TabsTrigger>
              <TabsTrigger value="approval-requirements">Approval Requirements</TabsTrigger>
              <TabsTrigger value="estimate-pdf">Estimate PDF</TabsTrigger>
            </TabsList>
            <TabsContent value="settings">
              <GeneralSettings />
            </TabsContent>
            <TabsContent value="pipeline-stages">
              <PipelineStageManager />
            </TabsContent>
            <TabsContent value="lead-sources">
              <LeadSources />
            </TabsContent>
            <TabsContent value="approval-requirements">
              <ApprovalRequirementsSettings />
            </TabsContent>
            <TabsContent value="estimate-pdf">
              <EstimateFinePrintSettings />
            </TabsContent>
          </Tabs>
        );
      case "materials":
        return <MaterialCatalogManager />;
      case "estimates":
        return <EstimateTemplateList />;
      case "commissions":
        return <CommissionManagement />;
      case "suppliers":
        return <SupplierManagement />;
      case "products":
        return <ProductCatalogManager />;
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
          <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full">
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
      case "email":
        return <EmailDomainSettings />;
      case "roof-training":
        return <RoofTrainingLab />;
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
                  onClick={() => window.location.href = '/portal/login'}
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

  // Sidebar content component to avoid duplication
  const SidebarContent = () => (
    <div className="space-y-6">
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
                    onClick={() => {
                      setActiveTab(tab.tab_key);
                      setMobileMenuOpen(false);
                    }}
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
  );

  // Get current tab info for mobile header
  const currentTabInfo = tabConfig.find(t => t.tab_key === activeTab);
  const CurrentTabIcon = currentTabInfo 
    ? (LucideIcons[currentTabInfo.icon_name as keyof typeof LucideIcons] || LucideIcons.Settings) as React.ComponentType<{ className?: string }>
    : LucideIcons.Settings;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            Settings
          </h1>
          <p className="text-sm md:text-base text-muted-foreground">
            Configure your system preferences and templates
          </p>
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          {currentUser?.profileLoaded && currentUser?.role === 'master' && (
            <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <LucideIcons.Settings className="h-4 w-4 md:mr-2" />
                  <span className="hidden md:inline">Configure Tabs</span>
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

      {/* Mobile Tab Selector */}
      {isMobile && (
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              <div className="flex items-center gap-2">
                <CurrentTabIcon className="h-4 w-4" />
                <span>{currentTabInfo?.label || 'Select Setting'}</span>
              </div>
              <LucideIcons.ChevronDown className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[70vh]">
            <SheetHeader>
              <SheetTitle>Settings</SheetTitle>
            </SheetHeader>
            <ScrollArea className="h-full mt-4">
              <SidebarContent />
            </ScrollArea>
          </SheetContent>
        </Sheet>
      )}

      {/* Main Content - Sidebar + Content Layout */}
      <div className="flex gap-6 min-h-[600px]">
        {/* Desktop Sidebar */}
        {!isMobile && (
          <Card className="w-64 shrink-0">
            <ScrollArea className="h-[calc(100vh-240px)]">
              <div className="p-4">
                <SidebarContent />
              </div>
            </ScrollArea>
          </Card>
        )}

        {/* Content Area */}
        <div className="flex-1 min-w-0">
          {renderTabContent()}
        </div>
      </div>
      
      {/* Build ID Footer - helps verify latest code is loaded */}
      <div className="mt-4 text-center text-xs text-muted-foreground/50 select-all">
        Build: 2026-01-13-v3 | {new Date().toISOString().slice(0, 16)}
      </div>
    </div>
  );
};
