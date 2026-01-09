import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  FileText, 
  DollarSign, 
  Calendar, 
  MapPin, 
  Phone,
  User,
  Eye,
  Send,
  Download,
  Filter,
  Loader2,
  CheckCircle,
  Clock,
  AlertCircle,
  FileX,
  GitBranch,
  History,
  Lock
} from "lucide-react";
import EstimateVersionControl from './EstimateVersionControl';
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { canViewAllEstimates } from '@/lib/roleUtils';

const Estimates = () => {
  const { user, loading: userLoading } = useCurrentUser();
  const [estimates, setEstimates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    salesRep: 'all',
    location: 'all',
    dateFrom: '',
    dateTo: '',
    status: 'all'
  });
  const [salesReps, setSalesReps] = useState([]);
  const [locations, setLocations] = useState([]);
  const [versionControlOpen, setVersionControlOpen] = useState(false);
  const [selectedEstimateId, setSelectedEstimateId] = useState<string | null>(null);
  const { toast } = useToast();
  
  const canSeeAllEstimates = user && canViewAllEstimates(user.role);

  const estimateStatuses = [
    { key: 'draft', label: 'Draft', color: 'bg-muted text-muted-foreground', icon: FileX },
    { key: 'pending', label: 'Pending', color: 'bg-warning text-warning-foreground', icon: Clock },
    { key: 'sent', label: 'Sent', color: 'bg-info text-info-foreground', icon: Send },
    { key: 'approved', label: 'Approved', color: 'bg-success text-success-foreground', icon: CheckCircle },
    { key: 'rejected', label: 'Rejected', color: 'bg-destructive text-destructive-foreground', icon: AlertCircle }
  ];

  useEffect(() => {
    if (user) {
      fetchEstimates();
    }
  }, [filters, user]);

  const fetchEstimates = async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      
      // Build query - enhanced_estimates has sales_rep_id directly
      // Use active_tenant_id if available, otherwise tenant_id
      const tenantId = user.active_tenant_id || user.tenant_id;
      
      let query = supabase
        .from('enhanced_estimates')
        .select('*')
        .eq('tenant_id', tenantId);

      // Apply role-based filter - users below sales_manager can only see their own estimates
      // Also include estimates where user is the creator (created_by field)
      if (!canSeeAllEstimates) {
        query = query.or(`sales_rep_id.eq.${user.id},created_by.eq.${user.id}`);
      }

      // Apply date filters
      if (filters.dateFrom) {
        query = query.gte('created_at', filters.dateFrom);
      }
      if (filters.dateTo) {
        query = query.lte('created_at', filters.dateTo + 'T23:59:59');
      }

      // Apply status filter
      if (filters.status && filters.status !== 'all') {
        query = query.eq('status', filters.status as any);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching estimates:', error);
        toast({
          title: "Error",
          description: `Failed to load estimates: ${error.message || 'Unknown error'}`,
          variant: "destructive",
        });
        setEstimates([]);
        return;
      }

      // Get unique sales rep IDs for fetching names
      const salesRepIds = [...new Set(data?.map(e => e.sales_rep_id).filter(Boolean))];
      
      // Fetch sales rep profiles
      let salesRepMap: Record<string, { first_name: string; last_name: string }> = {};
      if (salesRepIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', salesRepIds);
        
        profiles?.forEach(p => {
          salesRepMap[p.id] = { first_name: p.first_name, last_name: p.last_name };
        });
      }

      // Enrich estimates with sales rep info
      let enrichedData = (data || []).map(estimate => ({
        ...estimate,
        sales_rep: estimate.sales_rep_id ? salesRepMap[estimate.sales_rep_id] : null
      }));
      
      // Apply sales rep filter (for managers viewing all)
      if (filters.salesRep && filters.salesRep !== 'all') {
        enrichedData = enrichedData.filter(estimate => {
          const rep = estimate.sales_rep;
          return rep && `${rep.first_name} ${rep.last_name}` === filters.salesRep;
        });
      }
      
      if (filters.location && filters.location !== 'all') {
        enrichedData = enrichedData.filter(estimate => {
          return estimate.customer_address?.toLowerCase().includes(filters.location.toLowerCase());
        });
      }

      // Extract unique sales reps and locations for filter options
      const uniqueReps = [...new Set(enrichedData?.map(estimate => {
        const rep = estimate.sales_rep;
        return rep ? `${rep.first_name} ${rep.last_name}` : null;
      }).filter(Boolean))];
      
      const uniqueLocations = [...new Set(enrichedData?.map(estimate => 
        estimate.customer_address?.split(',')[1]?.trim() // Extract city from address
      ).filter(Boolean))];
      
      setSalesReps(uniqueReps);
      setLocations(uniqueLocations);
      setEstimates(enrichedData);
    } catch (error) {
      console.error('Error in fetchEstimates:', error);
      toast({
        title: "Error",
        description: "Failed to load estimates",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount) => {
    if (!amount) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatAddress = (contact) => {
    if (!contact) return 'No address';
    return `${contact.address_street}, ${contact.address_city}, ${contact.address_state} ${contact.address_zip}`;
  };

  const formatName = (contact) => {
    if (!contact) return 'Unknown';
    return `${contact.first_name} ${contact.last_name}`;
  };

  const getStatusInfo = (status) => {
    return estimateStatuses.find(s => s.key === status) || estimateStatuses[0];
  };

  const handleVersionHistory = (estimateId: string) => {
    setSelectedEstimateId(estimateId);
    setVersionControlOpen(true);
  };

  const handleVersionRollback = () => {
    // Refresh estimates after rollback
    fetchEstimates();
    toast({
      title: "Success",
      description: "Estimate has been updated to the selected version",
    });
  };

  const renderEstimateCard = (estimate) => {
    const salesRep = estimate.sales_rep;
    const statusInfo = getStatusInfo(estimate.status);
    
    return (
      <Card key={estimate.id} className="shadow-soft border-0 hover:shadow-medium transition-smooth">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <span className="font-mono text-sm text-muted-foreground">
                {estimate.estimate_number || `EST-${estimate.id.slice(-4)}`}
              </span>
              <h3 className="font-semibold">{estimate.customer_name || 'Unknown Customer'}</h3>
              {salesRep && (
                <p className="text-sm text-muted-foreground">
                  Rep: {salesRep.first_name} {salesRep.last_name}
                </p>
              )}
            </div>
            <Badge className={statusInfo.color}>
              <statusInfo.icon className="h-3 w-3 mr-1" />
              {statusInfo.label}
            </Badge>
          </div>
          
          <div className="space-y-2 text-sm">
            {estimate.customer_address && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span>{estimate.customer_address}</span>
              </div>
            )}
            
            <div className="flex items-center gap-2 text-primary font-medium">
              <FileText className="h-4 w-4" />
              <span>{estimate.roof_pitch ? `${estimate.roof_pitch} Pitch` : 'Roofing Project'}</span>
              {estimate.roof_area_sq_ft && (
                <span className="text-muted-foreground">• {estimate.roof_area_sq_ft.toLocaleString()} sq ft</span>
              )}
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2 font-semibold">
                <DollarSign className="h-4 w-4 text-success" />
                <span>{formatCurrency(estimate.selling_price)}</span>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                Margin: {estimate.actual_profit_percent ? `${Number(estimate.actual_profit_percent).toFixed(1)}%` : 'TBD'}
              </div>
            </div>

            {/* Cost Breakdown */}
            <div className="mt-3 pt-3 border-t">
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>Material: {formatCurrency(estimate.material_cost)}</div>
                <div>Labor: {formatCurrency(estimate.labor_cost)}</div>
                <div>Overhead: {formatCurrency(estimate.overhead_amount)}</div>
                <div>Profit: {formatCurrency(estimate.actual_profit_amount)}</div>
              </div>
            </div>

            {/* Estimate Details */}
            <div className="mt-3 pt-3 border-t">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Created: {new Date(estimate.created_at).toLocaleDateString()}</span>
                {estimate.expires_at && (
                  <span>Expires: {new Date(estimate.expires_at).toLocaleDateString()}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <Button size="sm" variant="outline" className="flex-1">
              <Eye className="h-4 w-4 mr-1" />
              View
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              className="flex-1"
              onClick={() => handleVersionHistory(estimate.id)}
            >
              <History className="h-4 w-4 mr-1" />
              History
            </Button>
            <Button size="sm" variant="outline" className="flex-1">
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
            {estimate.status === 'draft' && (
              <Button size="sm" className="flex-1">
                <Send className="h-4 w-4 mr-1" />
                Send
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  // Show loading state while user is being fetched
  if (userLoading || !user) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Loading...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
              Estimates
            </h1>
            <p className="text-muted-foreground">
              {canSeeAllEstimates 
                ? "View all company estimates" 
                : "Your assigned estimates"}
            </p>
          </div>
          {!canSeeAllEstimates && (
            <Badge variant="outline" className="h-fit">
              <Lock className="h-3 w-3 mr-1" />
              My Estimates Only
            </Badge>
          )}
        </div>
        <Button className="gradient-primary">
          <FileText className="h-4 w-4 mr-2" />
          Create Estimate
        </Button>
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
                  {estimateStatuses.map(status => (
                    <SelectItem key={status.key} value={status.key}>{status.label}</SelectItem>
                  ))}
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
          <span className="ml-2">Loading estimates...</span>
        </div>
      ) : (
        /* Estimates Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {estimates.length > 0 ? (
            estimates.map((estimate) => renderEstimateCard(estimate))
          ) : (
            <div className="col-span-full text-center py-12">
              <FileText className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No estimates found</h3>
              <p className="text-muted-foreground mb-4">
                {!canSeeAllEstimates 
                  ? "You don't have any assigned estimates yet. Create your first estimate or ask a manager to assign leads to you."
                  : Object.values(filters).some(f => f !== 'all' && f !== '') 
                    ? "Try adjusting your filters or create a new estimate"
                    : "Create your first estimate to get started"
                }
              </p>
              <Button className="gradient-primary">
                <FileText className="h-4 w-4 mr-2" />
                Create Estimate
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Version Control Dialog */}
      {selectedEstimateId && (
        <EstimateVersionControl
          estimateId={selectedEstimateId}
          open={versionControlOpen}
          onOpenChange={setVersionControlOpen}
          onVersionRollback={handleVersionRollback}
        />
      )}
    </div>
  );
};

export default Estimates;