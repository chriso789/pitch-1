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
  Plus,
  XCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { EnhancedJobCreationDialog } from "@/components/EnhancedJobCreationDialog";

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

  const jobStages = [
    { name: "Pending Jobs", key: "pending", color: "bg-yellow-500", icon: Clock },
    { name: "In Progress", key: "in_progress", color: "bg-blue-500", icon: Loader2 },
    { name: "Completed", key: "completed", color: "bg-green-500", icon: CheckCircle },
    { name: "On Hold", key: "on_hold", color: "bg-orange-500", icon: AlertCircle },
    { name: "Cancelled", key: "cancelled", color: "bg-red-500", icon: XCircle }
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
        .from('jobs')
        .select(`
          *,
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
          projects (
            id,
            name,
            clj_formatted_number
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
      
      // For jobs, we don't have profiles relation, so disable sales rep filtering for now
      if (filters.salesRep && filters.salesRep !== 'all') {
        // Jobs don't have assigned sales reps in the same way, skip for now
      }
      
      // For jobs, filtering by location would require joining through contacts
      // For now, we'll skip location filtering
      if (filters.location && filters.location !== 'all') {
        // Skip location filtering for jobs for now
      }

      // Extract unique locations for filter options (no sales reps for jobs)
      const uniqueReps = [];
      
      // Skip location extraction for jobs for now
      const uniqueLocations = [];
      
      setSalesReps(uniqueReps);
      setLocations(uniqueLocations);

      // Group data by status and calculate stage totals
      const groupedData = {};
      const totals = {};
      
      // Initialize all stages with empty arrays to ensure they always show
      jobStages.forEach(stage => {
        const stageEntries = filteredData.filter(entry => entry.status === stage.key);
        groupedData[stage.key] = stageEntries;
        
        // Calculate total estimate value for this stage - for jobs, we'll use 0 for now
        const stageTotal = stageEntries.reduce((sum, entry) => {
          return sum + 0; // Jobs don't have direct selling_price, can be enhanced later
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
      const { data, error } = await supabase.functions.invoke('job-drag-handler', {
        body: {
          jobId: entryId,
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
        description: data.message || "Job moved successfully",
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
        description: "Failed to move job",
        variant: "destructive",
      });
    }
  };

  const handleStatusChange = async (entryId: string, newStatus: string) => {
    try {
      setUpdatingEntry(entryId);
      
      const { data, error } = await supabase.functions.invoke('job-drag-handler', {
        body: { 
          jobId: entryId, 
          newStatus: newStatus,
          fromStatus: null // Will be determined by the function
        }
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
      'scheduled': 'materials_ordered',
      'materials_ordered': 'in_progress', 
      'in_progress': 'quality_check',
      'quality_check': 'completed',
      'completed': 'invoiced',
      'invoiced': 'closed',
      'closed': null
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
    const project = item.projects;
    const nextStatus = getNextStatus(item.status);
    
    // Navigate to job details since these are jobs
    const handleViewClick = () => {
      navigate(`/job/${item.id}`);
    };
    
    return (
      <Card key={item.id} className="shadow-soft border-0 hover:shadow-medium transition-smooth">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <span className="font-mono text-sm text-muted-foreground">
                {item.job_number || project?.clj_formatted_number || `JOB-${item.id.slice(-4)}`}
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
              <span>{item.name || 'Job'}</span>
            </div>
            
            <div className="flex items-center gap-2 text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>{item.description || 'No description'}</span>
            </div>

            {/* Stage-specific information */}
            {stage === "scheduled" && (
              <div className="mt-3 pt-3 border-t">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Ready to start</span>
                  <span>Created: {new Date(item.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            )}

            {stage === "materials_ordered" && (
              <div className="mt-3 pt-3 border-t">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Materials on order</span>
                  <span>Waiting for delivery</span>
                </div>
              </div>
            )}

            {stage === "in_progress" && (
              <div className="mt-3 pt-3 border-t">
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
                  <span className="text-orange-700 font-medium">Work in Progress</span>
                </div>
              </div>
            )}

            {stage === "quality_check" && (
              <div className="mt-3 pt-3 border-t">
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                  <span className="text-purple-700 font-medium">Quality Review</span>
                </div>
              </div>
            )}

            {stage === "completed" && (
              <div className="mt-3 pt-3 border-t">
                <div className="text-xs text-green-700 font-medium">
                  Work Completed - Ready for Invoicing
                </div>
              </div>
            )}

            {stage === "invoiced" && (
              <div className="mt-3 pt-3 border-t">
                <div className="text-xs text-emerald-700 font-medium">
                  Invoice Sent - Awaiting Payment
                </div>
              </div>
            )}

            {stage === "closed" && (
              <div className="mt-3 pt-3 border-t">
                <div className="text-xs text-gray-700 font-medium">
                  Job Complete
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
      job_number: pipelineEntry.job_number || `JOB-${pipelineEntry.id.slice(-4)}`,
      name: formatName(contact),
      status: pipelineEntry.status,
      created_at: pipelineEntry.created_at || new Date().toISOString(),
      contact_id: pipelineEntry.contact_id,
      assigned_to: pipelineEntry.assigned_to,
      contacts: {
        id: contact?.id || pipelineEntry.contact_id,
        contact_number: pipelineEntry.contact_number || `JOB-${pipelineEntry.id.slice(-4)}`,
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
            Job Pipeline
          </h1>
          <p className="text-muted-foreground">
            Track and manage jobs through their lifecycle
          </p>
        </div>
        <EnhancedJobCreationDialog 
          onJobCreated={() => {
            fetchPipelineData();
            toast({
              title: "Success",
              description: "Job created successfully"
            });
          }}
        />
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
              {jobStages.map((stage) => {
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
                            onAssignmentChange={fetchPipelineData}
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

      {/* Remove Lead Form since this is now for Jobs */}
    </div>
  );
};

export default Pipeline;