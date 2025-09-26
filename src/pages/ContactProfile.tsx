import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BackButton } from "@/shared/components/BackButton";
import { ContactDetailsTab } from "@/components/contact-profile/ContactDetailsTab";
import { ContactJobsTab } from "@/components/contact-profile/ContactJobsTab";
import { ContactCommunicationTab } from "@/components/contact-profile/ContactCommunicationTab";
import { JobCreationDialog } from "@/components/JobCreationDialog";
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
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('details');

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

      // Fetch pipeline entry
      const { data: pipelineData } = await supabase
        .from('pipeline_entries')
        .select('*')
        .eq('contact_id', id)
        .limit(1);

      if (pipelineData && pipelineData.length > 0) {
        setPipelineEntry(pipelineData[0]);
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
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading contact profile...</span>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Contact Not Found</h2>
        <Button onClick={() => navigate('/')}>Go Back</Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header Section */}
      <div className="flex items-center gap-4 mb-8">
        <BackButton onClick={() => navigate('/')} />
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
          <JobCreationDialog 
            contact={contact}
            onJobCreated={handleJobsUpdate}
            trigger={
              <Button className="shadow-soft">
                <Plus className="h-4 w-4 mr-2" />
                Create Job
              </Button>
            }
          />
        </div>
      </div>

      {/* Pipeline Status Card */}
      {pipelineEntry && (
        <Card className="shadow-soft border-l-4 border-l-primary">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  <span className="font-semibold">Pipeline Status:</span>
                  <Badge className="bg-primary text-primary-foreground">{pipelineEntry.status}</Badge>
                </div>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <span className="text-muted-foreground">Estimated Value:</span>
                  <span className="font-semibold ml-1">${pipelineEntry.estimated_value || 0}</span>
                </div>
                {pipelineEntry.probability_percent && (
                  <div>
                    <span className="text-muted-foreground">Win Probability:</span>
                    <span className="font-semibold ml-1">{pipelineEntry.probability_percent}%</span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
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
            Jobs ({jobs.length})
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
  );
};

export default ContactProfile;