import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
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
import { CommissionManagement } from "@/components/settings/CommissionManagement";
import { ProductCatalogManager } from "@/components/settings/ProductCatalogManager";
import SupplierManagement from "./SupplierManagement";
import { default as VoiceInterface } from "@/features/communication/components/VoiceInterface";
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
import { CacheManagement } from "@/components/settings/CacheManagement";
import { CompanyManagement } from "@/features/settings/components/CompanyManagement";
import { CompanyActivityLog } from "@/features/settings/components/CompanyActivityLog";
import { PriceManagementDashboard } from "@/components/pricing/PriceManagementDashboard";
import { PlatformAdmin } from "@/components/settings/PlatformAdmin";
import { BatchRegenerationPanel } from "@/components/measurements/BatchRegenerationPanel";
import { MeasurementQualityDashboard } from "@/components/measurements/MeasurementQualityDashboard";
import { EdgeFunctionHealthDashboard } from "@/components/settings/EdgeFunctionHealthDashboard";
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

export const Settings = () => {
  const { user: currentUser, loading } = useCurrentUser();
  const [tabConfig, setTabConfig] = useState<SettingsTab[]>([]);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const { toast } = useToast();
  const { companies, activeCompany, activeCompanyId, loading: companiesLoading, switchCompany } = useCompanySwitcher();

  useEffect(() => {
    if (currentUser) {
      loadTabConfiguration();
    }
  }, [currentUser]);

  const loadTabConfiguration = async () => {
    try {
      const { data, error } = await supabase
        .from('settings_tabs')
        .select('*')
        .eq('is_active', true)
        .order('order_index', { ascending: true });

      if (error) throw error;

      // Filter tabs based on user role
      const filteredTabs = (data || []).filter(tab => {
        if (!tab.required_role || tab.required_role.length === 0) return true;
        return tab.required_role.includes(currentUser?.role);
      });

      setTabConfig(filteredTabs);
    } catch (error) {
      console.error('Error loading tab configuration:', error);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="text-center py-8 text-muted-foreground">
          Loading settings...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
          {/* Company Profile Dropdown - Always visible */}
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
                  // Trigger create company dialog - navigate to admin page with create param
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
          <VoiceInterface 
            onTranscription={(text) => {
              console.log('Voice transcription:', text);
            }} 
            className="flex items-center gap-2"
          />
        </div>
      </div>

      <Tabs defaultValue={tabConfig[0]?.tab_key || "general"} className="space-y-6">
        <TabsList className="inline-flex h-auto w-full flex-wrap justify-start gap-1 bg-muted p-1">
          <TooltipProvider>
            {tabConfig.map(tab => {
              const IconComponent = (LucideIcons[tab.icon_name as keyof typeof LucideIcons] || LucideIcons.Settings) as React.ComponentType<{ className?: string }>;
              
              return (
                <Tooltip key={tab.tab_key}>
                  <TooltipTrigger asChild>
                    <TabsTrigger value={tab.tab_key} className="flex items-center gap-2">
                      <IconComponent className="h-4 w-4" />
                      {tab.label}
                    </TabsTrigger>
                  </TooltipTrigger>
                  {tab.description && (
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p>{tab.description}</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              );
            })}
          </TooltipProvider>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <GeneralSettings />
        </TabsContent>

        <TabsContent value="materials" className="space-y-6">
          <MaterialCatalogManager />
        </TabsContent>

        <TabsContent value="estimates" className="space-y-6">
          <EstimateBuilder />
        </TabsContent>

        <TabsContent value="commissions" className="space-y-6">
          <CommissionManagement />
        </TabsContent>

        <TabsContent value="suppliers" className="space-y-6">
          <SupplierManagement />
        </TabsContent>

        <TabsContent value="products" className="space-y-6">
          <ProductCatalogManager />
        </TabsContent>

        <TabsContent value="lead-sources" className="space-y-6">
          <LeadSources />
        </TabsContent>

        <TabsContent value="company" className="space-y-6">
          {/* Company Header Card */}
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

          {/* Locations Under This Company */}
          <LocationManagement />
        </TabsContent>

        <TabsContent value="users" className="space-y-6">
          <UserManagement />
        </TabsContent>

          <TabsContent value="quickbooks" className="space-y-6">
            <QuickBooksSettings />
            <JobTypeQBOMapping />
          </TabsContent>

        <TabsContent value="reports" className="space-y-6">
          <EnhancedErrorReportsManager />
        </TabsContent>

        <TabsContent value="automations" className="space-y-6">
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
        </TabsContent>

        <TabsContent value="approvals" className="space-y-6">
          <ManagerApprovalQueue />
        </TabsContent>

        <TabsContent value="health" className="space-y-6">
          <SystemHealthCheck />
        </TabsContent>

        <TabsContent value="developer" className="space-y-6">
          <DeveloperAccess />
        </TabsContent>

        <TabsContent value="integrations" className="space-y-6">
          <IntegrationsSettings />
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <SecurityAudit />
        </TabsContent>

        <TabsContent value="cache" className="space-y-6">
          <CacheManagement />
        </TabsContent>

        <TabsContent value="companies" className="space-y-6">
          <CompanyManagement />
        </TabsContent>

        <TabsContent value="company-activity" className="space-y-6">
          <CompanyActivityLog />
        </TabsContent>

        <TabsContent value="pricing" className="space-y-6">
          <PriceManagementDashboard />
        </TabsContent>

        <TabsContent value="measurements" className="space-y-6">
          <BatchRegenerationPanel />
        </TabsContent>

        <TabsContent value="quality-monitoring" className="space-y-6">
          <MeasurementQualityDashboard />
        </TabsContent>

        <TabsContent value="platform-admin" className="space-y-6">
          <PlatformAdmin />
        </TabsContent>

        <TabsContent value="edge-functions" className="space-y-6">
          <EdgeFunctionHealthDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
};