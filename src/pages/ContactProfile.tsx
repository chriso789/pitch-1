import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BackButton } from "@/shared/components/BackButton";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { ContactDetailsTab } from "@/components/contact-profile/ContactDetailsTab";
import { ContactJobsTab } from "@/components/contact-profile/ContactJobsTab";
import { ContactCommunicationTab } from "@/components/contact-profile/ContactCommunicationTab";
import { SkipTraceButton } from "@/components/skip-trace/SkipTraceButton";
import { LeadCreationDialog } from "@/components/LeadCreationDialog";
import { JobNumberBreakdown } from "@/components/JobNumberBreakdown";
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
  Activity
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const ContactProfile = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [contact, setContact] = useState<any>(null);
  const [pipelineEntry, setPipelineEntry] = useState<any>(null);
  const [pipelineEntries, setPipelineEntries] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("details");
  const [activeSection, setActiveSection] = useState('client-list');

  useEffect(() => {
    if (id) {
      fetchContactData();
    }
  }, [id]);

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

  if (loading) {
    return (
      <GlobalLayout 
        activeSection={activeSection} 
        onSectionChange={setActiveSection}
      >
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading contact profile...</span>
        </div>
      </GlobalLayout>
    );
  }

  if (!contact) {
    return (
      <GlobalLayout 
        activeSection={activeSection} 
        onSectionChange={setActiveSection}
      >
        <div className="flex flex-col items-center justify-center h-64">
          <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Contact Not Found</h2>
          <Button onClick={() => navigate('/')}>Go Back</Button>
        </div>
      </GlobalLayout>
    );
  }

  return (
    <GlobalLayout 
      activeSection={activeSection} 
      onSectionChange={setActiveSection}
    >
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
                  <Badge variant="outline" className="text-sm">
                    {contact.qualification_status || 'Unqualified'}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <SkipTraceButton 
                contactId={id!} 
                onComplete={fetchContactData}
              />
              <LeadCreationDialog 
                contact={contact}
                onLeadCreated={() => {
                  fetchContactData(); // Refresh to get updated pipeline data
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
              <Briefcase className="h-4 w-4" />
              Jobs ({jobs.length + pipelineEntries.length})
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
              contact={contact} 
              onContactUpdate={handleContactUpdate}
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
            <ContactCommunicationTab contact={contact} />
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