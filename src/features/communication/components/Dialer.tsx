import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Phone, Play, Pause, Square, PhoneOff, Clock, Users, List, Settings, Plus, Building, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ContactHeader } from "@/components/ContactHeader";

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

interface ContactData {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  leadScore?: number;
  status?: string;
  type?: string;
}

interface CallDisposition {
  id: string;
  name: string;
  description?: string;
  is_positive: boolean;
}

interface DialerProps {
  preloadedContact?: any;
  isLoadingContact?: boolean;
}

export const Dialer: React.FC<DialerProps> = ({ preloadedContact, isLoadingContact = false }) => {
  const { toast } = useToast();

  // State management
  const [campaigns, setCampaigns] = useState<DialerCampaign[]>([]);
  const [lists, setLists] = useState<DialerList[]>([]);
  const [dispositions, setDispositions] = useState<CallDisposition[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<DialerCampaign | null>(null);
  const [currentContact, setCurrentContact] = useState<ContactData | null>(null);
  const [isCallActive, setIsCallActive] = useState(false);
  const [callStartTime, setCallStartTime] = useState<Date | null>(null);
  const [showDispositionDialog, setShowDispositionDialog] = useState(false);
  const [selectedDisposition, setSelectedDisposition] = useState<string>("");
  const [dispositionNotes, setDispositionNotes] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [selectedCallerId, setSelectedCallerId] = useState<string>("");
  const [availablePhoneNumbers, setAvailablePhoneNumbers] = useState<Array<{number: string, label: string}>>([]);

  // Load data on component mount
  useEffect(() => {
    loadData();
    loadCallerIdSettings();
  }, []);

  // Load caller ID settings
  const loadCallerIdSettings = async () => {
    try {
      // Try localStorage first
      const localSettings = localStorage.getItem('caller_id_config');
      if (localSettings) {
        const settings = JSON.parse(localSettings);
        if (settings.phone_number) {
          const phoneEntry = {
            number: settings.phone_number,
            label: settings.display_name || settings.company_name || settings.phone_number
          };
          setAvailablePhoneNumbers([phoneEntry]);
          setSelectedCallerId(settings.phone_number);
        }
      }
      
      // Also try database
      const { data } = await supabase
        .from('app_settings')
        .select('setting_value')
        .eq('setting_key', 'caller_id_config')
        .maybeSingle();
      
      if (data?.setting_value) {
        const settings = data.setting_value as any;
        if (settings.phone_number) {
          const phoneEntry = {
            number: settings.phone_number,
            label: settings.display_name || settings.company_name || settings.phone_number
          };
          setAvailablePhoneNumbers([phoneEntry]);
          setSelectedCallerId(settings.phone_number);
        }
      }
    } catch (error) {
      console.error('Error loading caller ID settings:', error);
    }
  };

  // Handle preloaded contact from props
  useEffect(() => {
    if (preloadedContact) {
      const contactData: ContactData = {
        id: preloadedContact.id,
        name: `${preloadedContact.first_name || ''} ${preloadedContact.last_name || ''}`.trim(),
        phone: preloadedContact.phone,
        email: preloadedContact.email,
        address: preloadedContact.address_street ? 
          `${preloadedContact.address_street}, ${preloadedContact.address_city || ''}, ${preloadedContact.address_state || ''} ${preloadedContact.address_zip || ''}`.trim() : 
          undefined,
        leadScore: preloadedContact.lead_score,
        status: preloadedContact.qualification_status || 'unqualified',
        type: preloadedContact.type
      };
      setCurrentContact(contactData);
    }
  }, [preloadedContact]);

  // Load sample data and actual data from database
  const loadData = async () => {
    try {
      // Load dialer campaigns
      const { data: campaignsData, error: campaignsError } = await supabase
        .from('dialer_campaigns')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (!campaignsError && campaignsData) {
        setCampaigns(campaignsData);
      }

      // Load dialer lists
      const { data: listsData, error: listsError } = await supabase
        .from('dialer_lists')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (!listsError && listsData) {
        setLists(listsData);
      }

      // Load call dispositions
      const { data: dispositionsData, error: dispositionsError } = await supabase
        .from('dialer_dispositions')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (!dispositionsError && dispositionsData) {
        setDispositions(dispositionsData);
      }

      setLoading(false);
    } catch (error) {
      console.error('Error loading dialer data:', error);
      setLoading(false);
    }
  };

  // Start a campaign
  const startCampaign = async (campaign: DialerCampaign) => {
    setActiveCampaign(campaign);
    loadNextContact();
    
    toast({
      title: "Campaign Started",
      description: `Starting campaign: ${campaign.name}`,
    });
  };

  // Load next contact in campaign
  const loadNextContact = async () => {
    if (!activeCampaign) return;

    try {
      // Load contacts from the campaign's list
      const { data: listItems, error } = await supabase
        .from('dialer_list_items')
        .select('*')
        .eq('list_id', activeCampaign.list_id)
        .eq('status', 'pending')
        .limit(1);

      if (!error && listItems && listItems.length > 0) {
        const item = listItems[0];
        const contactData: ContactData = {
          id: item.id,
          name: `${item.first_name || ''} ${item.last_name || ''}`.trim(),
          phone: item.phone,
          email: item.email,
          status: item.status
        };
        setCurrentContact(contactData);
      } else {
        toast({
          title: "Campaign Complete",
          description: "No more contacts in this campaign.",
        });
      }
    } catch (error) {
      console.error('Error loading next contact:', error);
    }
  };

  // Initiate call
  const initiateCall = () => {
    if (!currentContact?.phone) {
      toast({
        title: "No Phone Number",
        description: "This contact doesn't have a phone number.",
        variant: "destructive"
      });
      return;
    }

    if (!selectedCallerId) {
      toast({
        title: "No Caller ID Selected",
        description: "Please configure a caller ID phone number in settings.",
        variant: "destructive"
      });
      return;
    }

    setIsCallActive(true);
    setCallStartTime(new Date());
    
    toast({
      title: "Call Started",
      description: `Calling ${currentContact.name} from ${selectedCallerId}`,
    });

    // Here you would integrate with WebRTC or calling service
    // For now, we'll simulate the call interface
  };

  // End call
  const endCall = () => {
    setIsCallActive(false);
    setShowDispositionDialog(true);
  };

  // Save call disposition
  const saveCallDisposition = async () => {
    if (!selectedDisposition || !currentContact) return;

    try {
      // Log the call
      const callDuration = callStartTime ? 
        Math.floor((new Date().getTime() - callStartTime.getTime()) / 1000) : 0;

      // Get user's tenant_id for the call log
      const { data: userData } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', userData.user?.id)
        .single();

      const { error } = await supabase
        .from('calls')
        .insert([{
          tenant_id: profile?.tenant_id,
          status: selectedDisposition,
          duration: callDuration,
          notes: dispositionNotes
        }]);

      if (!error) {
        toast({
          title: "Call Logged",
          description: `Call disposition saved: ${selectedDisposition}`,
        });

        // Reset call state
        setCallStartTime(null);
        setShowDispositionDialog(false);
        setSelectedDisposition("");
        setDispositionNotes("");
        
        // Load next contact if in campaign
        if (activeCampaign) {
          loadNextContact();
        }
      }
    } catch (error) {
      console.error('Error saving call disposition:', error);
    }
  };

  // Format call duration
  const formatCallDuration = () => {
    if (!callStartTime) return "00:00";
    
    const elapsed = Math.floor((new Date().getTime() - callStartTime.getTime()) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  if (loading || isLoadingContact) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading dialer...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Contact Header - Show when contact is preloaded */}
      {currentContact && (
        <ContactHeader 
          contact={currentContact}
          onCall={initiateCall}
          onText={() => toast({ title: "SMS", description: "SMS feature coming soon" })}
          onEmail={() => toast({ title: "Email", description: "Email feature coming soon" })}
        />
      )}

      {/* Power Dialer Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Power Dialer</h1>
          <p className="text-muted-foreground">Advanced sales communication system</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4" />
            <Label className="text-sm">Caller ID:</Label>
            <Select value={selectedCallerId} onValueChange={setSelectedCallerId}>
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="Select phone number" />
              </SelectTrigger>
              <SelectContent>
                {availablePhoneNumbers.length > 0 ? (
                  availablePhoneNumbers.map((phone) => (
                    <SelectItem key={phone.number} value={phone.number}>
                      {phone.label}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="none" disabled>
                    No phone numbers configured
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Active Call Interface */}
      {activeCampaign && currentContact && (
        <Card className="border-primary bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building className="h-5 w-5" />
              Active Campaign: {activeCampaign.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">{currentContact.name}</h3>
                <p className="text-muted-foreground">{currentContact.phone}</p>
                {currentContact.email && (
                  <p className="text-sm text-muted-foreground">{currentContact.email}</p>
                )}
              </div>
              
              <div className="flex items-center gap-4">
                {isCallActive && (
                  <div className="flex items-center gap-2 text-green-600">
                    <Clock className="h-4 w-4" />
                    <span className="font-mono">{formatCallDuration()}</span>
                  </div>
                )}
                
                <div className="flex gap-2">
                  {!isCallActive ? (
                    <Button onClick={initiateCall} className="bg-green-600 hover:bg-green-700">
                      <Phone className="h-4 w-4 mr-2" />
                      Start Call
                    </Button>
                  ) : (
                    <Button onClick={endCall} variant="destructive">
                      <PhoneOff className="h-4 w-4 mr-2" />
                      End Call
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Dialer Tabs */}
      <Tabs defaultValue="campaigns" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
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

        {/* Campaigns Tab */}
        <TabsContent value="campaigns" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Dialer Campaigns</h3>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              New Campaign
            </Button>
          </div>
          
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {campaigns.length > 0 ? (
              campaigns.map((campaign) => (
                <Card key={campaign.id} className="cursor-pointer hover:shadow-md transition-shadow">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>{campaign.name}</span>
                      <Badge variant={campaign.status === 'active' ? 'default' : 'secondary'}>
                        {campaign.status}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">
                      {campaign.description || 'No description available'}
                    </p>
                    <Button 
                      onClick={() => startCampaign(campaign)} 
                      className="w-full"
                      disabled={campaign.status !== 'active'}
                    >
                      <Play className="h-4 w-4 mr-2" />
                      Start Campaign
                    </Button>
                  </CardContent>
                </Card>
              ))
            ) : (
              <Card className="col-span-full">
                <CardContent className="p-6 text-center">
                  <p className="text-muted-foreground">No campaigns available. Create your first campaign to get started.</p>
                  <Button className="mt-4">
                    <Plus className="h-4 w-4 mr-2" />
                    Create Campaign
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Lists Tab */}
        <TabsContent value="lists" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Contact Lists</h3>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              New List
            </Button>
          </div>
          
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {lists.length > 0 ? (
              lists.map((list) => (
                <Card key={list.id}>
                  <CardHeader>
                    <CardTitle>{list.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        {list.description || 'No description available'}
                      </p>
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        <span className="text-sm">{list.total_items} contacts</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              <Card className="col-span-full">
                <CardContent className="p-6 text-center">
                  <p className="text-muted-foreground">No contact lists available. Create your first list to get started.</p>
                  <Button className="mt-4">
                    <Plus className="h-4 w-4 mr-2" />
                    Create List
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Dispositions Tab */}
        <TabsContent value="dispositions" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Call Dispositions</h3>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              New Disposition
            </Button>
          </div>
          
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {dispositions.length > 0 ? (
              dispositions.map((disposition) => (
                <Card key={disposition.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>{disposition.name}</span>
                      <Badge variant={disposition.is_positive ? 'default' : 'secondary'}>
                        {disposition.is_positive ? 'Positive' : 'Negative'}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {disposition.description || 'No description available'}
                    </p>
                  </CardContent>
                </Card>
              ))
            ) : (
              <Card className="col-span-full">
                <CardContent className="p-6 text-center">
                  <p className="text-muted-foreground">No call dispositions configured. Set up dispositions to track call outcomes.</p>
                  <Button className="mt-4">
                    <Plus className="h-4 w-4 mr-2" />
                    Create Disposition
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
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
              <Label htmlFor="disposition">Call Result</Label>
              <Select value={selectedDisposition} onValueChange={setSelectedDisposition}>
                <SelectTrigger>
                  <SelectValue placeholder="Select disposition" />
                </SelectTrigger>
                <SelectContent>
                  {dispositions.map((disposition) => (
                    <SelectItem key={disposition.id} value={disposition.name}>
                      {disposition.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={dispositionNotes}
                onChange={(e) => setDispositionNotes(e.target.value)}
                placeholder="Add any notes about this call..."
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={saveCallDisposition} disabled={!selectedDisposition}>
                Save Disposition
              </Button>
              <Button variant="outline" onClick={() => setShowDispositionDialog(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};