import { useState, useEffect } from "react";
import { BackButton } from "./BackButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { 
  DollarSign, 
  FileText, 
  Camera, 
  Calendar,
  MapPin,
  User,
  Phone,
  Mail,
  Home
} from "lucide-react";
import { toast } from "@/components/ui/use-toast";

interface ProjectDetailsProps {
  projectId: string;
  onBack: () => void;
}

const ProjectDetails = ({ projectId, onBack }: ProjectDetailsProps) => {
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProjectDetails();
  }, [projectId]);

  const fetchProjectDetails = async () => {
    try {
      setLoading(true);
      
      // Fetch project with related data
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select(`
          *,
          pipeline_entries!inner(
            *,
            contacts(*)
          ),
          estimates(*),
          project_costs(*),
          project_budget_snapshots(*)
        `)
        .eq('id', projectId)
        .single();

      if (projectError) throw projectError;
      setProject(projectData);
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

  const totalCosts = costs.reduce((sum: number, cost: any) => sum + Number(cost.total_cost), 0);
  const profitLoss = estimate ? Number(estimate.selling_price) - totalCosts : 0;

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
        <Badge variant="outline" className="bg-status-project text-white">
          {project.status}
        </Badge>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
              <DollarSign className={`h-4 w-4 ${profitLoss >= 0 ? 'text-success' : 'text-destructive'}`} />
              <div>
                <p className="text-sm text-muted-foreground">Profit/Loss</p>
                <p className={`text-lg font-bold ${profitLoss >= 0 ? 'text-success' : 'text-destructive'}`}>
                  ${profitLoss.toLocaleString()}
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
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="estimate">Estimate</TabsTrigger>
          <TabsTrigger value="costs">Costs</TabsTrigger>
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