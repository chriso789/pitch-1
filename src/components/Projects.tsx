import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  HomeIcon, 
  DollarSign, 
  Calendar, 
  MapPin, 
  Phone,
  User,
  Eye,
  TrendingUp,
  Filter,
  Loader2,
  CheckCircle,
  CreditCard,
  Briefcase
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ProjectData {
  id: string;
  project_number: string;
  name: string;
  homeowner: string;
  address: string;
  phone: string;
  sales_rep: string;
  converted_date: string;
  contract_value: number;
  gross_profit: number;
  gross_profit_percent: number;
  collected_amount: number;
  remaining_balance: number;
  status: string;
  roof_type: string;
}

const Projects = () => {
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [filteredProjects, setFilteredProjects] = useState<ProjectData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    salesRep: 'all',
    location: 'all',
    dateFrom: '',
    dateTo: '',
    status: 'all'
  });
  const [salesReps, setSalesReps] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [filters, projects]);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      
      // Fetch all projects that have been converted (status = 'project')
      const { data: projectsData, error } = await supabase
        .from('projects')
        .select(`
          *,
          pipeline_entries!inner(
            *,
            contacts(
              first_name,
              last_name,
              phone,
              address_street,
              address_city,
              address_state,
              address_zip
            ),
            profiles!pipeline_entries_assigned_to_fkey(
              first_name,
              last_name
            )
          ),
          estimates(
            selling_price,
            material_cost,
            labor_cost,
            overhead_amount,
            actual_profit,
            actual_margin_percent
          ),
          payments(
            amount,
            status
          ),
          project_costs(
            total_cost
          )
        `)
        .eq('pipeline_entries.status', 'project')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching projects:', error);
        toast({
          title: "Error",
          description: "Failed to load projects",
          variant: "destructive",
        });
        return;
      }

      // Transform the data
      const transformedProjects: ProjectData[] = projectsData.map((project: any) => {
        const pipelineEntry = project.pipeline_entries;
        const contact = pipelineEntry?.contacts;
        const profile = pipelineEntry?.profiles;
        const estimate = project.estimates?.[0];
        const payments = project.payments || [];
        const costs = project.project_costs || [];

        // Calculate totals
        const contractValue = estimate?.selling_price || 0;
        const totalCosts = costs.reduce((sum: number, cost: any) => sum + (cost.total_cost || 0), 0);
        const materialCosts = estimate?.material_cost || 0;
        const laborCosts = estimate?.labor_cost || 0;
        const overheadCosts = estimate?.overhead_amount || 0;
        
        // Gross profit = contract value - material costs - labor costs - overhead - project costs
        const grossProfit = contractValue - materialCosts - laborCosts - overheadCosts - totalCosts;
        const grossProfitPercent = contractValue > 0 ? (grossProfit / contractValue) * 100 : 0;

        // Calculate collected amount (only from completed payments)
        const collectedAmount = payments
          .filter((payment: any) => payment.status === 'completed')
          .reduce((sum: number, payment: any) => sum + (payment.amount || 0), 0);

        const remainingBalance = contractValue - collectedAmount;

        return {
          id: project.id,
          project_number: project.project_number || `PROJ-${project.id.slice(-4)}`,
          name: project.name,
          homeowner: contact ? `${contact.first_name} ${contact.last_name}` : 'Unknown',
          address: contact ? `${contact.address_street}, ${contact.address_city}, ${contact.address_state}` : 'Unknown',
          phone: contact?.phone || '',
          sales_rep: profile ? `${profile.first_name} ${profile.last_name}` : 'Unknown',
          converted_date: project.created_at,
          contract_value: contractValue,
          gross_profit: grossProfit,
          gross_profit_percent: grossProfitPercent,
          collected_amount: collectedAmount,
          remaining_balance: remainingBalance,
          status: project.status,
          roof_type: pipelineEntry?.roof_type || 'Roofing Project'
        };
      });

      setProjects(transformedProjects);
      
      // Extract unique values for filters
      const uniqueReps = [...new Set(transformedProjects.map(p => p.sales_rep).filter(Boolean))];
      const uniqueLocations = [...new Set(transformedProjects.map(p => {
        const cityMatch = p.address.match(/,\s*([^,]+),/);
        return cityMatch ? cityMatch[1].trim() : null;
      }).filter(Boolean))];
      
      setSalesReps(uniqueReps);
      setLocations(uniqueLocations);

    } catch (error) {
      console.error('Error in fetchProjects:', error);
      toast({
        title: "Error",
        description: "Failed to load projects",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...projects];

    if (filters.salesRep && filters.salesRep !== 'all') {
      filtered = filtered.filter(project => project.sales_rep === filters.salesRep);
    }

    if (filters.location && filters.location !== 'all') {
      filtered = filtered.filter(project => 
        project.address.toLowerCase().includes(filters.location.toLowerCase())
      );
    }

    if (filters.status && filters.status !== 'all') {
      filtered = filtered.filter(project => project.status === filters.status);
    }

    if (filters.dateFrom) {
      filtered = filtered.filter(project => 
        new Date(project.converted_date) >= new Date(filters.dateFrom)
      );
    }

    if (filters.dateTo) {
      filtered = filtered.filter(project => 
        new Date(project.converted_date) <= new Date(filters.dateTo + 'T23:59:59')
      );
    }

    setFilteredProjects(filtered);
  };

  const formatCurrency = (amount: number) => {
    if (!amount) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    const colors = {
      "active": "bg-status-project text-white",
      "completed": "bg-status-completed text-white", 
      "on-hold": "bg-status-contingency text-white",
      "cancelled": "bg-status-closed text-white"
    };
    return colors[status as keyof typeof colors] || "bg-muted";
  };

  const getCollectionStatus = (collected: number, total: number) => {
    if (total === 0) return { status: 'unknown', color: 'bg-muted' };
    const percentage = (collected / total) * 100;
    
    if (percentage >= 100) return { status: 'paid', color: 'bg-success' };
    if (percentage >= 75) return { status: 'mostly-paid', color: 'bg-warning' };
    if (percentage >= 25) return { status: 'partial', color: 'bg-info' };
    return { status: 'minimal', color: 'bg-destructive' };
  };

  const renderProjectCard = (project: ProjectData) => {
    const collectionStatus = getCollectionStatus(project.collected_amount, project.contract_value);
    
    return (
      <Card key={project.id} className="shadow-soft border-0 hover:shadow-medium transition-smooth">
        <CardContent className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <span className="font-mono text-sm text-muted-foreground">
                {project.project_number}
              </span>
              <h3 className="font-semibold text-lg">{project.homeowner}</h3>
              <p className="text-sm text-muted-foreground">Rep: {project.sales_rep}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Badge className={getStatusColor(project.status)}>
                {project.status}
              </Badge>
              <Badge className={collectionStatus.color + " text-white"}>
                {Math.round((project.collected_amount / project.contract_value) * 100)}% Collected
              </Badge>
            </div>
          </div>
          
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span className="text-sm">{project.address}</span>
            </div>
            
            {project.phone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-4 w-4" />
                <span className="text-sm">{project.phone}</span>
              </div>
            )}
            
            <div className="flex items-center gap-2 text-primary font-medium">
              <HomeIcon className="h-4 w-4" />
              <span className="text-sm">{project.roof_type}</span>
            </div>
            
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span className="text-sm">
                Converted: {new Date(project.converted_date).toLocaleDateString()}
              </span>
            </div>

            {/* Financial Overview */}
            <div className="mt-4 pt-4 border-t space-y-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center gap-2 font-semibold">
                    <DollarSign className="h-4 w-4 text-success" />
                    <span>Contract Value</span>
                  </div>
                  <div className="text-lg font-bold">{formatCurrency(project.contract_value)}</div>
                </div>
                <div>
                  <div className="flex items-center gap-2 font-semibold">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    <span>Gross Profit</span>
                  </div>
                  <div className="text-lg font-bold">
                    {formatCurrency(project.gross_profit)}
                    <span className="text-sm text-muted-foreground ml-2">
                      ({project.gross_profit_percent.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div>
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle className="h-4 w-4 text-success" />
                    <span>Collected</span>
                  </div>
                  <div className="text-lg font-bold text-success">
                    {formatCurrency(project.collected_amount)}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2 font-semibold">
                    <CreditCard className="h-4 w-4 text-warning" />
                    <span>Remaining</span>
                  </div>
                  <div className="text-lg font-bold text-warning">
                    {formatCurrency(project.remaining_balance)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-2 mt-6">
            <Button size="sm" variant="outline" className="flex-1">
              <Eye className="h-4 w-4 mr-1" />
              View Details
            </Button>
            <Button size="sm" variant="outline" className="flex-1">
              <Briefcase className="h-4 w-4 mr-1" />
              Manage
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            Projects
          </h1>
          <p className="text-muted-foreground">
            All converted projects from pipeline to active jobs
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-2xl font-bold">
              {formatCurrency(filteredProjects.reduce((sum, p) => sum + p.contract_value, 0))}
            </div>
            <div className="text-sm text-muted-foreground">Total Contract Value</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <Card className="shadow-soft border-0">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Sales Rep</label>
              <Select value={filters.salesRep} onValueChange={(value) => setFilters(prev => ({ ...prev, salesRep: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="All Reps" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Reps</SelectItem>
                  {salesReps.map(rep => (
                    <SelectItem key={rep} value={rep}>{rep}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <label className="text-sm font-medium mb-2 block">Location</label>
              <Select value={filters.location} onValueChange={(value) => setFilters(prev => ({ ...prev, location: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {locations.map(location => (
                    <SelectItem key={location} value={location}>{location}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Status</label>
              <Select value={filters.status} onValueChange={(value) => setFilters(prev => ({ ...prev, status: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="on-hold">On Hold</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <label className="text-sm font-medium mb-2 block">Date From</label>
              <Input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
              />
            </div>
            
            <div>
              <label className="text-sm font-medium mb-2 block">Date To</label>
              <Input
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
              />
            </div>
          </div>
          
          {(filters.salesRep !== 'all' || filters.location !== 'all' || filters.status !== 'all' || filters.dateFrom || filters.dateTo) && (
            <div className="mt-4">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setFilters({ salesRep: 'all', location: 'all', status: 'all', dateFrom: '', dateTo: '' })}
              >
                <Filter className="h-4 w-4 mr-2" />
                Clear Filters
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading projects...</span>
        </div>
      ) : (
        /* Projects Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.length > 0 ? (
            filteredProjects.map((project) => renderProjectCard(project))
          ) : (
            <div className="col-span-full text-center py-12">
              <HomeIcon className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No projects found</h3>
              <p className="text-muted-foreground mb-4">
                {Object.values(filters).some(f => f !== 'all' && f !== '') 
                  ? "Try adjusting your filters to see more projects"
                  : "No projects have been converted from the pipeline yet"
                }
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Projects;