import React, { useState, useEffect, useCallback } from 'react';
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
import { CreateEstimateDialog } from '@/components/estimates/CreateEstimateDialog';
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
  const [showCreateEstimate, setShowCreateEstimate] = useState(false);
  const { toast } = useToast();
  
  // Extract stable primitive values to avoid infinite re-renders
  const userId = user?.id;
  const tenantId = user?.active_tenant_id || user?.tenant_id;
  const userRole = user?.role;
  const canSeeAllEstimates = userRole ? canViewAllEstimates(userRole) : false;

  const estimateStatuses = [
    { key: 'draft', label: 'Draft', color: 'bg-muted text-muted-foreground', icon: FileX },
    { key: 'pending', label: 'Pending', color: 'bg-warning text-warning-foreground', icon: Clock },
    { key: 'sent', label: 'Sent', color: 'bg-info text-info-foreground', icon: Send },
    { key: 'approved', label: 'Approved', color: 'bg-success text-success-foreground', icon: CheckCircle },
    { key: 'rejected', label: 'Rejected', color: 'bg-destructive text-destructive-foreground', icon: AlertCircle }
  ];

  // Use stable primitives as dependencies instead of user object
  useEffect(() => {
    if (userId && tenantId) {
      fetchEstimates();
    }
  }, [filters, userId, tenantId, userRole]);

  const fetchEstimates = async () => {
    if (!userId || !tenantId) return;
    
    try {
      setLoading(true);
      
      // Build query - enhanced_estimates has sales_rep_id directly
      let query = supabase
        .from('enhanced_estimates')
        .select('*')
        .eq('tenant_id', tenantId);

      // Apply role-based filter - users below sales_manager can only see their own estimates
      // Also include estimates where user is the creator (created_by field)
      if (!canSeeAllEstimates) {
        query = query.or(`sales_rep_id.eq.${userId},created_by.eq.${userId}`);
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

  // Navigate to the lead with estimate tab
  const handleViewEstimate = (estimate: any) => {
    if (estimate.pipeline_entry_id) {
      window.location.href = `/lead/${estimate.pipeline_entry_id}?tab=estimate`;
    } else {
      toast({
        title: "Cannot open estimate",
        description: "This estimate is not linked to a lead.",
        variant: "destructive",
      });
    }
  };

  // Send estimate (update status)
  const handleSendEstimate = async (estimate: any) => {
    try {
      const { error } = await supabase
        .from('enhanced_estimates')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString()
        })
        .eq('id', estimate.id);

      if (error) throw error;

      toast({
        title: "Estimate Sent",
        description: `Estimate ${estimate.estimate_number || estimate.id.slice(-4)} has been marked as sent.`,
      });
      fetchEstimates();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to send estimate",
        variant: "destructive",
      });
    }
  };

  // Export estimate as PDF (placeholder - opens view)
  const handleExportEstimate = (estimate: any) => {
    if (estimate.pipeline_entry_id) {
      window.location.href = `/lead/${estimate.pipeline_entry_id}?tab=estimate&export=true`;
    } else {
      toast({
        title: "Cannot export estimate",
        description: "This estimate is not linked to a lead.",
        variant: "destructive",
      });
    }
  };

  // Render estimate as a table row
  const renderEstimateRow = (estimate: any) => {
    const salesRep = estimate.sales_rep;
    const statusInfo = getStatusInfo(estimate.status);
    
    return (
      <tr key={estimate.id} className="border-b hover:bg-muted/50 transition-colors">
        <td className="p-3">
          <span className="font-mono text-sm">
            {estimate.estimate_number || `EST-${estimate.id.slice(-4)}`}
          </span>
        </td>
        <td className="p-3">
          <div>
            <div className="font-medium">{estimate.customer_name || 'Unknown'}</div>
            {estimate.customer_address && (
              <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                {estimate.customer_address}
              </div>
            )}
          </div>
        </td>
        <td className="p-3">
          {salesRep ? `${salesRep.first_name} ${salesRep.last_name}` : '-'}
        </td>
        <td className="p-3 font-semibold text-success">
          {formatCurrency(estimate.selling_price)}
        </td>
        <td className="p-3">
          <Badge className={statusInfo.color}>
            <statusInfo.icon className="h-3 w-3 mr-1" />
            {statusInfo.label}
          </Badge>
        </td>
        <td className="p-3 text-sm text-muted-foreground">
          {new Date(estimate.created_at).toLocaleDateString()}
        </td>
        <td className="p-3">
          <div className="flex gap-1">
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={() => handleViewEstimate(estimate)}
              title="View Estimate"
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button 
              size="sm" 
              variant="ghost"
              onClick={() => handleVersionHistory(estimate.id)}
              title="Version History"
            >
              <History className="h-4 w-4" />
            </Button>
            <Button 
              size="sm" 
              variant="ghost"
              onClick={() => handleExportEstimate(estimate)}
              title="Export PDF"
            >
              <Download className="h-4 w-4" />
            </Button>
            {estimate.status === 'draft' && (
              <Button 
                size="sm" 
                variant="ghost"
                onClick={() => handleSendEstimate(estimate)}
                title="Send Estimate"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </td>
      </tr>
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
        <Button className="gradient-primary" onClick={() => setShowCreateEstimate(true)}>
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
      ) : estimates.length > 0 ? (
        /* Estimates Table */
        <Card className="shadow-soft border-0">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr className="border-b">
                    <th className="p-3 text-left text-sm font-medium">Estimate #</th>
                    <th className="p-3 text-left text-sm font-medium">Customer</th>
                    <th className="p-3 text-left text-sm font-medium">Sales Rep</th>
                    <th className="p-3 text-left text-sm font-medium">Total</th>
                    <th className="p-3 text-left text-sm font-medium">Status</th>
                    <th className="p-3 text-left text-sm font-medium">Created</th>
                    <th className="p-3 text-left text-sm font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {estimates.map((estimate) => renderEstimateRow(estimate))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="text-center py-12">
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
          <Button className="gradient-primary" onClick={() => setShowCreateEstimate(true)}>
            <FileText className="h-4 w-4 mr-2" />
            Create Estimate
          </Button>
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

      {/* Create Estimate Dialog */}
      <CreateEstimateDialog
        open={showCreateEstimate}
        onOpenChange={setShowCreateEstimate}
      />
    </div>
  );
};

export default Estimates;