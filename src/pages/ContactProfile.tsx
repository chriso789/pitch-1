import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BackButton } from "@/shared/components/BackButton";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { ContactDetailsTab } from "@/components/contact-profile/ContactDetailsTab";
import { ContactJobsTab } from "@/components/contact-profile/ContactJobsTab";
import { ContactCommunicationTab } from "@/components/contact-profile/ContactCommunicationTab";
import { SkipTraceButton } from "@/components/skip-trace/SkipTraceButton";
import { CallButton, CallHistory } from "@/components/telephony";
import { LeadCreationDialog } from "@/components/LeadCreationDialog";
import { JobNumberBreakdown } from "@/components/JobNumberBreakdown";
import { JobApprovalDialog } from "@/components/JobApprovalDialog";
import {
  User,
  Phone,
  Mail,
  MapPin,
  FileText,
  Home,
  AlertCircle,
  Loader2,
  Edit,
  Plus,
  Briefcase,
  MessageSquare,
  Activity,
  CheckCircle,
  UserCheck
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";

const ContactProfile = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { activeTenantId } = useActiveTenantId();
  const [contact, setContact] = useState<any>(null);
  const [pipelineEntry, setPipelineEntry] = useState<any>(null);
  const [pipelineEntries, setPipelineEntries] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("details");
  const [selectedPipelineEntry, setSelectedPipelineEntry] = useState<any>(null);
  const [triggerEditCounter, setTriggerEditCounter] = useState(0);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [assigningRep, setAssigningRep] = useState(false);
  // Safety guard: handle invalid IDs like "new"
  useEffect(() => {
    if (id === 'new' || !id) {
      toast({
        title: "Invalid Route",
        description: "Please use the contact form to create a new contact.",
        variant: "destructive",
      });
      navigate('/client-list');
      return;
    }
  }, [id, navigate, toast]);

  useEffect(() => {
    if (id && id !== 'new') {
      fetchContactData();
    }
  }, [id]);

  // Fetch team members for assign rep dropdown
  useEffect(() => {
    if (!activeTenantId) return;
    const fetchTeam = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, role')
        .eq('tenant_id', activeTenantId)
        .order('first_name');
      if (data) setTeamMembers(data);
    };
    fetchTeam();
  }, [activeTenantId]);

  const handleAssignRep = async (value: string) => {
    const newAssignedTo = value === 'unassigned' ? null : value;
    setAssigningRep(true);
    const { error } = await supabase
      .from('contacts')
      .update({ assigned_to: newAssignedTo })
      .eq('id', id);
    setAssigningRep(false);
    if (error) {
      toast({ title: "Error", description: "Failed to assign rep", variant: "destructive" });
    } else {
      setContact((prev: any) => ({ ...prev, assigned_to: newAssignedTo }));
      const repName = newAssignedTo
        ? teamMembers.find(m => m.id === newAssignedTo)
        : null;
      toast({
        title: "Rep Assigned",
        description: repName ? `Assigned to ${repName.first_name} ${repName.last_name}` : "Unassigned",
      });
    }
  };

  const fetchContactData = async () => {
    try {
      setLoading(true);
      
      const { data: contactData, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error || !contactData) {
        toast({
          title: "Error",
          description: "Contact not found",
          variant: "destructive",
        });
        navigate('/');
        return;
      }

      setContact(contactData);

      // Fetch pipeline entries
      const { data: pipelineData } = await supabase
        .from('pipeline_entries')
        .select('*')
        .eq('contact_id', id)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false });

      if (pipelineData && pipelineData.length > 0) {
        setPipelineEntry(pipelineData[0]); // Most recent for display
        setPipelineEntries(pipelineData); // All entries for count
      }

      // Fetch jobs for this contact
      const { data: jobsData } = await supabase
        .from('jobs')
        .select('*')
        .eq('contact_id', id)
        .order('created_at', { ascending: false });

      if (jobsData) {
        setJobs(jobsData);
      }

    } catch (error) {
      console.error('Error:', error);
      toast({
        title: "Error",
        description: "Failed to load contact data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleContactUpdate = (updatedContact: any) => {
    setContact(updatedContact);
  };

  const handleJobsUpdate = (updatedJobs: any[]) => {
    setJobs(updatedJobs);
  };

  const handleJobCreated = () => {
    setSelectedPipelineEntry(null);
    fetchContactData(); // Refresh all data
    toast({
      title: "Success",
      description: "Job created successfully",
    });
  };

  if (loading) {
    return (
      <GlobalLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading contact profile...</span>
        </div>
      </GlobalLayout>
    );
  }

  if (!contact) {
    return (
      <GlobalLayout>
        <div className="flex flex-col items-center justify-center h-64">
          <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Contact Not Found</h2>
          <Button onClick={() => navigate('/')}>Go Back</Button>
        </div>
      </GlobalLayout>
    );
  }

  return (
    <GlobalLayout>
      <div className="container mx-auto p-6 space-y-6">
        {/* Header Section */}
        <div className="flex items-center gap-4 mb-8">
          <BackButton respectHistory={true} fallbackPath="/" />
          <div className="flex-1">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 gradient-primary rounded-full flex items-center justify-center shadow-medium">
                <User className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">
                  {contact.first_name} {contact.last_name}
                </h1>
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-muted-foreground text-lg">{contact.company_name || 'Homeowner'}</p>
                  {contact.contact_number && (
                    <Badge variant="secondary" className="text-sm">#{contact.contact_number}</Badge>
                  )}
                  <Badge 
                    className={`text-sm ${
                      contact.qualification_status === 'qualified' || contact.qualification_status === 'interested' 
                        ? 'bg-success text-success-foreground' 
                        : contact.qualification_status === 'storm_damage_marketing'
                        ? 'bg-warning text-warning-foreground'
                        : contact.qualification_status === 'old_roof_marketing'
                        ? 'bg-primary text-primary-foreground'
                        : contact.qualification_status === 'not_interested'
                        ? 'bg-destructive text-destructive-foreground'
                        : contact.qualification_status === 'follow_up'
                        ? 'bg-yellow-500 text-white'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {contact.qualification_status?.replace(/_/g, ' ') || 'Unqualified'}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {contact.phone && (
                <CallButton 
                  phoneNumber={contact.phone}
                  contactId={contact.id}
                  contactName={`${contact.first_name} ${contact.last_name}`}
                  size="default"
                />
              )}
              <SkipTraceButton 
                contactId={id!} 
                onComplete={fetchContactData}
              />
              <Select
                value={contact.assigned_to || 'unassigned'}
                onValueChange={handleAssignRep}
                disabled={assigningRep}
              >
                <SelectTrigger className="w-[180px] shadow-soft">
                  <UserCheck className="h-4 w-4 mr-2 shrink-0" />
                  <SelectValue placeholder="Assign Rep" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {teamMembers.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.first_name} {member.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                className="shadow-soft"
                onClick={() => {
                  setActiveTab("details");
                  setTriggerEditCounter(c => c + 1);
                }}
              >
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
              <LeadCreationDialog 
                contact={contact}
                onLeadCreated={() => {
                  fetchContactData();
                }}
                trigger={
                  <Button className="shadow-soft">
                    <Plus className="h-4 w-4 mr-2" />
                    Create Lead
                  </Button>
                }
              />
            </div>
          </div>
        </div>

        {/* Pipeline Status Cards */}
        {pipelineEntries.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {pipelineEntries.slice(0, 2).map((entry) => (
              <Card key={entry.id} className="shadow-soft border-l-4 border-l-primary">
                <CardContent className="pt-6">
                  <div className="space-y-4">
                    {/* Pipeline Bubble Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-warning to-warning/70 flex items-center justify-center shadow-soft">
                          <Activity className="h-5 w-5 text-warning-foreground" />
                        </div>
                        <div>
                          <div className="text-sm text-muted-foreground">Pipeline Lead</div>
                          <Badge className="bg-primary text-primary-foreground mt-1">
                            {entry.status}
                          </Badge>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-muted-foreground">Estimated Value</div>
                        <div className="font-semibold text-lg">${entry.estimated_value?.toLocaleString() || 0}</div>
                      </div>
                    </div>
                    
                    {/* Job Number Breakdown */}
                    <JobNumberBreakdown
                      contactNumber={contact.contact_number}
                      contactName={`${contact.first_name} ${contact.last_name}`}
                      pipelineNumber={entry.id.slice(-4)}
                      pipelineStatus={entry.status}
                      compact
                    />
                    
                    {entry.probability_percent && (
                      <div className="pt-2 border-t">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Win Probability:</span>
                          <span className="font-semibold">{entry.probability_percent}%</span>
                        </div>
                      </div>
                    )}
                    
                    {/* Quick Convert Button */}
                    {entry.status === 'ready_for_approval' && (
                      <div className="pt-3 border-t">
                        <JobApprovalDialog
                          pipelineEntry={entry}
                          onJobCreated={handleJobCreated}
                        >
                          <Button className="w-full shadow-soft" variant="default">
                            <CheckCircle className="h-4 w-4 mr-2" />
                            Quick Convert to Job
                          </Button>
                        </JobApprovalDialog>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Tabbed Interface */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 h-12">
            <TabsTrigger value="details" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              Details
            </TabsTrigger>
            <TabsTrigger value="jobs" className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Pipeline ({pipelineEntries.length})
            </TabsTrigger>
            <TabsTrigger value="communication" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Communication
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Documents
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-0">
            <ContactDetailsTab 
              key={contact.id}
              contact={contact} 
              onContactUpdate={handleContactUpdate}
              triggerEdit={triggerEditCounter}
            />
          </TabsContent>

          <TabsContent value="jobs" className="space-y-0">
            <ContactJobsTab 
              contact={contact}
              jobs={jobs}
              pipelineEntries={pipelineEntries}
              onJobsUpdate={handleJobsUpdate}
            />
          </TabsContent>

          <TabsContent value="communication" className="space-y-0">
            <div className="space-y-6">
              <ContactCommunicationTab contact={contact} />
              <CallHistory contactId={contact.id} />
            </div>
          </TabsContent>

          <TabsContent value="documents" className="space-y-0">
            <Card className="shadow-soft">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Documents & Files
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Document Management</h3>
                  <p className="text-muted-foreground">
                    Document management features will be available here.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </GlobalLayout>
  );
};

export default ContactProfile;