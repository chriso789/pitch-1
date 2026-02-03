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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  FileText, 
  Upload, 
  Search, 
  TrendingUp, 
  Database,
  RefreshCw,
  ExternalLink,
  BarChart3,
  Package,
  Shield,
  Globe,
  Building2,
  PlayCircle,
  Loader2
} from 'lucide-react';
import { useScopeDocuments } from '@/hooks/useScopeIntelligence';
import { useNetworkIntelligenceStats } from '@/hooks/useNetworkIntelligence';
import { useBackfillScopes, useUnprocessedDocumentCount } from '@/hooks/useBackfillScopes';
import { ScopeUploader } from '@/components/insurance/ScopeUploader';
import { ScopeViewer } from '@/components/insurance/ScopeViewer';
import { ScopeIntelligenceDashboard } from '@/components/insurance/ScopeIntelligenceDashboard';
import { ScopeDocumentBrowser } from '@/components/insurance/ScopeDocumentBrowser';
import { DisputeEvidenceBuilder } from '@/components/insurance/DisputeEvidenceBuilder';
import { format } from 'date-fns';

const ScopeIntelligence: React.FC = () => {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [viewMode, setViewMode] = useState<'my-scopes' | 'network'>('my-scopes');
  
  const { data: documents, isLoading, refetch } = useScopeDocuments();
  const { data: networkStats, isLoading: networkLoading } = useNetworkIntelligenceStats();
  const { data: unprocessedCount } = useUnprocessedDocumentCount();
  const { backfill, isProcessing } = useBackfillScopes();

  // Stats for current tenant (My Scopes)
  const myStats = {
    totalDocuments: documents?.length || 0,
    parsedDocuments: documents?.filter(d => d.parse_status === 'complete').length || 0,
    pendingReview: documents?.filter(d => d.parse_status === 'needs_review').length || 0,
    carriers: new Set(documents?.map(d => d.carrier_normalized).filter(Boolean)).size,
  };

  // Stats for network view (all tenants, anonymized)
  const netStats = {
    totalDocuments: networkStats?.total_documents || 0,
    parsedDocuments: networkStats?.total_documents || 0,
    contributors: networkStats?.total_contributors || 0,
    carriers: networkStats?.carrier_distribution?.length || 0,
  };

  // Display stats based on view mode
  const stats = viewMode === 'my-scopes' ? myStats : netStats;

  const handleBackfill = () => {
    backfill({ limit: 50 });
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
          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-muted rounded-lg p-1">
              <Button
                variant={viewMode === 'my-scopes' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('my-scopes')}
                className="gap-2"
              >
                <Building2 className="h-4 w-4" />
                My Scopes
              </Button>
              <Button
                variant={viewMode === 'network' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('network')}
                className="gap-2"
              >
                <Globe className="h-4 w-4" />
                Network
                <Badge variant="outline" className="ml-1 text-xs">Beta</Badge>
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            {/* Backfill button for unprocessed documents */}
            {unprocessedCount && unprocessedCount > 0 && (
              <Button 
                variant="default" 
                size="sm" 
                onClick={handleBackfill}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <PlayCircle className="h-4 w-4 mr-2" />
                )}
                Process {unprocessedCount} Insurance Docs
              </Button>
            )}
          </div>
        </div>

        {/* Network Mode Notice */}
        {viewMode === 'network' && (
          <Alert className="border-primary/20 bg-primary/5">
            <Shield className="h-4 w-4" />
            <AlertDescription>
              <strong>Network Intelligence:</strong> Showing anonymized data from{' '}
              <span className="font-semibold">{netStats.contributors}</span> companies.
              Client names, addresses, and claim numbers are redacted for privacy.
            </AlertDescription>
          </Alert>
        )}

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
                  <p className="text-xs text-muted-foreground">
                    {viewMode === 'network' ? 'Network Documents' : 'Total Documents'}
                  </p>
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
                  {viewMode === 'network' ? (
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <Search className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {viewMode === 'network' ? netStats.contributors : myStats.pendingReview}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {viewMode === 'network' ? 'Contributors' : 'Needs Review'}
                  </p>
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
            <ScopeIntelligenceDashboard viewMode={viewMode} networkStats={networkStats} />
          </TabsContent>

          <TabsContent value="documents" className="mt-4">
            <ScopeDocumentBrowser 
              onSelectDocument={setSelectedDocumentId}
              onUploadClick={() => setActiveTab('upload')}
              viewMode={viewMode}
            />
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
