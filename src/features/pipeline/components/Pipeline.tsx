import React, { useState, useEffect } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, closestCorners } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { LeadForm } from "@/features/contacts/components/LeadForm";
import { KanbanCard } from './KanbanCard';
import { KanbanColumn } from './KanbanColumn';
import { 
  ArrowRight, 
  DollarSign, 
  Calendar, 
  MapPin, 
  Phone,
  Mail,
  FileText,
  User,
  Home,
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  Filter,
  CalendarDays,
  TrendingUp,
  Plus
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

const Pipeline = () => {
  const [pipelineData, setPipelineData] = useState({});
  const [loading, setLoading] = useState(true);
  const [updatingEntry, setUpdatingEntry] = useState(null);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    salesRep: 'all',
    location: 'all',
    dateFrom: '',
    dateTo: ''
  });
  const [stageTotals, setStageTotals] = useState({});
  const [salesReps, setSalesReps] = useState([]);
  const [locations, setLocations] = useState([]);
  const { toast } = useToast();
  const navigate = useNavigate();

  const pipelineStages = [
    { name: "Lead", key: "lead", color: "bg-status-lead", icon: User },
    { name: "Legal", key: "legal", color: "bg-status-legal", icon: FileText },
    { name: "Contingency", key: "contingency_signed", color: "bg-status-contingency", icon: AlertCircle },
    { name: "On Hold (Mgr Review)", key: "hold_manager_review", color: "bg-orange-500", icon: Clock },
    { name: "Project", key: "project", color: "bg-status-project", icon: Home },
    { name: "Completed", key: "completed", color: "bg-status-completed", icon: CheckCircle },
    { name: "Closed", key: "closed", color: "bg-status-closed", icon: Clock }
  ];

  // Fetch pipeline data from Supabase
  useEffect(() => {
    fetchPipelineData();
  }, [filters]);

  const fetchPipelineData = async () => {
    try {
      setLoading(true);
      
      // Build query with filters
      let query = supabase
        .from('pipeline_entries')
        .select(`
          *,
          clj_formatted_number,
          contacts (
            first_name,
            last_name,
            email,
            phone,
            address_street,
            address_city,
            address_state,
            address_zip
          ),
          estimates (
            id,
            estimate_number,
            selling_price,
            status,
            actual_margin_percent,
            created_at
          ),
          profiles!pipeline_entries_assigned_to_fkey (
            first_name,
            last_name
          )
        `);

      // Apply date filters
      if (filters.dateFrom) {
        query = query.gte('created_at', filters.dateFrom);
      }
      if (filters.dateTo) {
        query = query.lte('created_at', filters.dateTo + 'T23:59:59');
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching pipeline data:', error);
        toast({
          title: "Error",
          description: "Failed to load pipeline data",
          variant: "destructive",
        });
        return;
      }

      // Filter data based on sales rep and location
      let filteredData = data || [];
      
      if (filters.salesRep && filters.salesRep !== 'all') {
        filteredData = filteredData.filter(entry => 
          entry.profiles?.first_name + ' ' + entry.profiles?.last_name === filters.salesRep
        );
      }
      
      if (filters.location && filters.location !== 'all') {
        filteredData = filteredData.filter(entry => 
          entry.contacts?.address_city?.toLowerCase().includes(filters.location.toLowerCase())
        );
      }

      // Extract unique sales reps and locations for filter options
      const uniqueReps = [...new Set(data?.map(entry => 
        entry.profiles ? `${entry.profiles.first_name} ${entry.profiles.last_name}` : null
      ).filter(Boolean))];
      
      const uniqueLocations = [...new Set(data?.map(entry => 
        entry.contacts?.address_city
      ).filter(Boolean))];
      
      setSalesReps(uniqueReps);
      setLocations(uniqueLocations);

      // Group data by status and calculate stage totals
      const groupedData = {};
      const totals = {};
      
      // Initialize all stages with empty arrays to ensure they always show
      pipelineStages.forEach(stage => {
        const stageEntries = filteredData.filter(entry => entry.status === stage.key);
        groupedData[stage.key] = stageEntries;
        
        // Calculate total estimate value for this stage
        const stageTotal = stageEntries.reduce((sum, entry) => {
          const estimate = entry.estimates?.[0];
          return sum + (estimate?.selling_price || entry.estimated_value || 0);
        }, 0);
        
        totals[stage.key] = stageTotal;
      });

      setPipelineData(groupedData);
      setStageTotals(totals);
    } catch (error) {
      console.error('Error in fetchPipelineData:', error);
      toast({
        title: "Error",
        description: "Failed to load pipeline data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) return;

    const entryId = active.id as string;
    const newStatus = over.id as string;

    // Find the entry being moved
    let movedEntry: any = null;
    let fromStatus = '';

    for (const [status, entries] of Object.entries(pipelineData)) {
      const entryArray = Array.isArray(entries) ? entries : [];
      const entry = entryArray.find((e: any) => e.id === entryId);
      if (entry) {
        movedEntry = entry;
        fromStatus = status;
        break;
      }
    }

    if (!movedEntry) return;

    // Optimistically update UI
    const newPipelineData = { ...pipelineData };
    const fromArray = Array.isArray(newPipelineData[fromStatus]) ? newPipelineData[fromStatus] : [];
    const toArray = Array.isArray(newPipelineData[newStatus]) ? newPipelineData[newStatus] : [];
    newPipelineData[fromStatus] = fromArray.filter((e: any) => e.id !== entryId);
    newPipelineData[newStatus] = [...toArray, { ...movedEntry, status: newStatus }];
    setPipelineData(newPipelineData);

    try {
      const { data, error } = await supabase.functions.invoke('pipeline-drag-handler', {
        body: {
          pipelineEntryId: entryId,
          newStatus: newStatus,
          fromStatus: fromStatus
        }
      });

      if (error) {
        throw error;
      }

      if (data.error) {
        // Revert optimistic update
        const revertedData = { ...pipelineData };
        const revertFromArray = Array.isArray(revertedData[newStatus]) ? revertedData[newStatus] : [];
        const revertToArray = Array.isArray(revertedData[fromStatus]) ? revertedData[fromStatus] : [];
        revertedData[newStatus] = revertFromArray.filter((e: any) => e.id !== entryId);
        revertedData[fromStatus] = [...revertToArray, movedEntry];
        setPipelineData(revertedData);

        toast({
          title: "Access Denied",
          description: data.message || data.error,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Success",
        description: data.message || "Lead moved successfully",
      });

      // Refresh data to ensure consistency
      await fetchPipelineData();

    } catch (error) {
      console.error('Error moving pipeline entry:', error);
      
      // Revert optimistic update
      const revertedData = { ...pipelineData };
      const revertFromArray = Array.isArray(revertedData[newStatus]) ? revertedData[newStatus] : [];
      const revertToArray = Array.isArray(revertedData[fromStatus]) ? revertedData[fromStatus] : [];
      revertedData[newStatus] = revertFromArray.filter((e: any) => e.id !== entryId);
      revertedData[fromStatus] = [...revertToArray, movedEntry];
      setPipelineData(revertedData);

      toast({
        title: "Error",
        description: "Failed to move lead",
        variant: "destructive",
      });
    }
  };

  const handleStatusChange = async (entryId: string, newStatus: string) => {
    try {
      setUpdatingEntry(entryId);
      
      const { data, error } = await supabase.functions.invoke('pipeline-status', {
        body: { pipeline_id: entryId, new_status: newStatus }
      });

      if (error) {
        toast({
          title: "Error",
          description: "Failed to update status",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Success",
        description: data.message || "Status updated successfully",
      });

      // Refresh pipeline data
      fetchPipelineData();
    } catch (error) {
      console.error('Error updating status:', error);
      toast({
        title: "Error", 
        description: "Failed to update status",
        variant: "destructive",
      });
    } finally {
      setUpdatingEntry(null);
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

  const getNextStatus = (currentStatus) => {
    const statusFlow = {
      'lead': 'legal',
      'legal': 'contingency_signed', 
      'contingency_signed': 'hold_manager_review',
      'hold_manager_review': null, // No automatic advancement - requires manager approval
      'project': 'completed',
      'completed': 'closed'
    };
    return statusFlow[currentStatus];
  };

  const getPriorityColor = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case "high": return "bg-destructive text-destructive-foreground";
      case "medium": return "bg-warning text-warning-foreground"; 
      case "low": return "bg-muted text-muted-foreground";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const renderStageCard = (item: any, stage: string) => {
    const contact = item.contacts;
    const estimate = item.estimates?.[0]; // Get the latest estimate
    const nextStatus = getNextStatus(item.status);
    
    // Check if this pipeline entry has an associated job
    const handleViewClick = async () => {
      try {
        // Check if there's a job for this pipeline entry
        const { data: job } = await supabase
          .from('jobs')
          .select('id')
          .eq('pipeline_entry_id', item.id)
          .maybeSingle();
        
        if (job) {
          // Navigate to job details
          navigate(`/job/${job.id}`);
        } else {
          // Navigate to contact profile
          navigate(`/contact/${contact?.id || item.contact_id}`);
        }
      } catch (error) {
        console.error('Error checking for job:', error);
        // Fallback to contact profile
        navigate(`/contact/${contact?.id || item.contact_id}`);
      }
    };
    
    return (
      <Card key={item.id} className="shadow-soft border-0 hover:shadow-medium transition-smooth">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <span className="font-mono text-sm text-muted-foreground">
                {item.clj_formatted_number || estimate?.estimate_number || `PIPE-${item.id.slice(-4)}`}
              </span>
              <h3 className="font-semibold">{formatName(contact)}</h3>
            </div>
            {item.priority && (
              <Badge className={getPriorityColor(item.priority)}>
                {item.priority}
              </Badge>
            )}
          </div>
          
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span>{formatAddress(contact)}</span>
            </div>
            
            {contact?.phone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-4 w-4" />
                <span>{contact.phone}</span>
              </div>
            )}
            
            <div className="flex items-center gap-2 text-primary font-medium">
              <Home className="h-4 w-4" />
              <span>{item.roof_type || 'Roofing Project'}</span>
            </div>
            
            <div className="flex items-center gap-2 font-semibold">
              <DollarSign className="h-4 w-4 text-success" />
              <span>{formatCurrency(estimate?.selling_price || item.estimated_value)}</span>
            </div>

            {/* Stage-specific information */}
            {stage === "project" && (
              <div className="mt-3 pt-3 border-t">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-muted-foreground">Budget vs Actual</span>
                  <span className="text-xs font-medium">
                    {estimate?.actual_margin_percent ? `${estimate.actual_margin_percent.toFixed(1)}%` : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                  <span>Status: Active</span>
                  <span>Value: {formatCurrency(estimate?.selling_price)}</span>
                </div>
              </div>
            )}

            {stage === "lead" && (
              <div className="mt-3 pt-3 border-t">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Source: {item.source || 'Unknown'}</span>
                  <span>Probability: {item.probability_percent || 50}%</span>
                </div>
              </div>
            )}

            {(stage === "legal" || stage === "contingency_signed") && (
              <div className="mt-3 pt-3 border-t">
                <div className="text-xs text-muted-foreground">
                  Expected Close: {item.expected_close_date ? new Date(item.expected_close_date).toLocaleDateString() : 'TBD'}
                </div>
              </div>
            )}

            {stage === "hold_manager_review" && (
              <div className="mt-3 pt-3 border-t">
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
                  <span className="text-orange-700 font-medium">Awaiting Manager Approval</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Status: {item.manager_approval_status || 'Pending Review'}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            <Button 
              size="sm" 
              variant="outline" 
              className="flex-1"
              onClick={handleViewClick}
            >
              <FileText className="h-4 w-4 mr-1" />
              View
            </Button>
            {stage === "hold_manager_review" ? (
              <Button 
                size="sm" 
                variant="outline"
                className="flex-1 text-orange-700 border-orange-200 hover:bg-orange-50"
                disabled
              >
                <Clock className="h-4 w-4 mr-1" />
                On Hold
              </Button>
            ) : nextStatus && (
              <Button 
                size="sm" 
                className="flex-1"
                onClick={() => handleStatusChange(item.id, nextStatus)}
                disabled={updatingEntry === item.id}
              >
                {updatingEntry === item.id ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4 mr-1" />
                )}
                Advance
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  // Transform pipeline entry to match KanbanCard interface
  const transformToKanbanEntry = (pipelineEntry: any) => {
    const contact = pipelineEntry.contacts;
    const estimate = pipelineEntry.estimates?.[0];
    
    return {
      id: pipelineEntry.id,
      job_number: pipelineEntry.clj_formatted_number || estimate?.estimate_number || `PIPE-${pipelineEntry.id.slice(-4)}`,
      name: formatName(contact),
      status: pipelineEntry.status,
      created_at: pipelineEntry.created_at || new Date().toISOString(),
      contact_id: pipelineEntry.contact_id,
      contacts: {
        id: contact?.id || pipelineEntry.contact_id,
        contact_number: pipelineEntry.clj_formatted_number || estimate?.estimate_number || `PIPE-${pipelineEntry.id.slice(-4)}`,
        first_name: contact?.first_name || '',
        last_name: contact?.last_name || '',
        email: contact?.email || '',
        phone: contact?.phone || '',
        address_street: contact?.address_street || '',
        address_city: contact?.address_city || '',
        address_state: contact?.address_state || '',
        address_zip: contact?.address_zip || ''
      }
    };
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            Sales Pipeline
          </h1>
          <p className="text-muted-foreground">
            Track leads through the complete roofing sales process
          </p>
        </div>
        <Button className="gradient-primary" onClick={() => setShowLeadForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add New Lead
        </Button>
      </div>

      {/* Filters */}
      <Card className="shadow-soft border-0">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
          
          {(filters.salesRep !== 'all' || filters.location !== 'all' || filters.dateFrom || filters.dateTo) && (
            <div className="mt-4">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setFilters({ salesRep: 'all', location: 'all', dateFrom: '', dateTo: '' })}
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
          <span className="ml-2">Loading pipeline data...</span>
        </div>
      ) : (
        <DndContext
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <ScrollArea className="w-full">
            <div className="flex gap-6 pb-4 min-w-max">
              {pipelineStages.map((stage) => {
                const stageEntries = (pipelineData[stage.key] || []).map(transformToKanbanEntry);
                
                return (
                  <div key={stage.key} className="min-w-[320px]">
                    <SortableContext 
                      items={stageEntries.map(entry => entry.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <KanbanColumn
                        id={stage.key}
                        title={stage.name}
                        color={stage.color}
                        icon={stage.icon}
                        count={(pipelineData[stage.key] || []).length}
                        total={formatCurrency(stageTotals[stage.key] || 0)}
                      >
                        {stageEntries.map((entry) => (
                          <KanbanCard
                            key={entry.id}
                            id={entry.id}
                            entry={entry}
                            onView={(entryId) => {
                              const originalEntry = (pipelineData[stage.key] || []).find(e => e.id === entryId);
                              if (originalEntry) {
                                navigate(`/contact/${originalEntry.contact_id}`);
                              }
                            }}
                            onDelete={() => {}}
                            canDelete={false}
                            isDragging={activeId === entry.id}
                          />
                        ))}
                      </KanbanColumn>
                    </SortableContext>
                  </div>
                );
              })}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
          
          <DragOverlay>
            {activeId ? (
              <div className="transform rotate-3 opacity-90">
                {(() => {
                  // Find the active entry
                  for (const [status, entries] of Object.entries(pipelineData)) {
                    const entryArray = Array.isArray(entries) ? entries : [];
                    const entry = entryArray.find((e: any) => e.id === activeId);
                    if (entry) {
                      const transformedEntry = transformToKanbanEntry(entry);
                      return (
                        <KanbanCard
                          id={transformedEntry.id}
                          entry={transformedEntry}
                          onView={() => {}}
                          onDelete={() => {}}
                          canDelete={false}
                          isDragging={true}
                        />
                      );
                    }
                  }
                  return null;
                })()}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Lead Form Dialog */}
      <LeadForm 
        open={showLeadForm} 
        onOpenChange={setShowLeadForm}
        onLeadCreated={() => {
          fetchPipelineData(); // Refresh pipeline data
        }}
      />
    </div>
  );
};

export default Pipeline;