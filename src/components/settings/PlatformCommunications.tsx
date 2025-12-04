import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Send, 
  Mail, 
  Building2, 
  Megaphone,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Sparkles,
  Wrench,
  Bell,
  Users,
  History
} from "lucide-react";
import { BulkOnboardingPanel } from "./BulkOnboardingPanel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Company {
  id: string;
  name: string;
  email: string | null;
}

interface Announcement {
  id: string;
  title: string;
  message: string;
  announcement_type: string;
  status: string;
  sent_at: string | null;
  created_at: string;
  target_companies: string[];
}

const ANNOUNCEMENT_TEMPLATES = {
  feature: {
    icon: Sparkles,
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
    label: 'New Feature'
  },
  maintenance: {
    icon: Wrench,
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
    label: 'Maintenance'
  },
  urgent: {
    icon: AlertCircle,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
    label: 'Urgent'
  },
  general: {
    icon: Bell,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    label: 'General'
  }
};

export const PlatformCommunications = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const { toast } = useToast();

  // New announcement form state
  const [newAnnouncement, setNewAnnouncement] = useState({
    title: '',
    message: '',
    type: 'general',
    targetAll: true,
    selectedCompanies: new Set<string>()
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      const [companiesRes, announcementsRes] = await Promise.all([
        supabase.from('tenants').select('id, name, email').order('name'),
        supabase.from('platform_announcements').select('*').order('created_at', { ascending: false })
      ]);

      setCompanies(companiesRes.data || []);
      setAnnouncements((announcementsRes.data || []) as Announcement[]);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleCompany = (id: string) => {
    const newSelected = new Set(newAnnouncement.selectedCompanies);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setNewAnnouncement({ ...newAnnouncement, selectedCompanies: newSelected, targetAll: false });
  };

  const sendAnnouncement = async () => {
    if (!newAnnouncement.title || !newAnnouncement.message) {
      toast({
        title: "Missing fields",
        description: "Please fill in title and message",
        variant: "destructive"
      });
      return;
    }

    setSending(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const targetCompanies = newAnnouncement.targetAll 
        ? [] 
        : Array.from(newAnnouncement.selectedCompanies);

      // Save announcement to database
      const { data: announcement, error: saveError } = await supabase
        .from('platform_announcements')
        .insert({
          title: newAnnouncement.title,
          message: newAnnouncement.message,
          announcement_type: newAnnouncement.type,
          target_companies: targetCompanies,
          sent_by: user?.id,
          status: 'sent',
          sent_at: new Date().toISOString()
        })
        .select()
        .single();

      if (saveError) throw saveError;

      // Send via edge function
      const { error: sendError } = await supabase.functions.invoke('send-platform-announcement', {
        body: {
          announcement_id: announcement.id,
          title: newAnnouncement.title,
          message: newAnnouncement.message,
          announcement_type: newAnnouncement.type,
          target_companies: targetCompanies.length > 0 ? targetCompanies : null
        }
      });

      if (sendError) {
        console.warn('Email send warning:', sendError);
      }

      toast({
        title: "Announcement sent! 📢",
        description: `Sent to ${newAnnouncement.targetAll ? 'all companies' : `${targetCompanies.length} companies`}`
      });

      // Reset form
      setNewAnnouncement({
        title: '',
        message: '',
        type: 'general',
        targetAll: true,
        selectedCompanies: new Set()
      });

      loadData();
    } catch (error: any) {
      console.error('Error sending announcement:', error);
      toast({
        title: "Failed to send announcement",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setSending(false);
    }
  };

  const applyTemplate = (type: string) => {
    const templates: Record<string, { title: string; message: string }> = {
      feature: {
        title: '🚀 New Feature: [Feature Name]',
        message: "We're excited to announce a new feature that will help you [benefit].\n\n**What's New:**\n- Feature detail 1\n- Feature detail 2\n- Feature detail 3\n\n**How to Access:**\nSimply navigate to [location] in your dashboard.\n\nQuestions? Reply to this email or contact support."
      },
      maintenance: {
        title: '🔧 Scheduled Maintenance Notice',
        message: "We'll be performing scheduled maintenance on [Date] from [Time] to [Time] (EST).\n\n**What to Expect:**\n- Brief service interruption\n- All data is safe and secure\n- No action required from you\n\nWe apologize for any inconvenience and appreciate your patience."
      },
      urgent: {
        title: '⚠️ Important: [Issue/Update]',
        message: "This is an urgent notice regarding [issue].\n\n**Action Required:**\n[Describe what users need to do]\n\n**Timeline:**\n[When this needs to be addressed]\n\nIf you have questions, please contact support immediately."
      },
      general: {
        title: '📢 Update from PITCH CRM',
        message: "Hello from the PITCH CRM team!\n\nWe wanted to share some updates with you:\n\n[Your message here]\n\nThank you for being part of our community.\n\nBest regards,\nThe PITCH CRM Team"
      }
    };

    const template = templates[type];
    if (template) {
      setNewAnnouncement({
        ...newAnnouncement,
        title: template.title,
        message: template.message,
        type
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            Platform Communications Hub
          </h3>
          <p className="text-sm text-muted-foreground">
            Send announcements to all companies in the CRM
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="compose">
        <TabsList>
          <TabsTrigger value="compose" className="gap-2">
            <Send className="h-4 w-4" />
            Compose
          </TabsTrigger>
          <TabsTrigger value="onboarding" className="gap-2">
            <Mail className="h-4 w-4" />
            Onboarding Invites
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" />
            History
          </TabsTrigger>
        </TabsList>

        {/* Compose Tab */}
        <TabsContent value="compose" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Compose Form */}
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">New Announcement</CardTitle>
                  <CardDescription>Compose and send to company owners</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Quick Templates */}
                  <div>
                    <Label className="text-sm text-muted-foreground mb-2 block">Quick Templates</Label>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(ANNOUNCEMENT_TEMPLATES).map(([key, config]) => {
                        const Icon = config.icon;
                        return (
                          <Button
                            key={key}
                            variant="outline"
                            size="sm"
                            onClick={() => applyTemplate(key)}
                            className={`${newAnnouncement.type === key ? 'ring-2 ring-primary' : ''}`}
                          >
                            <Icon className={`h-4 w-4 mr-2 ${config.color}`} />
                            {config.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Title */}
                  <div>
                    <Label>Title</Label>
                    <Input
                      placeholder="Announcement title..."
                      value={newAnnouncement.title}
                      onChange={(e) => setNewAnnouncement({ ...newAnnouncement, title: e.target.value })}
                    />
                  </div>

                  {/* Message */}
                  <div>
                    <Label>Message</Label>
                    <Textarea
                      placeholder="Write your announcement..."
                      value={newAnnouncement.message}
                      onChange={(e) => setNewAnnouncement({ ...newAnnouncement, message: e.target.value })}
                      rows={8}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Supports basic markdown: **bold**, *italic*, - lists
                    </p>
                  </div>

                  {/* Type Selection */}
                  <div>
                    <Label>Announcement Type</Label>
                    <Select
                      value={newAnnouncement.type}
                      onValueChange={(value) => setNewAnnouncement({ ...newAnnouncement, type: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ANNOUNCEMENT_TEMPLATES).map(([key, config]) => {
                          const Icon = config.icon;
                          return (
                            <SelectItem key={key} value={key}>
                              <div className="flex items-center gap-2">
                                <Icon className={`h-4 w-4 ${config.color}`} />
                                {config.label}
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Send Button */}
                  <Button 
                    className="w-full" 
                    size="lg"
                    onClick={sendAnnouncement}
                    disabled={sending || !newAnnouncement.title || !newAnnouncement.message}
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    Send Announcement
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Target Selection */}
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Target Audience
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="target-all"
                      checked={newAnnouncement.targetAll}
                      onCheckedChange={(checked) => 
                        setNewAnnouncement({ 
                          ...newAnnouncement, 
                          targetAll: !!checked,
                          selectedCompanies: checked ? new Set() : newAnnouncement.selectedCompanies
                        })
                      }
                    />
                    <Label htmlFor="target-all" className="font-medium">
                      All Companies ({companies.length})
                    </Label>
                  </div>

                  {!newAnnouncement.targetAll && (
                    <ScrollArea className="h-[300px] border rounded-lg p-2">
                      <div className="space-y-1">
                        {companies.map((company) => (
                          <div 
                            key={company.id}
                            className="flex items-center gap-2 p-2 hover:bg-muted rounded-lg cursor-pointer"
                            onClick={() => toggleCompany(company.id)}
                          >
                            <Checkbox
                              checked={newAnnouncement.selectedCompanies.has(company.id)}
                              onCheckedChange={() => toggleCompany(company.id)}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{company.name}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {company.email || 'No email'}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}

                  {!newAnnouncement.targetAll && (
                    <p className="text-sm text-muted-foreground">
                      Selected: {newAnnouncement.selectedCompanies.size} companies
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Onboarding Tab */}
        <TabsContent value="onboarding" className="mt-6">
          <BulkOnboardingPanel />
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Announcement History</CardTitle>
              <CardDescription>Previously sent platform announcements</CardDescription>
            </CardHeader>
            <CardContent>
              {announcements.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Megaphone className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No announcements sent yet</p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-4">
                    {announcements.map((announcement) => {
                      const config = ANNOUNCEMENT_TEMPLATES[announcement.announcement_type as keyof typeof ANNOUNCEMENT_TEMPLATES] 
                        || ANNOUNCEMENT_TEMPLATES.general;
                      const Icon = config.icon;
                      
                      return (
                        <div key={announcement.id} className="p-4 border rounded-lg">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className={`p-2 rounded-lg ${config.bgColor}`}>
                                <Icon className={`h-4 w-4 ${config.color}`} />
                              </div>
                              <div>
                                <h4 className="font-medium">{announcement.title}</h4>
                                <p className="text-xs text-muted-foreground">
                                  {announcement.sent_at 
                                    ? new Date(announcement.sent_at).toLocaleString()
                                    : 'Not sent'}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={announcement.status === 'sent' ? 'default' : 'secondary'}>
                                {announcement.status}
                              </Badge>
                              <Badge variant="outline">
                                {announcement.target_companies.length > 0 
                                  ? `${announcement.target_companies.length} companies` 
                                  : 'All companies'}
                              </Badge>
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-3">
                            {announcement.message}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
