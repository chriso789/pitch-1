import React, { useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Home, MessageCircle, Gift, Briefcase, 
  Scale, Phone, Mail, MapPin
} from 'lucide-react';
import { useCustomerPortal } from '../hooks/useCustomerPortal';
import { JobStatusTimeline } from './JobStatusTimeline';
import { HousePhotoGallery } from './HousePhotoGallery';
import { CommunicationHub } from './CommunicationHub';
import { ReferralRewardsSection } from './ReferralRewardsSection';
import { AdditionalServicesCard } from './AdditionalServicesCard';
import { AttorneyRequestCard } from './AttorneyRequestCard';
import { MilestoneModal } from './MilestoneModals';

export function EnhancedCustomerPortal() {
  const { token } = useParams<{ token: string }>();
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedMilestone, setSelectedMilestone] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const {
    loading,
    project,
    milestones,
    photos,
    rewards,
    referrals,
    messages,
    company,
    contact,
    sendMessage,
    submitReferral,
    redeemPoints,
    requestAttorney,
    requestServiceQuote,
    uploadPhoto,
  } = useCustomerPortal(token || '');

  if (!token) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-4xl mx-auto p-4 space-y-6">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md mx-auto">
          <CardContent className="pt-6 text-center">
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground">
              This link is invalid or has expired. Please contact us for a new link.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handlePhotoUpload = async (file: File, description?: string) => {
    setIsUploading(true);
    try {
      await uploadPhoto(file, description);
    } finally {
      setIsUploading(false);
    }
  };

  const contactInfo = project.pipeline_entries?.[0]?.contacts;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      {/* Header */}
      <header 
        className="border-b px-4 py-4"
        style={{ 
          backgroundColor: company?.primary_color ? `${company.primary_color}10` : undefined 
        }}
      >
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            {company?.logo_url ? (
              <img 
                src={company.logo_url} 
                alt={company.name} 
                className="h-10 w-auto object-contain"
              />
            ) : (
              <div 
                className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
                style={{ backgroundColor: company?.primary_color || 'hsl(var(--primary))' }}
              >
                {company?.name?.charAt(0) || 'C'}
              </div>
            )}
            <div>
              <h1 className="font-semibold">{company?.name || 'Customer Portal'}</h1>
              <p className="text-sm text-muted-foreground">
                Welcome, {contactInfo?.first_name || 'Customer'}!
              </p>
            </div>
          </div>
          <Badge variant="outline" className="hidden sm:flex">
            {project.clj_formatted_number || project.name}
          </Badge>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-6">
        {/* Property Info */}
        {contactInfo && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Home className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-lg">
                    {contactInfo.first_name} {contactInfo.last_name}
                  </h2>
                  {contactInfo.address_street && (
                    <p className="text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      {contactInfo.address_street}, {contactInfo.address_city}, {contactInfo.address_state} {contactInfo.address_zip}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
                    {contactInfo.phone && (
                      <a href={`tel:${contactInfo.phone}`} className="flex items-center gap-1 hover:text-primary">
                        <Phone className="w-3 h-3" />
                        {contactInfo.phone}
                      </a>
                    )}
                    {contactInfo.email && (
                      <a href={`mailto:${contactInfo.email}`} className="flex items-center gap-1 hover:text-primary">
                        <Mail className="w-3 h-3" />
                        {contactInfo.email}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Job Status Timeline */}
        <Card>
          <CardContent className="pt-6">
            <JobStatusTimeline 
              currentStatus={project.customer_portal_status || 'contract_deposit'}
              onStageClick={setSelectedMilestone}
            />
          </CardContent>
        </Card>

        {/* Photo Gallery */}
        <HousePhotoGallery 
          photos={photos}
          onUpload={handlePhotoUpload}
          isUploading={isUploading}
        />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="overview" className="flex items-center gap-1">
              <Home className="w-4 h-4" />
              <span className="hidden sm:inline">Overview</span>
            </TabsTrigger>
            <TabsTrigger value="chat" className="flex items-center gap-1">
              <MessageCircle className="w-4 h-4" />
              <span className="hidden sm:inline">Chat</span>
            </TabsTrigger>
            <TabsTrigger value="rewards" className="flex items-center gap-1">
              <Gift className="w-4 h-4" />
              <span className="hidden sm:inline">Rewards</span>
            </TabsTrigger>
            <TabsTrigger value="services" className="flex items-center gap-1">
              <Briefcase className="w-4 h-4" />
              <span className="hidden sm:inline">Services</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Project Overview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Project</p>
                    <p className="font-medium">{project.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <Badge>{project.status}</Badge>
                  </div>
                  {project.estimated_completion_date && (
                    <div>
                      <p className="text-sm text-muted-foreground">Est. Completion</p>
                      <p className="font-medium">
                        {new Date(project.estimated_completion_date).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground">Created</p>
                    <p className="font-medium">
                      {new Date(project.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                {project.description && (
                  <div>
                    <p className="text-sm text-muted-foreground">Description</p>
                    <p className="mt-1">{project.description}</p>
                  </div>
                )}
              </CardContent>
            </Card>
            
            {/* Quick Contact */}
            {company && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Contact Us</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-4">
                    {company.phone && (
                      <a 
                        href={`tel:${company.phone}`}
                        className="flex items-center gap-2 text-primary hover:underline"
                      >
                        <Phone className="w-4 h-4" />
                        {company.phone}
                      </a>
                    )}
                    {company.email && (
                      <a 
                        href={`mailto:${company.email}`}
                        className="flex items-center gap-2 text-primary hover:underline"
                      >
                        <Mail className="w-4 h-4" />
                        {company.email}
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="chat" className="mt-4">
            <CommunicationHub 
              messages={messages}
              onSendMessage={sendMessage}
              projectId={project.id}
              token={token}
            />
          </TabsContent>

          <TabsContent value="rewards" className="mt-4">
            <ReferralRewardsSection 
              rewards={rewards}
              referrals={referrals}
              onSubmitReferral={submitReferral}
              onRedeemPoints={redeemPoints}
            />
          </TabsContent>

          <TabsContent value="services" className="space-y-4 mt-4">
            <AdditionalServicesCard onRequestQuote={requestServiceQuote} />
            <AttorneyRequestCard onRequestAttorney={requestAttorney} />
          </TabsContent>
        </Tabs>
      </main>

      {/* Milestone Modal */}
      {selectedMilestone && (
        <MilestoneModal
          isOpen={!!selectedMilestone}
          onClose={() => setSelectedMilestone(null)}
          stageKey={selectedMilestone}
          project={project}
        />
      )}
    </div>
  );
}
