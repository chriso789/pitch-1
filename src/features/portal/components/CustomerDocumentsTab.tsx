import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  FileText, Download, Eye, FolderOpen,
  FileCheck, Camera, ClipboardList, Shield
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface CustomerDocument {
  id: string;
  file_name: string;
  document_type: string;
  file_url?: string;
  storage_path?: string;
  created_at: string;
  status?: string;
  category?: string;
}

interface CustomerDocumentsTabProps {
  projectId: string;
  token: string;
}

const CATEGORY_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  contract: { icon: FileCheck, label: 'Contracts', color: 'text-blue-500' },
  change_order: { icon: ClipboardList, label: 'Change Orders', color: 'text-amber-500' },
  estimate: { icon: FileText, label: 'Estimates', color: 'text-emerald-500' },
  photo: { icon: Camera, label: 'Photos', color: 'text-purple-500' },
  inspection_photo: { icon: Camera, label: 'Inspection Photos', color: 'text-purple-500' },
  warranty: { icon: Shield, label: 'Warranty', color: 'text-teal-500' },
  permit: { icon: FileCheck, label: 'Permits', color: 'text-indigo-500' },
  invoice: { icon: FileText, label: 'Invoices', color: 'text-orange-500' },
};

export function CustomerDocumentsTab({ projectId, token }: CustomerDocumentsTabProps) {
  const [documents, setDocuments] = useState<CustomerDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  useEffect(() => {
    fetchDocuments();
  }, [projectId]);

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('customer-portal-access', {
        body: { action: 'get_documents', token, project_id: projectId }
      });

      if (error) throw error;
      setDocuments(data?.documents || []);
    } catch (err) {
      console.error('Error fetching documents:', err);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (doc: CustomerDocument) => {
    const url = doc.file_url || doc.storage_path;
    if (url) {
      window.open(url, '_blank');
    }
  };

  const categories = Object.entries(
    documents.reduce<Record<string, CustomerDocument[]>>((acc, doc) => {
      const cat = doc.document_type || doc.category || 'other';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(doc);
      return acc;
    }, {})
  );

  const filteredDocs = selectedCategory
    ? documents.filter(d => (d.document_type || d.category || 'other') === selectedCategory)
    : documents;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center py-12">
          <FolderOpen className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-semibold text-lg mb-2">No Documents Yet</h3>
          <p className="text-muted-foreground">
            Documents related to your project will appear here once they are ready.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Category Filters */}
      <div className="flex flex-wrap gap-2">
        <Badge
          variant={selectedCategory === null ? 'default' : 'outline'}
          className="cursor-pointer"
          onClick={() => setSelectedCategory(null)}
        >
          All ({documents.length})
        </Badge>
        {categories.map(([cat, docs]) => {
          const config = CATEGORY_CONFIG[cat] || { icon: FileText, label: cat, color: 'text-muted-foreground' };
          return (
            <Badge
              key={cat}
              variant={selectedCategory === cat ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setSelectedCategory(cat)}
            >
              {config.label} ({docs.length})
            </Badge>
          );
        })}
      </div>

      {/* Document List */}
      <div className="space-y-3">
        {filteredDocs.map((doc) => {
          const cat = doc.document_type || doc.category || 'other';
          const config = CATEGORY_CONFIG[cat] || { icon: FileText, label: cat, color: 'text-muted-foreground' };
          const Icon = config.icon;

          return (
            <Card key={doc.id} className="hover:shadow-md transition-shadow">
              <CardContent className="py-4 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0`}>
                  <Icon className={`w-5 h-5 ${config.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{doc.file_name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">
                      {new Date(doc.created_at).toLocaleDateString()}
                    </span>
                    {doc.status && (
                      <Badge variant="outline" className="text-xs">
                        {doc.status}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDownload(doc)}
                    title="View / Download"
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
