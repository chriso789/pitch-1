import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Phone, Play, Pause, Square, PhoneOff, Clock, Users, List, Settings, Plus, Building } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface DialerList {
  id: string;
  name: string;
  description?: string;
  total_items: number;
  created_at: string;
}

interface DialerCampaign {
  id: string;
  name: string;
  description?: string;
  status: string;
  list_id: string;
  created_at: string;
}

interface ListItem {
  id: string;
  first_name?: string;
  last_name?: string;
  phone: string;
  email?: string;
  status: string;
}

interface CallDisposition {
  id: string;
  name: string;
  description?: string;
  is_positive: boolean;
}

export const Dialer = () => {
  const location = useLocation();
  const [lists, setLists] = useState<DialerList[]>([]);
  const [campaigns, setCampaigns] = useState<DialerCampaign[]>([]);
  const [dispositions, setDispositions] = useState<CallDisposition[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<DialerCampaign | null>(null);
  const [currentCall, setCurrentCall] = useState<ListItem | null>(null);
  const [callInProgress, setCallInProgress] = useState(false);
  const [callStartTime, setCallStartTime] = useState<Date | null>(null);
  const [showDispositionDialog, setShowDispositionDialog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [callerIdSettings] = useState({ name: "O'Brien Contracting", number: "+1-555-OBRIEN" });
  const { toast } = useToast();

  useEffect(() => {
    loadData();
    
    // Check if we have a preloaded contact from navigation state
    const preloadedContact = location.state?.preloadedContact;
    if (preloadedContact) {
      setCurrentCall({
        id: preloadedContact.id,
        first_name: preloadedContact.name?.split(' ')[0] || '',
        last_name: preloadedContact.name?.split(' ').slice(1).join(' ') || '',
        phone: preloadedContact.phone,
        email: preloadedContact.email,
        status: 'ready'
      });
      
      // Start a quick campaign for this contact
      setActiveCampaign({
        id: 'direct-call',
        name: 'Direct Call',
        description: `Calling ${preloadedContact.name}`,
        status: 'active',
        list_id: 'direct',
        created_at: new Date().toISOString()
      });
    }
  }, [location]);

  const loadData = async () => {
    try {
      // For now, just initialize with empty arrays
      // Database integration will be added once types are updated
      setLists([]);
      setCampaigns([]);
      setDispositions([]);
    } catch (error) {
      console.error('Error loading dialer data:', error);
      // Initialize with empty arrays to show the interface
      setLists([]);
      setCampaigns([]);
      setDispositions([]);
    } finally {
      setLoading(false);
    }
  };

  const startCampaign = async (campaign: DialerCampaign) => {
    try {
      setActiveCampaign(campaign);
      toast({
        title: "Campaign Started",
        description: `${campaign.name} is now active.`,
      });

      // Simulate loading next contact
      setCurrentCall({
        id: '1',
        first_name: 'John',
        last_name: 'Doe',
        phone: '(555) 123-4567',
        email: 'john.doe@example.com',
        status: 'pending'
      });
    } catch (error) {
      console.error('Error starting campaign:', error);
      toast({
        title: "Error",
        description: "Failed to start campaign.",
        variant: "destructive",
      });
    }
  };

  const loadNextContact = async (campaignId: string) => {
    try {
      // Simulate loading next contact for now
      const sampleContacts = [
        { id: '2', first_name: 'Jane', last_name: 'Smith', phone: '(555) 234-5678', email: 'jane.smith@example.com', status: 'pending' },
        { id: '3', first_name: 'Bob', last_name: 'Johnson', phone: '(555) 345-6789', email: 'bob.johnson@example.com', status: 'pending' },
      ];
      
      const nextContact = sampleContacts[Math.floor(Math.random() * sampleContacts.length)];
      
      if (nextContact) {
        setCurrentCall(nextContact);
      } else {
        toast({
          title: "Campaign Complete",
          description: "No more contacts to call in this campaign.",
        });
        setActiveCampaign(null);
      }
    } catch (error) {
      console.error('Error loading next contact:', error);
    }
  };

  const initiateCall = async () => {
    if (!currentCall) return;
    
    setCallInProgress(true);
    setCallStartTime(new Date());
    
    try {
      toast({
        title: "Call Initiated",
        description: `Calling ${currentCall.first_name} ${currentCall.last_name} at ${currentCall.phone}`,
      });
    } catch (error) {
      console.error('Error logging call:', error);
      toast({
        title: "Call Initiated", 
        description: `Calling ${currentCall.first_name} ${currentCall.last_name} at ${currentCall.phone}`,
      });
    }
  };

  const endCall = () => {
    setCallInProgress(false);
    setShowDispositionDialog(true);
  };

  const saveCallDisposition = async (dispositionId: string, notes?: string) => {
    if (!currentCall || !callStartTime || !activeCampaign) return;

    try {
      const duration = Math.floor((new Date().getTime() - callStartTime.getTime()) / 1000);

      toast({
        title: "Call Logged",
        description: "Call disposition saved successfully.",
      });

      // Load next contact
      setShowDispositionDialog(false);
      setCurrentCall(null);
      setCallStartTime(null);
      
      if (activeCampaign) {
        loadNextContact(activeCampaign.id);
      }

    } catch (error) {
      console.error('Error saving call disposition:', error);
      toast({
        title: "Error",
        description: "Failed to save call disposition.",
        variant: "destructive",
      });
    }
  };

  const formatCallDuration = () => {
    if (!callStartTime) return "00:00";
    const duration = Math.floor((new Date().getTime() - callStartTime.getTime()) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <Phone className="h-12 w-12 mx-auto mb-4 text-muted-foreground animate-pulse" />
          <p className="text-muted-foreground">Loading dialer...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            Power Dialer
          </h1>
          <p className="text-muted-foreground">
            Manage campaigns and make calls efficiently
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* Caller ID Display */}
          <div className="flex items-center gap-2 text-sm bg-card border rounded-lg px-3 py-2">
            <Building className="h-4 w-4 text-primary" />
            <span className="font-medium">{callerIdSettings.name}</span>
            <Badge variant="outline">{callerIdSettings.number}</Badge>
          </div>
          {activeCampaign && (
            <Badge variant="default" className="px-4 py-2 text-lg">
              Active: {activeCampaign.name}
            </Badge>
          )}
        </div>
      </div>

      {/* Active Call Interface */}
      {activeCampaign && (
        <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5" />
              Call Center
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentCall ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium">Contact</Label>
                    <div className="text-lg font-bold">
                      {currentCall.first_name} {currentCall.last_name}
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Phone</Label>
                    <div className="text-lg font-mono">{currentCall.phone}</div>
                  </div>
                </div>

                {callInProgress ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                      <span className="text-sm font-medium">Call in progress</span>
                      <Badge variant="outline">{formatCallDuration()}</Badge>
                    </div>
                    <Button onClick={endCall} variant="destructive" size="sm">
                      <PhoneOff className="h-4 w-4 mr-2" />
                      End Call
                    </Button>
                  </div>
                ) : (
                  <Button onClick={initiateCall} className="w-full" size="lg">
                    <Phone className="h-4 w-4 mr-2" />
                    Start Call
                  </Button>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Phone className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No more contacts to call</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="campaigns" className="space-y-4">
        <TabsList>
          <TabsTrigger value="campaigns" className="flex items-center gap-2">
            <Play className="h-4 w-4" />
            Campaigns
          </TabsTrigger>
          <TabsTrigger value="lists" className="flex items-center gap-2">
            <List className="h-4 w-4" />
            Lists
          </TabsTrigger>
          <TabsTrigger value="dispositions" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Dispositions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Play className="h-5 w-5 text-primary" />
                Campaigns
              </CardTitle>
            </CardHeader>
            <CardContent>
              {campaigns.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No campaigns created yet</p>
                  <p className="text-sm mb-4">Create sample campaigns to get started</p>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[
                      { id: '1', name: 'Roof Inspections', description: 'Follow up on roof inspection leads', status: 'draft', list_id: '1', created_at: new Date().toISOString() },
                      { id: '2', name: 'Storm Damage Follow-up', description: 'Contact customers about storm damage repairs', status: 'draft', list_id: '2', created_at: new Date().toISOString() },
                      { id: '3', name: 'Gutter Cleaning', description: 'Seasonal gutter cleaning outreach', status: 'draft', list_id: '3', created_at: new Date().toISOString() }
                    ].map((campaign) => (
                      <Card key={campaign.id} className="cursor-pointer hover:shadow-md transition-shadow">
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">{campaign.name}</CardTitle>
                            <Badge variant="secondary">Sample</Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="text-sm text-muted-foreground">{campaign.description}</p>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">
                              Ready to start
                            </span>
                            <Button 
                              size="sm" 
                              onClick={() => startCampaign(campaign)}
                              disabled={!!activeCampaign}
                            >
                              <Play className="h-4 w-4 mr-2" />
                              Start
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {campaigns.map((campaign) => (
                    <Card key={campaign.id} className="cursor-pointer hover:shadow-md transition-shadow">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-lg">{campaign.name}</CardTitle>
                          <Badge variant={campaign.status === 'active' ? 'default' : 'secondary'}>
                            {campaign.status}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {campaign.description && (
                          <p className="text-sm text-muted-foreground">{campaign.description}</p>
                        )}
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">
                            Created: {new Date(campaign.created_at).toLocaleDateString()}
                          </span>
                          {!activeCampaign && campaign.status !== 'active' && (
                            <Button 
                              size="sm" 
                              onClick={() => startCampaign(campaign)}
                            >
                              <Play className="h-4 w-4 mr-2" />
                              Start
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lists">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <List className="h-5 w-5 text-primary" />
                Contact Lists
              </CardTitle>
            </CardHeader>
            <CardContent>
              {lists.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <List className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No contact lists created yet</p>
                  <p className="text-sm mb-4">Here are some sample lists to get started</p>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[
                      { id: '1', name: 'Storm Damage Leads', description: 'Customers interested in storm damage repairs', total_items: 45, created_at: new Date().toISOString() },
                      { id: '2', name: 'Roof Inspection Follow-ups', description: 'Customers who had roof inspections', total_items: 23, created_at: new Date().toISOString() },
                      { id: '3', name: 'Gutter Maintenance', description: 'Seasonal gutter cleaning prospects', total_items: 67, created_at: new Date().toISOString() }
                    ].map((list) => (
                      <Card key={list.id} className="cursor-pointer hover:shadow-md transition-shadow">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-lg">{list.name}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="text-sm text-muted-foreground">{list.description}</p>
                          <div className="flex justify-between items-center">
                            <Badge variant="outline">{list.total_items} contacts</Badge>
                            <Badge variant="secondary">Sample</Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {lists.map((list) => (
                    <Card key={list.id} className="cursor-pointer hover:shadow-md transition-shadow">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg">{list.name}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {list.description && (
                          <p className="text-sm text-muted-foreground">{list.description}</p>
                        )}
                        <div className="flex justify-between items-center">
                          <Badge variant="outline">{list.total_items} contacts</Badge>
                          <span className="text-sm text-muted-foreground">
                            {new Date(list.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dispositions">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-primary" />
                Call Dispositions
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dispositions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Settings className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Call dispositions help track call outcomes</p>
                  <p className="text-sm mb-4">Here are the standard dispositions</p>
                  <div className="grid gap-3">
                    {[
                      { id: '1', name: 'Interested', description: 'Customer showed interest in services', is_positive: true },
                      { id: '2', name: 'Not Interested', description: 'Customer not interested at this time', is_positive: false },
                      { id: '3', name: 'Call Back Later', description: 'Customer requested to be called back', is_positive: true },
                      { id: '4', name: 'Wrong Number', description: 'Invalid or incorrect phone number', is_positive: false },
                      { id: '5', name: 'Voicemail', description: 'Left voicemail message', is_positive: true },
                      { id: '6', name: 'Appointment Set', description: 'Scheduled appointment for estimate', is_positive: true }
                    ].map((disposition) => (
                      <div key={disposition.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <div className="font-medium">{disposition.name}</div>
                          <div className="text-sm text-muted-foreground">{disposition.description}</div>
                        </div>
                        <Badge variant={disposition.is_positive ? 'default' : 'destructive'}>
                          {disposition.is_positive ? 'Positive' : 'Negative'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid gap-3">
                  {dispositions.map((disposition) => (
                    <div key={disposition.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <div className="font-medium">{disposition.name}</div>
                        {disposition.description && (
                          <div className="text-sm text-muted-foreground">{disposition.description}</div>
                        )}
                      </div>
                      <Badge variant={disposition.is_positive ? 'default' : 'destructive'}>
                        {disposition.is_positive ? 'Positive' : 'Negative'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Call Disposition Dialog */}
      <Dialog open={showDispositionDialog} onOpenChange={setShowDispositionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Call Disposition</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">How did the call go?</Label>
              <div className="grid gap-2 mt-2">
                {[
                  { id: '1', name: 'Interested', description: 'Customer showed interest in services' },
                  { id: '2', name: 'Not Interested', description: 'Customer not interested at this time' },
                  { id: '3', name: 'Call Back Later', description: 'Customer requested to be called back' },
                  { id: '4', name: 'Wrong Number', description: 'Invalid or incorrect phone number' },
                  { id: '5', name: 'Voicemail', description: 'Left voicemail message' },
                  { id: '6', name: 'Appointment Set', description: 'Scheduled appointment for estimate' }
                ].map((disposition) => (
                  <Button
                    key={disposition.id}
                    variant="outline"
                    className="justify-start h-auto p-3"
                    onClick={() => saveCallDisposition(disposition.id)}
                  >
                    <div className="text-left">
                      <div className="font-medium">{disposition.name}</div>
                      <div className="text-sm text-muted-foreground">{disposition.description}</div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};