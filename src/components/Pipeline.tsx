import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const Pipeline = () => {
  const [pipelineData, setPipelineData] = useState({});
  const [loading, setLoading] = useState(true);
  const [updatingEntry, setUpdatingEntry] = useState(null);
  const { toast } = useToast();

  const pipelineStages = [
    { name: "Lead", key: "lead", color: "bg-status-lead", icon: User },
    { name: "Legal Review", key: "legal_review", color: "bg-status-legal", icon: FileText },
    { name: "Contingency", key: "contingency_signed", color: "bg-status-contingency", icon: AlertCircle },
    { name: "Project", key: "project", color: "bg-status-project", icon: Home },
    { name: "Completed", key: "completed", color: "bg-status-completed", icon: CheckCircle },
    { name: "Closed", key: "closed", color: "bg-status-closed", icon: Clock }
  ];

  // Fetch pipeline data from Supabase
  useEffect(() => {
    fetchPipelineData();
  }, []);

  const fetchPipelineData = async () => {
    try {
      setLoading(true);
      
      // Fetch pipeline entries with contact information and estimates
      const { data, error } = await supabase
        .from('pipeline_entries')
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
          estimates (
            id,
            estimate_number,
            selling_price,
            status,
            actual_margin_percent
          )
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching pipeline data:', error);
        toast({
          title: "Error",
          description: "Failed to load pipeline data",
          variant: "destructive",
        });
        return;
      }

      // Group data by status
      const groupedData = {};
      pipelineStages.forEach(stage => {
        groupedData[stage.key] = data?.filter(entry => entry.status === stage.key) || [];
      });

      setPipelineData(groupedData);
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
      'lead': 'legal_review',
      'legal_review': 'contingency_signed', 
      'contingency_signed': 'project',
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
    
    return (
      <Card key={item.id} className="shadow-soft border-0 hover:shadow-medium transition-smooth">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <span className="font-mono text-sm text-muted-foreground">
                {estimate?.estimate_number || `PIPE-${item.id.slice(-4)}`}
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

            {(stage === "legal_review" || stage === "contingency_signed") && (
              <div className="mt-3 pt-3 border-t">
                <div className="text-xs text-muted-foreground">
                  Expected Close: {item.expected_close_date ? new Date(item.expected_close_date).toLocaleDateString() : 'TBD'}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            <Button size="sm" variant="outline" className="flex-1">
              <FileText className="h-4 w-4 mr-1" />
              View
            </Button>
            {nextStatus && (
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
        <Button className="gradient-primary">
          <User className="h-4 w-4 mr-2" />
          Add New Lead
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading pipeline data...</span>
        </div>
      ) : (
        /* Pipeline Stages */
        <div className="grid grid-cols-1 lg:grid-cols-6 gap-6">
          {pipelineStages.map((stage, index) => (
            <div key={stage.key} className="space-y-4">
              {/* Stage Header */}
              <Card className="shadow-soft border-0">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <div className={cn("w-8 h-8 rounded-full flex items-center justify-center", stage.color)}>
                      <stage.icon className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <div>{stage.name}</div>
                      <div className="font-normal text-muted-foreground">
                        {(pipelineData[stage.key] || []).length} items
                      </div>
                    </div>
                  </CardTitle>                
                </CardHeader>
              </Card>

              {/* Stage Items */}
              <div className="space-y-3">
                {(pipelineData[stage.key] || []).map((item) => 
                  renderStageCard(item, stage.key)
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Pipeline;