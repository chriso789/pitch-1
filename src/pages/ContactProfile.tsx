import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Edit
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const ContactProfile = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [contact, setContact] = useState<any>(null);
  const [pipelineEntry, setPipelineEntry] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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
              <p className="text-muted-foreground">{contact.company_name || 'Homeowner'}</p>
            </div>
          </div>
        </div>
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