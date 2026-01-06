import { useState, useEffect } from "react";
import { BackButton } from "@/shared/components/BackButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { BudgetTracker } from "./BudgetTracker";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CostReconciliationPanel } from "@/components/production/CostReconciliationPanel";
import { InvoiceUploadCard } from "@/components/production/InvoiceUploadCard";
import { 
  DollarSign, 
  FileText, 
  Camera, 
  Calendar,
  MapPin,
  User,
  Phone,
  Mail,
  Home,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Clock,
  Calculator,
  Upload,
  Target,
  BarChart3,
  RefreshCw,
  ClipboardCheck
} from "lucide-react";

interface ProjectDetailsProps {
  projectId: string;
  onBack: () => void;
}

interface BudgetItem {
  id: string;
  category: string;
  item_name: string;
  description?: string;
  budgeted_quantity: number;
  budgeted_unit_cost: number;
  budgeted_total_cost: number;
  actual_quantity: number;
  actual_unit_cost: number;
  actual_total_cost: number;
  variance_amount: number;
  variance_percent: number;
  vendor_name?: string;
  purchase_order_number?: string;
}

const ProjectDetails = ({ projectId, onBack }: ProjectDetailsProps) => {
  const { toast } = useToast();
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([]);
  const [commission, setCommission] = useState<any>(null);
  const [syncingToQBO, setSyncingToQBO] = useState(false);
  const [qboConnection, setQboConnection] = useState<any>(null);

  useEffect(() => {
    fetchProjectDetails();
    checkQBOConnection();
  }, [projectId]);

  const checkQBOConnection = async () => {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      if (!profile) return;

      const { data } = await supabase
        .from('qbo_connections' as any)
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .maybeSingle();

      setQboConnection(data);
    } catch (error) {
      console.error('Error checking QBO connection:', error);
    }
  };

  const handleSyncToQBO = async () => {
    if (!qboConnection) {
      toast({
        title: "QuickBooks Not Connected",
        description: "Please connect QuickBooks in Settings first",
        variant: "destructive",
      });
      return;
    }

    setSyncingToQBO(true);
    try {
      const contact = project.pipeline_entries?.contacts;
      
      const { data, error } = await supabase.functions.invoke('qbo-worker', {
        body: {
          op: 'syncProject',
          args: {
            tenant_id: project.tenant_id,
            realm_id: qboConnection.realm_id,
            customer_id: contact?.id,
            job_id: projectId,
            job_name: project.name,
            mode: 'auto'
          }
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: "Project Synced",
          description: "Project has been synced to QuickBooks successfully",
        });
        await fetchProjectDetails();
      } else {
        throw new Error(data?.message || "Failed to sync project");
      }
    } catch (error: any) {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSyncingToQBO(false);
    }
  };

  const fetchProjectDetails = async () => {
    try {
      setLoading(true);
      
      // Fetch project with related data
      const [projectResult, budgetItemsResult] = await Promise.all([
        supabase
          .from('projects')
          .select(`
            *,
            pipeline_entries!inner(
              *,
              contacts(*),
              profiles!pipeline_entries_assigned_to_fkey(
                id,
                first_name,
                last_name,
                personal_overhead_rate
              )
            ),
            estimates(*),
            project_costs(*),
            project_budget_snapshots(*)
          `)
          .eq('id', projectId)
          .single(),
        supabase
          .from('project_budget_items')
          .select('*')
          .eq('project_id', projectId)
          .order('category, item_name')
      ]);

      if (projectResult.error) throw projectResult.error;
      setProject(projectResult.data);
      setBudgetItems(budgetItemsResult.data || []);

      // Calculate commission if there's a sales rep using enhanced function
      const salesRep = projectResult.data?.pipeline_entries?.profiles;
      if (salesRep) {
        const { data: commissionData } = await supabase.rpc('calculate_enhanced_rep_commission', {
          project_id_param: projectId,
          sales_rep_id_param: salesRep.id
        });
        setCommission(commissionData);
      }
    } catch (error) {
      console.error('Error fetching project details:', error);
      toast({
        title: "Error",
        description: "Failed to load project details",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-6">Loading project details...</div>;
  }

  if (!project) {
    return <div className="p-6">Project not found</div>;
  }

  const contact = project.pipeline_entries?.contacts;
  const estimate = project.estimates?.[0];
  const costs = project.project_costs || [];
  const budget = project.project_budget_snapshots?.[0]?.original_budget;
  const salesRep = project.pipeline_entries?.profiles;

  const totalCosts = costs.reduce((sum: number, cost: any) => sum + Number(cost.total_cost), 0);
  const totalBudgetedCosts = budgetItems.reduce((sum: number, item: BudgetItem) => sum + Number(item.budgeted_total_cost), 0);
  const totalActualCosts = budgetItems.reduce((sum: number, item: BudgetItem) => sum + Number(item.actual_total_cost), 0);
  const budgetVariance = totalActualCosts - totalBudgetedCosts;
  const budgetVariancePercent = totalBudgetedCosts > 0 ? (budgetVariance / totalBudgetedCosts) * 100 : 0;
  const grossProfit = estimate ? Number(estimate.selling_price) - totalCosts - totalActualCosts : 0;
  const netProfit = commission ? commission.net_profit || 0 : grossProfit;
  const companyProfit = commission ? commission.company_profit || 0 : grossProfit;

  return (
    <div className="space-y-6">
      <BackButton onClick={onBack} />
      
      {/* Project Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            {project.name}
          </h1>
          <p className="text-muted-foreground mt-1">
            Project #{project.project_number}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-status-project text-white">
            {project.status}
          </Badge>
          {qboConnection && (
            <Button 
              onClick={handleSyncToQBO}
              disabled={syncingToQBO}
              variant="outline"
              size="sm"
            >
              {syncingToQBO ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Syncing...
                </>
              ) : (
                "Sync to QBO"
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-success" />
              <div>
                <p className="text-sm text-muted-foreground">Contract Value</p>
                <p className="text-lg font-bold">
                  {estimate ? `$${Number(estimate.selling_price).toLocaleString()}` : 'N/A'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-warning" />
              <div>
                <p className="text-sm text-muted-foreground">Total Costs</p>
                <p className="text-lg font-bold">${totalCosts.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <DollarSign className={`h-4 w-4 ${grossProfit >= 0 ? 'text-success' : 'text-destructive'}`} />
              <div>
                <p className="text-sm text-muted-foreground">Gross Profit</p>
                <p className={`text-lg font-bold ${grossProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                  ${grossProfit.toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <DollarSign className={`h-4 w-4 ${netProfit >= 0 ? 'text-success' : 'text-destructive'}`} />
              <div>
                <p className="text-sm text-muted-foreground">Net Profit</p>
                <p className={`text-lg font-bold ${netProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                  ${netProfit.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">After overhead</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Target className={`h-4 w-4 ${budgetVariance <= 0 ? 'text-success' : 'text-warning'}`} />
              <div>
                <p className="text-sm text-muted-foreground">Budget Variance</p>
                <p className={`text-lg font-bold ${budgetVariance <= 0 ? 'text-success' : 'text-warning'}`}>
                  {budgetVariance >= 0 ? '+' : ''}${budgetVariance.toLocaleString()}
                  <span className="text-xs ml-1">
                    ({budgetVariancePercent >= 0 ? '+' : ''}{budgetVariancePercent.toFixed(1)}%)
                  </span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Est. Completion</p>
                <p className="text-sm font-medium">
                  {project.estimated_completion_date 
                    ? new Date(project.estimated_completion_date).toLocaleDateString()
                    : 'TBD'
                  }
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="budget">Budget</TabsTrigger>
          <TabsTrigger value="cost-verification" className="flex items-center gap-1">
            <ClipboardCheck className="h-3 w-3" />
            Cost Verification
          </TabsTrigger>
          <TabsTrigger value="estimate">Estimate</TabsTrigger>
          <TabsTrigger value="commission">Commission</TabsTrigger>
          <TabsTrigger value="costs">Costs</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="photos">Photos</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Customer Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Customer Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {contact && (
                  <>
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span>{contact.first_name} {contact.last_name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span>{contact.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span>{contact.phone}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Home className="h-4 w-4 text-muted-foreground" />
                      <span>
                        {contact.address_street}, {contact.address_city}, {contact.address_state} {contact.address_zip}
                      </span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Project Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Project Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">Start Date</p>
                  <p className="font-medium">
                    {project.start_date 
                      ? new Date(project.start_date).toLocaleDateString()
                      : 'Not set'
                    }
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Description</p>
                  <p className="font-medium">{project.description || 'No description'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <Badge variant="outline">{project.status}</Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="budget" className="space-y-4">
          <BudgetTracker 
            projectId={projectId} 
            budgetItems={budgetItems}
            onRefresh={fetchProjectDetails}
          />
        </TabsContent>

        <TabsContent value="cost-verification" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <CostReconciliationPanel projectId={projectId} />
            </div>
            <div className="space-y-4">
              <InvoiceUploadCard
                projectId={projectId}
                invoiceType="material"
                onSuccess={fetchProjectDetails}
              />
              <InvoiceUploadCard
                projectId={projectId}
                invoiceType="labor"
                onSuccess={fetchProjectDetails}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="estimate">
          {estimate ? (
            <Card>
              <CardHeader>
                <CardTitle>Estimate Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Material Cost</p>
                    <p className="text-lg font-bold">${Number(estimate.material_cost).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Labor Cost</p>
                    <p className="text-lg font-bold">${Number(estimate.labor_cost).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Overhead</p>
                    <p className="text-lg font-bold">${Number(estimate.overhead_amount).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Profit Margin</p>
                    <p className="text-lg font-bold">{Number(estimate.actual_margin_percent).toFixed(1)}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No estimate available for this project
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="commission" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                Sales Representative Commission
              </CardTitle>
            </CardHeader>
            <CardContent>
              {salesRep && commission ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="font-medium mb-3">Representative Details</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Name:</span>
                          <span>{salesRep.first_name} {salesRep.last_name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Personal Overhead Rate:</span>
                          <span>{salesRep.personal_overhead_rate || 0}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Payment Method:</span>
                          <span className="capitalize">
                            {commission.payment_method?.replace('_', ' ') || 'Percentage of selling price'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium mb-3">Commission Breakdown</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Contract Value:</span>
                          <span>${commission.contract_value?.toLocaleString() || 0}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Total Costs:</span>
                          <span>${commission.total_costs?.toLocaleString() || 0}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Gross Profit:</span>
                          <span>${commission.gross_profit?.toLocaleString() || 0}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Rep Overhead ({commission.rep_overhead_rate}%):</span>
                          <span>${commission.rep_overhead?.toLocaleString() || 0}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Net Profit:</span>
                          <span>${commission.net_profit?.toLocaleString() || 0}</span>
                        </div>
                        <hr />
                        <div className="flex justify-between font-semibold">
                          <span>Rep Commission ({commission.commission_rate}%):</span>
                          <span className="text-success text-lg">
                            ${commission.commission_amount?.toLocaleString() || 0}
                          </span>
                        </div>
                        <div className="flex justify-between font-semibold">
                          <span>Company Profit:</span>
                          <span className="text-primary">
                            ${commission.company_profit?.toLocaleString() || 0}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-6 p-4 bg-muted/30 rounded-lg">
                    <h4 className="font-medium mb-2">Commission Summary</h4>
                    <p className="text-sm text-muted-foreground mb-2">
                      {commission.calculation_details?.structure_explanation}
                    </p>
                    <div className="flex justify-between items-center text-sm">
                      <span>Profit Margin:</span>
                      <span className="font-medium">{commission.profit_margin_percent?.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Calculator className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No sales representative assigned or commission data available</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="costs">
          <Card>
            <CardHeader>
              <CardTitle>Project Costs</CardTitle>
            </CardHeader>
            <CardContent>
              {costs.length > 0 ? (
                <div className="space-y-3">
                  {costs.map((cost: any) => (
                    <div key={cost.id} className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium">{cost.description}</p>
                        <p className="text-sm text-muted-foreground">
                          {cost.vendor_name} - {new Date(cost.cost_date).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">${Number(cost.total_cost).toLocaleString()}</p>
                        <p className="text-sm text-muted-foreground">{cost.cost_type}</p>
                      </div>
                    </div>
                  ))}
                  <div className="pt-3 border-t">
                    <div className="flex justify-between items-center font-bold text-lg">
                      <span>Total Costs:</span>
                      <span>${totalCosts.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-center text-muted-foreground">No costs recorded yet</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeline" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Project Timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Project Progress</p>
                    <p className="text-sm text-muted-foreground">
                      Started: {project.start_date 
                        ? new Date(project.start_date).toLocaleDateString()
                        : 'Not set'
                      }
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold">
                      {project.status === 'completed' ? '100' : 
                       project.status === 'active' ? '45' : '0'}%
                    </p>
                    <p className="text-sm text-muted-foreground">Complete</p>
                  </div>
                </div>
                
                <Progress 
                  value={project.status === 'completed' ? 100 : 
                         project.status === 'active' ? 45 : 0} 
                  className="h-2"
                />
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                  <div>
                    <h4 className="font-medium mb-3">Key Milestones</h4>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 bg-success rounded-full" />
                        <div>
                          <p className="text-sm font-medium">Project Started</p>
                          <p className="text-xs text-muted-foreground">
                            {project.start_date 
                              ? new Date(project.start_date).toLocaleDateString()
                              : 'Pending'
                            }
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${
                          project.status === 'active' ? 'bg-warning' : 'bg-muted'
                        }`} />
                        <div>
                          <p className="text-sm font-medium">Materials Ordered</p>
                          <p className="text-xs text-muted-foreground">
                            {project.status === 'active' ? 'In Progress' : 'Pending'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${
                          project.status === 'completed' ? 'bg-success' : 'bg-muted'
                        }`} />
                        <div>
                          <p className="text-sm font-medium">Project Completed</p>
                          <p className="text-xs text-muted-foreground">
                            {project.estimated_completion_date 
                              ? `Est. ${new Date(project.estimated_completion_date).toLocaleDateString()}`
                              : 'TBD'
                            }
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium mb-3">Upcoming Tasks</h4>
                    <div className="space-y-2">
                      <div className="p-2 bg-muted/30 rounded">
                        <p className="text-sm font-medium">Schedule material delivery</p>
                        <p className="text-xs text-muted-foreground">Due in 3 days</p>
                      </div>
                      <div className="p-2 bg-muted/30 rounded">
                        <p className="text-sm font-medium">Crew assignment</p>
                        <p className="text-xs text-muted-foreground">Due in 5 days</p>
                      </div>
                      <div className="p-2 bg-muted/30 rounded">
                        <p className="text-sm font-medium">Quality inspection</p>
                        <p className="text-xs text-muted-foreground">After completion</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="photos">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="h-5 w-5" />
                Project Photos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center text-muted-foreground py-8">
                Photo gallery coming soon...
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Project Documents
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center text-muted-foreground py-8">
                Document library coming soon...
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ProjectDetails;