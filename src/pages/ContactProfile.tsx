import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { BackButton } from "@/components/BackButton";
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
  Briefcase
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
  const [isCreatingJob, setIsCreatingJob] = useState(false);
  const [jobForm, setJobForm] = useState({
    name: '',
    description: ''
  });

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

  const handleCreateJob = async () => {
    if (!jobForm.name.trim()) {
      toast({
        title: "Error",
        description: "Job name is required",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsCreatingJob(true);

      const { data: tenantData } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      const { data: jobData, error } = await supabase
        .from('jobs')
        .insert({
          contact_id: id,
          name: jobForm.name,
          description: jobForm.description || null,
          tenant_id: tenantData?.tenant_id,
          created_by: (await supabase.auth.getUser()).data.user?.id,
          job_number: '' // Will be overwritten by trigger
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      toast({
        title: "Success",
        description: `Job ${jobData.job_number} created successfully`,
      });

      setJobs(prev => [jobData, ...prev]);
      setJobForm({ name: '', description: '' });
      
    } catch (error) {
      console.error('Error creating job:', error);
      toast({
        title: "Error",
        description: "Failed to create job",
        variant: "destructive",
      });
    } finally {
      setIsCreatingJob(false);
    }
  };

  const formatAddress = (contact: any) => {
    if (!contact) return 'No address available';
    const parts = [
      contact.address_street,
      contact.address_city,
      contact.address_state,
      contact.address_zip
    ].filter(Boolean);
    return parts.join(', ') || 'No address available';
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
      <div className="flex items-center gap-4 mb-6">
        <BackButton onClick={() => navigate('/')} />
        <div className="flex-1">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center">
              <User className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">
                {contact.first_name} {contact.last_name}
              </h1>
              <div className="flex items-center gap-3">
                <p className="text-muted-foreground">{contact.company_name || 'Homeowner'}</p>
                {contact.contact_number && (
                  <Badge variant="secondary">#{contact.contact_number}</Badge>
                )}
              </div>
            </div>
          </div>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Job
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Job</DialogTitle>
              <DialogDescription>
                Create a new job for {contact.first_name} {contact.last_name}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="job-name">Job Name</Label>
                <Input
                  id="job-name"
                  placeholder="Enter job name"
                  value={jobForm.name}
                  onChange={(e) => setJobForm(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="job-description">Description (Optional)</Label>
                <Textarea
                  id="job-description"
                  placeholder="Enter job description"
                  value={jobForm.description}
                  onChange={(e) => setJobForm(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button 
                onClick={handleCreateJob} 
                disabled={isCreatingJob || !jobForm.name.trim()}
              >
                {isCreatingJob && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Job
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Contact Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {contact.phone && (
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>{contact.phone}</span>
              </div>
            )}
            
            {contact.email && (
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>{contact.email}</span>
              </div>
            )}
            
            <div className="flex items-start gap-3">
              <MapPin className="h-4 w-4 text-muted-foreground mt-1" />
              <span className="text-sm">{formatAddress(contact)}</span>
            </div>

            {contact.lead_source && (
              <div className="pt-3 border-t">
                <p className="text-sm text-muted-foreground">Lead Source</p>
                <p className="font-medium">{contact.lead_source}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {pipelineEntry && (
          <Card>
            <CardHeader>
              <CardTitle>Pipeline Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Badge variant="outline">{pipelineEntry.status}</Badge>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Estimated Value</span>
                  <span className="font-medium">${pipelineEntry.estimated_value || 0}</span>
                </div>
                {pipelineEntry.probability_percent && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Win Probability</span>
                    <span className="font-medium">{pipelineEntry.probability_percent}%</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Jobs ({jobs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length > 0 ? (
            <div className="space-y-3">
              {jobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{job.name}</span>
                      <Badge variant="outline">{job.job_number}</Badge>
                      <Badge variant={job.status === 'pending' ? 'secondary' : 'default'}>
                        {job.status}
                      </Badge>
                    </div>
                    {job.description && (
                      <p className="text-sm text-muted-foreground mt-1">{job.description}</p>
                    )}
                  </div>
                  <Button variant="outline" size="sm">
                    View Details
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">No jobs created yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Project Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Full project details, estimates, and communication history will be displayed here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default ContactProfile;