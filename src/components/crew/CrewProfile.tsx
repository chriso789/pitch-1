import { useState } from 'react';
import { useCrewAuth } from '@/hooks/useCrewAuth';
import { useCrewCompliance } from '@/hooks/useCrewCompliance';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ArrowLeft, 
  User, 
  Phone, 
  Mail, 
  MapPin,
  AlertTriangle,
  Heart,
  Wrench,
  FileText,
  Upload,
  CheckCircle,
  Clock,
  XCircle,
  Loader2
} from 'lucide-react';
import { format, parseISO, differenceInDays } from 'date-fns';
import { CrewDocumentUpload } from './CrewDocumentUpload';

interface CrewProfileProps {
  onBack: () => void;
}

export function CrewProfile({ onBack }: CrewProfileProps) {
  const { crewProfile, loading: authLoading } = useCrewAuth();
  const { 
    overallStatus, 
    documents, 
    documentTypes, 
    missingRequired,
    loading: complianceLoading 
  } = useCrewCompliance();
  
  const [showUpload, setShowUpload] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState<string | null>(null);

  const loading = authLoading || complianceLoading;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'valid':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'expiring':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'expired':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getExpiryBadge = (daysUntilExpiry: number) => {
    if (daysUntilExpiry < 0) {
      return <Badge variant="destructive">Expired</Badge>;
    } else if (daysUntilExpiry <= 7) {
      return <Badge className="bg-red-500">Expires in {daysUntilExpiry} days</Badge>;
    } else if (daysUntilExpiry <= 30) {
      return <Badge className="bg-yellow-500">Expires in {daysUntilExpiry} days</Badge>;
    }
    return <Badge variant="outline" className="bg-green-500/10 text-green-600">Valid</Badge>;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background border-b">
        <div className="px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className="font-semibold">Profile</span>
        </div>
      </header>

      <div className="p-4">
        <Tabs defaultValue="contact" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="contact">Contact</TabsTrigger>
            <TabsTrigger value="emergency">Emergency</TabsTrigger>
            <TabsTrigger value="trade">Trade</TabsTrigger>
            <TabsTrigger value="docs">Docs</TabsTrigger>
          </TabsList>

          {/* Contact Info */}
          <TabsContent value="contact" className="space-y-4">
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Contact Information
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                {crewProfile?.legalBusinessName && (
                  <div>
                    <p className="text-xs text-muted-foreground">Business Name</p>
                    <p className="font-medium">{crewProfile.legalBusinessName}</p>
                  </div>
                )}
                {crewProfile?.dba && (
                  <div>
                    <p className="text-xs text-muted-foreground">DBA</p>
                    <p className="font-medium">{crewProfile.dba}</p>
                  </div>
                )}
                {crewProfile?.primaryContactName && (
                  <div>
                    <p className="text-xs text-muted-foreground">Contact Name</p>
                    <p className="font-medium">{crewProfile.primaryContactName}</p>
                  </div>
                )}
                {crewProfile?.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <a href={`tel:${crewProfile.phone}`} className="text-primary">
                      {crewProfile.phone}
                    </a>
                  </div>
                )}
                {crewProfile?.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <a href={`mailto:${crewProfile.email}`} className="text-primary">
                      {crewProfile.email}
                    </a>
                  </div>
                )}
                {crewProfile?.addressLine1 && (
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p>{crewProfile.addressLine1}</p>
                      {crewProfile.addressLine2 && <p>{crewProfile.addressLine2}</p>}
                      <p>{crewProfile.city}, {crewProfile.state} {crewProfile.postalCode}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Emergency Contact */}
          <TabsContent value="emergency" className="space-y-4">
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Heart className="h-4 w-4 text-red-500" />
                  Emergency Contact
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                {crewProfile?.emergencyContactName ? (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground">Name</p>
                      <p className="font-medium">{crewProfile.emergencyContactName}</p>
                    </div>
                    {crewProfile.emergencyContactRelationship && (
                      <div>
                        <p className="text-xs text-muted-foreground">Relationship</p>
                        <p className="font-medium">{crewProfile.emergencyContactRelationship}</p>
                      </div>
                    )}
                    {crewProfile.emergencyContactPhone && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <a href={`tel:${crewProfile.emergencyContactPhone}`} className="text-primary">
                          {crewProfile.emergencyContactPhone}
                        </a>
                      </div>
                    )}
                    {crewProfile.emergencyContactAltPhone && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <a href={`tel:${crewProfile.emergencyContactAltPhone}`} className="text-primary">
                          {crewProfile.emergencyContactAltPhone} (Alt)
                        </a>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">No emergency contact on file</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Trade Info */}
          <TabsContent value="trade" className="space-y-4">
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Wrench className="h-4 w-4" />
                  Trade Information
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Primary Trade</p>
                  <p className="font-medium">{crewProfile?.primaryTrade || 'Not specified'}</p>
                </div>
                {crewProfile?.tradeTags && crewProfile.tradeTags.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Specializations</p>
                    <div className="flex flex-wrap gap-2">
                      {crewProfile.tradeTags.map((tag, i) => (
                        <Badge key={i} variant="secondary">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Documents */}
          <TabsContent value="docs" className="space-y-4">
            {/* Overall Status */}
            <Card className={
              overallStatus === 'expired' ? 'border-red-500/30 bg-red-500/5' :
              overallStatus === 'expiring' ? 'border-yellow-500/30 bg-yellow-500/5' :
              'border-green-500/30 bg-green-500/5'
            }>
              <CardContent className="p-4 flex items-center gap-3">
                {getStatusIcon(overallStatus)}
                <div>
                  <p className="font-medium">
                    {overallStatus === 'valid' ? 'All Documents Valid' :
                     overallStatus === 'expiring' ? 'Documents Expiring Soon' :
                     'Document Issues'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {documents.length} documents on file
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Missing Required Documents */}
            {missingRequired.length > 0 && (
              <Card className="border-red-500/30">
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 text-red-600">
                    <AlertTriangle className="h-4 w-4" />
                    Missing Required Documents
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2">
                  {missingRequired.map((docType) => (
                    <div 
                      key={docType.id}
                      className="flex items-center justify-between p-2 bg-red-500/5 rounded"
                    >
                      <span className="text-sm">{docType.label}</span>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => {
                          setSelectedDocType(docType.id);
                          setShowUpload(true);
                        }}
                      >
                        <Upload className="h-3 w-3 mr-1" />
                        Upload
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Document List */}
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Your Documents
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                {documents.length === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-4">
                    No documents uploaded yet
                  </p>
                ) : (
                  documents.map((doc) => (
                    <div 
                      key={doc.id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        {getStatusIcon(doc.status)}
                        <div>
                          <p className="font-medium text-sm">{doc.typeLabel}</p>
                          <p className="text-xs text-muted-foreground">
                            Expires: {format(parseISO(doc.expirationDate), 'MMM d, yyyy')}
                          </p>
                        </div>
                      </div>
                      {getExpiryBadge(doc.daysUntilExpiry)}
                    </div>
                  ))
                )}

                <Button 
                  variant="outline" 
                  className="w-full mt-4"
                  onClick={() => {
                    setSelectedDocType(null);
                    setShowUpload(true);
                  }}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Upload New Document
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Document Upload Modal */}
      {showUpload && (
        <CrewDocumentUpload
          documentTypes={documentTypes}
          preselectedTypeId={selectedDocType}
          onClose={() => {
            setShowUpload(false);
            setSelectedDocType(null);
          }}
        />
      )}
    </div>
  );
}
