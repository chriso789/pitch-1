// ============================================================
// Scope Intelligence Dashboard
// Central hub for insurance scope document management
// ============================================================

import React, { useState } from 'react';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  FileText, 
  Upload, 
  Search, 
  TrendingUp, 
  Database,
  RefreshCw,
  ExternalLink,
  BarChart3,
  Package
} from 'lucide-react';
import { useScopeDocuments } from '@/hooks/useScopeIntelligence';
import { ScopeUploader } from '@/components/insurance/ScopeUploader';
import { ScopeViewer } from '@/components/insurance/ScopeViewer';
import { ScopeIntelligenceDashboard } from '@/components/insurance/ScopeIntelligenceDashboard';
import { DisputeEvidenceBuilder } from '@/components/insurance/DisputeEvidenceBuilder';
import { getCarrierDisplayName, getParseStatusInfo, getDocumentTypeLabel } from '@/lib/insurance/canonicalItems';
import { format } from 'date-fns';

const ScopeIntelligence: React.FC = () => {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  
  const { data: documents, isLoading, refetch } = useScopeDocuments();

  const stats = {
    totalDocuments: documents?.length || 0,
    parsedDocuments: documents?.filter(d => d.parse_status === 'complete').length || 0,
    pendingReview: documents?.filter(d => d.parse_status === 'needs_review').length || 0,
    carriers: new Set(documents?.map(d => d.carrier_normalized).filter(Boolean)).size,
  };

  if (selectedDocumentId) {
    return (
      <GlobalLayout>
        <ScopeViewer 
          documentId={selectedDocumentId}
          onClose={() => setSelectedDocumentId(null)}
          className="h-[calc(100vh-6rem)]"
        />
      </GlobalLayout>
    );
  }

  return (
    <GlobalLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Scope Intelligence</h1>
            <p className="text-muted-foreground">
              Transform insurance scopes into searchable evidence
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.totalDocuments}</p>
                  <p className="text-xs text-muted-foreground">Total Documents</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Database className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.parsedDocuments}</p>
                  <p className="text-xs text-muted-foreground">Parsed & Indexed</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-lg">
                  <Search className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.pendingReview}</p>
                  <p className="text-xs text-muted-foreground">Needs Review</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-lg">
                  <TrendingUp className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.carriers}</p>
                  <p className="text-xs text-muted-foreground">Carriers Tracked</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="dashboard">
              <BarChart3 className="h-4 w-4 mr-2" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="documents">
              <FileText className="h-4 w-4 mr-2" />
              Documents
            </TabsTrigger>
            <TabsTrigger value="upload">
              <Upload className="h-4 w-4 mr-2" />
              Upload
            </TabsTrigger>
            <TabsTrigger value="disputes">
              <Package className="h-4 w-4 mr-2" />
              Supplements
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="mt-4">
            <ScopeIntelligenceDashboard />
          </TabsContent>

          <TabsContent value="documents" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Ingested Scope Documents</CardTitle>
                <CardDescription>
                  Insurance estimates and supplements with extracted line items
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : documents && documents.length > 0 ? (
                  <div className="space-y-2">
                    {documents.map(doc => {
                      const statusInfo = getParseStatusInfo(doc.parse_status);
                      return (
                        <div
                          key={doc.id}
                          className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                          onClick={() => setSelectedDocumentId(doc.id)}
                        >
                          <div className="flex items-center gap-4">
                            <div className="p-2 bg-muted rounded-lg">
                              <FileText className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium">{doc.file_name}</p>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <span>{getDocumentTypeLabel(doc.document_type)}</span>
                                {doc.carrier_normalized && (
                                  <>
                                    <span>•</span>
                                    <span>{getCarrierDisplayName(doc.carrier_normalized)}</span>
                                  </>
                                )}
                                <span>•</span>
                                <span>{format(new Date(doc.created_at), 'MMM d, yyyy')}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
                            <Button variant="ghost" size="icon">
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2">No documents yet</h3>
                    <p className="text-muted-foreground mb-4">
                      Upload insurance scope PDFs to start building your evidence vault
                    </p>
                    <Button onClick={() => setActiveTab('upload')}>
                      <Upload className="h-4 w-4 mr-2" />
                      Upload First Scope
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="upload" className="mt-4">
            <ScopeUploader 
              onUploadComplete={(docId) => {
                setSelectedDocumentId(docId);
              }}
            />
          </TabsContent>

          <TabsContent value="disputes" className="mt-4">
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Build Supplement Evidence</h2>
                <p className="text-sm text-muted-foreground">
                  Create evidence packets with prior paid examples to support your supplement claims
                </p>
              </div>
              <DisputeEvidenceBuilder 
                onPacketCreated={(packetId) => {
                  console.log('Packet created:', packetId);
                }}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </GlobalLayout>
  );
};

export default ScopeIntelligence;
