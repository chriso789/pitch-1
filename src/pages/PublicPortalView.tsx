import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { usePortalRealtime } from '@/features/portal/hooks/usePortalRealtime';
import { BeforeAfterSlider } from '@/components/storm-canvass/BeforeAfterSlider';
import {
  Building2,
  Calendar,
  Camera,
  CheckCircle,
  Clock,
  DollarSign,
  FileText,
  Home,
  Lock,
  MessageSquare,
  Phone,
  RefreshCw,
  Shield,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

interface PortalData {
  contact: {
    id: string;
    first_name: string;
    last_name: string;
    address_street: string;
    address_city: string;
    address_state: string;
    address_zip: string;
  };
  project?: {
    id: string;
    name: string;
    status: string;
    start_date: string;
    estimated_completion_date: string;
    description: string;
  };
  photos: Array<{
    id: string;
    url: string;
    category: string;
    notes: string;
    created_at: string;
  }>;
  estimates: Array<{
    id: string;
    name: string;
    total_amount: number;
    status: string;
    created_at: string;
  }>;
  milestones: Array<{
    id: string;
    name: string;
    completed: boolean;
    completed_at?: string;
  }>;
}

export const PublicPortalView: React.FC = () => {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [portalData, setPortalData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Real-time updates
  const { isConnected, lastUpdate } = usePortalRealtime({
    contactId: portalData?.contact?.id || '',
    projectId: portalData?.project?.id,
    onUpdate: (update) => {
      toast({
        title: 'Update',
        description: `New ${update.type.replace('_', ' ')} received`,
      });
      // Refresh data on update
      fetchPortalData();
    },
  });

  const fetchPortalData = async () => {
    if (!shareToken) return;

    try {
      setLoading(true);
      
      // Validate token and get data
      const { data, error: fetchError } = await supabase.functions.invoke('customer-portal-access', {
        body: { token: shareToken },
      });

      if (fetchError) throw fetchError;
      if (!data) throw new Error('Portal not found');

      setPortalData(data);

      // Log view event
      await supabase.functions.invoke('record-view-event', {
        body: { 
          token: shareToken,
          event_type: 'portal_view',
        },
      });
    } catch (err: any) {
      console.error('Portal fetch error:', err);
      setError(err.message || 'Unable to load portal');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPortalData();
  }, [shareToken]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading your project portal...</p>
        </div>
      </div>
    );
  }

  if (error || !portalData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-6 text-center">
            <Lock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Portal Unavailable</h2>
            <p className="text-muted-foreground mb-4">
              {error || 'This portal link may have expired or is invalid.'}
            </p>
            <p className="text-sm text-muted-foreground">
              Please contact us if you need access to your project information.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { contact, project, photos, estimates, milestones } = portalData;

  const getProgressPercentage = () => {
    if (!milestones || milestones.length === 0) return 0;
    const completed = milestones.filter(m => m.completed).length;
    return Math.round((completed / milestones.length) * 100);
  };

  const beforePhotos = photos.filter(p => p.category === 'before');
  const afterPhotos = photos.filter(p => p.category === 'after');

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Home className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="font-semibold">{contact.first_name} {contact.last_name}</h1>
                <p className="text-sm text-muted-foreground">
                  {contact.address_street}, {contact.address_city}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isConnected && (
                <Badge variant="outline" className="gap-1">
                  <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  Live
                </Badge>
              )}
              <Badge variant="secondary">
                <Shield className="h-3 w-3 mr-1" />
                Secure Portal
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6">
        {/* Project Overview */}
        {project && (
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  {project.name}
                </CardTitle>
                <Badge>{project.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">{project.description}</p>
              
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Start Date</p>
                    <p className="font-medium">
                      {format(new Date(project.start_date), 'MMMM d, yyyy')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Est. Completion</p>
                    <p className="font-medium">
                      {format(new Date(project.estimated_completion_date), 'MMMM d, yyyy')}
                    </p>
                  </div>
                </div>
              </div>

              {/* Progress */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Project Progress</span>
                  <span className="font-medium">{getProgressPercentage()}%</span>
                </div>
                <Progress value={getProgressPercentage()} className="h-3" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs defaultValue="photos" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="photos" className="gap-2">
              <Camera className="h-4 w-4" />
              <span className="hidden sm:inline">Photos</span>
            </TabsTrigger>
            <TabsTrigger value="estimates" className="gap-2">
              <DollarSign className="h-4 w-4" />
              <span className="hidden sm:inline">Estimates</span>
            </TabsTrigger>
            <TabsTrigger value="progress" className="gap-2">
              <CheckCircle className="h-4 w-4" />
              <span className="hidden sm:inline">Progress</span>
            </TabsTrigger>
            <TabsTrigger value="contact" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              <span className="hidden sm:inline">Contact</span>
            </TabsTrigger>
          </TabsList>

          {/* Photos Tab */}
          <TabsContent value="photos">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Project Photos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Before/After Comparison */}
                {beforePhotos.length > 0 && afterPhotos.length > 0 && (
                  <div>
                    <h3 className="font-medium mb-3">Before & After</h3>
                    <BeforeAfterSlider
                      beforeImage={beforePhotos[0].url}
                      afterImage={afterPhotos[0].url}
                      className="rounded-lg overflow-hidden"
                    />
                  </div>
                )}

                <Separator />

                {/* Photo Grid */}
                <div>
                  <h3 className="font-medium mb-3">All Photos ({photos.length})</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {photos.map((photo) => (
                      <div
                        key={photo.id}
                        className="aspect-square rounded-lg overflow-hidden bg-muted relative group"
                      >
                        <img
                          src={photo.url}
                          alt={photo.notes || 'Project photo'}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                          <div className="text-white text-xs">
                            <Badge variant="secondary" className="text-xs">
                              {photo.category}
                            </Badge>
                            <p className="mt-1">{formatDistanceToNow(new Date(photo.created_at), { addSuffix: true })}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Estimates Tab */}
          <TabsContent value="estimates">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Estimates & Proposals</CardTitle>
              </CardHeader>
              <CardContent>
                {estimates.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No estimates available yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {estimates.map((estimate) => (
                      <div
                        key={estimate.id}
                        className="flex items-center justify-between p-4 rounded-lg border"
                      >
                        <div>
                          <h4 className="font-medium">{estimate.name}</h4>
                          <p className="text-sm text-muted-foreground">
                            {formatDistanceToNow(new Date(estimate.created_at), { addSuffix: true })}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-primary">
                            ${estimate.total_amount.toLocaleString()}
                          </p>
                          <Badge variant="outline">{estimate.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Progress Tab */}
          <TabsContent value="progress">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Project Milestones</CardTitle>
              </CardHeader>
              <CardContent>
                {milestones.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No milestones available yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {milestones.map((milestone, index) => (
                      <div
                        key={milestone.id}
                        className="flex items-center gap-4 p-3 rounded-lg border"
                      >
                        <div className={`
                          flex items-center justify-center w-8 h-8 rounded-full border-2
                          ${milestone.completed 
                            ? 'bg-green-500 border-green-500 text-white' 
                            : 'border-muted-foreground text-muted-foreground'
                          }
                        `}>
                          {milestone.completed ? (
                            <CheckCircle className="h-4 w-4" />
                          ) : (
                            <span className="text-sm font-medium">{index + 1}</span>
                          )}
                        </div>
                        <div className="flex-1">
                          <p className={`font-medium ${milestone.completed ? '' : 'text-muted-foreground'}`}>
                            {milestone.name}
                          </p>
                          {milestone.completed_at && (
                            <p className="text-xs text-muted-foreground">
                              Completed {formatDistanceToNow(new Date(milestone.completed_at), { addSuffix: true })}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Contact Tab */}
          <TabsContent value="contact">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Contact Us</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">
                  Have questions about your project? We're here to help.
                </p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Button className="w-full gap-2">
                    <Phone className="h-4 w-4" />
                    Call Us
                  </Button>
                  <Button variant="outline" className="w-full gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Send Message
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Footer */}
      <div className="border-t mt-8">
        <div className="container mx-auto px-4 py-4 text-center text-sm text-muted-foreground">
          <p>This is a secure customer portal. Your data is protected.</p>
        </div>
      </div>
    </div>
  );
};

export default PublicPortalView;
