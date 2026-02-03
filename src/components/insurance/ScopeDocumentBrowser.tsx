import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Search, X, FileText, Upload, RefreshCw, Filter } from 'lucide-react';
import { 
  useScopeDocumentsWithFilters, 
  useUniqueCarriers, 
  useUniqueStates,
  useReprocessDocument,
  useDeleteScopeDocument,
  type ScopeDocumentFilters
} from '@/hooks/useScopeDocumentsWithFilters';
import { ScopeDocumentRow } from './ScopeDocumentRow';
import { getCarrierDisplayName } from '@/lib/insurance/canonicalItems';

interface ScopeDocumentBrowserProps {
  onSelectDocument: (id: string) => void;
  onUploadClick?: () => void;
  viewMode?: 'my-scopes' | 'network';
}

export const ScopeDocumentBrowser: React.FC<ScopeDocumentBrowserProps> = ({
  onSelectDocument,
  onUploadClick,
  viewMode = 'my-scopes',
}) => {
  const [filters, setFilters] = useState<ScopeDocumentFilters>({});
  const [searchInput, setSearchInput] = useState('');
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  const { data: documents, isLoading, refetch } = useScopeDocumentsWithFilters(filters);
  const { data: carriers = [] } = useUniqueCarriers();
  const { data: states = [] } = useUniqueStates();
  const reprocessMutation = useReprocessDocument();
  const deleteMutation = useDeleteScopeDocument();

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    // Debounce search
    const timeout = setTimeout(() => {
      setFilters(prev => ({ ...prev, search: value || undefined }));
    }, 300);
    return () => clearTimeout(timeout);
  };

  const handleFilterChange = (key: keyof ScopeDocumentFilters, value: string) => {
    setFilters(prev => ({
      ...prev,
      [key]: value === 'all' ? undefined : value,
    }));
  };

  const clearFilters = () => {
    setFilters({});
    setSearchInput('');
  };

  const hasActiveFilters = Object.values(filters).some(v => v !== undefined);

  const handleReprocess = async (id: string) => {
    setReprocessingId(id);
    try {
      await reprocessMutation.mutateAsync(id);
    } finally {
      setReprocessingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteDocId) return;
    await deleteMutation.mutateAsync(deleteDocId);
    setDeleteDocId(null);
  };

  // Status options
  const statusOptions = [
    { value: 'all', label: 'All Status' },
    { value: 'complete', label: 'Complete' },
    { value: 'extracting', label: 'Extracting' },
    { value: 'pending', label: 'Pending' },
    { value: 'failed', label: 'Failed' },
    { value: 'needs_review', label: 'Needs Review' },
  ];

  // Document type options
  const typeOptions = [
    { value: 'all', label: 'All Types' },
    { value: 'estimate', label: 'Estimate' },
    { value: 'supplement', label: 'Supplement' },
    { value: 'final', label: 'Final' },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Scope Documents</CardTitle>
            <CardDescription>
              Insurance estimates and supplements with extracted line items
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search documents..."
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap gap-2 items-center">
          <Filter className="h-4 w-4 text-muted-foreground" />
          
          {/* Carrier Filter */}
          <Select 
            value={filters.carrier || 'all'} 
            onValueChange={(v) => handleFilterChange('carrier', v)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Carrier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Carriers</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
              {carriers.map(carrier => (
                <SelectItem key={carrier} value={carrier}>
                  {getCarrierDisplayName(carrier)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* State Filter */}
          <Select 
            value={filters.state || 'all'} 
            onValueChange={(v) => handleFilterChange('state', v)}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              {states.map(state => (
                <SelectItem key={state} value={state}>
                  {state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select 
            value={filters.status || 'all'} 
            onValueChange={(v) => handleFilterChange('status', v)}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Type Filter */}
          <Select 
            value={filters.documentType || 'all'} 
            onValueChange={(v) => handleFilterChange('documentType', v)}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              {typeOptions.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>

        {/* Active Filter Badges */}
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-2">
            {filters.carrier && (
              <Badge variant="secondary" className="gap-1">
                Carrier: {filters.carrier === 'unknown' ? 'Unknown' : getCarrierDisplayName(filters.carrier)}
                <X 
                  className="h-3 w-3 cursor-pointer" 
                  onClick={() => handleFilterChange('carrier', 'all')}
                />
              </Badge>
            )}
            {filters.state && (
              <Badge variant="secondary" className="gap-1">
                State: {filters.state}
                <X 
                  className="h-3 w-3 cursor-pointer" 
                  onClick={() => handleFilterChange('state', 'all')}
                />
              </Badge>
            )}
            {filters.status && (
              <Badge variant="secondary" className="gap-1">
                Status: {statusOptions.find(o => o.value === filters.status)?.label}
                <X 
                  className="h-3 w-3 cursor-pointer" 
                  onClick={() => handleFilterChange('status', 'all')}
                />
              </Badge>
            )}
            {filters.documentType && (
              <Badge variant="secondary" className="gap-1">
                Type: {typeOptions.find(o => o.value === filters.documentType)?.label}
                <X 
                  className="h-3 w-3 cursor-pointer" 
                  onClick={() => handleFilterChange('documentType', 'all')}
                />
              </Badge>
            )}
          </div>
        )}

        {/* Document List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : documents && documents.length > 0 ? (
          <div className="space-y-2">
            {documents.map(doc => (
              <ScopeDocumentRow
                key={doc.id}
                document={doc}
                onView={onSelectDocument}
                onReprocess={handleReprocess}
                onDelete={(id) => setDeleteDocId(id)}
                isReprocessing={reprocessingId === doc.id}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">
              {hasActiveFilters ? 'No matching documents' : 'No documents yet'}
            </h3>
            <p className="text-muted-foreground mb-4">
              {hasActiveFilters 
                ? 'Try adjusting your filters to see more results'
                : 'Upload insurance scope PDFs to start building your evidence vault'
              }
            </p>
            {hasActiveFilters ? (
              <Button variant="outline" onClick={clearFilters}>
                Clear Filters
              </Button>
            ) : onUploadClick && (
              <Button onClick={onUploadClick}>
                <Upload className="h-4 w-4 mr-2" />
                Upload First Scope
              </Button>
            )}
          </div>
        )}

        {/* Results count */}
        {documents && documents.length > 0 && (
          <div className="text-sm text-muted-foreground text-center">
            Showing {documents.length} document{documents.length !== 1 ? 's' : ''}
          </div>
        )}
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteDocId} onOpenChange={(open) => !open && setDeleteDocId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this scope document and all its extracted data. 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
