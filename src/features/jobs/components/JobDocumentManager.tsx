import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';
import { 
  FileText, 
  Upload, 
  Download, 
  Trash2, 
  Eye,
  PlusCircle,
  Filter,
  Share2,
  Lock,
  Unlock
} from 'lucide-react';

interface Document {
  id: string;
  filename: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  document_type: string;
  description?: string;
  is_visible_to_homeowner: boolean;
  created_at: string;
  updated_at: string;
  uploaded_by: string;
}

interface JobDocumentManagerProps {
  jobId: string;
}

interface NewDocument {
  document_type: string;
  description: string;
  is_visible_to_homeowner: boolean;
}

export const JobDocumentManager = ({ jobId }: JobDocumentManagerProps) => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [newDocument, setNewDocument] = useState<NewDocument>({
    document_type: 'contract',
    description: '',
    is_visible_to_homeowner: false
  });

  useEffect(() => {
    fetchDocuments();
  }, [jobId]);

  const fetchDocuments = async () => {
    try {
      // Mock data for now - replace with actual database query
      const mockDocuments: Document[] = [
        {
          id: '1',
          filename: 'roofing_contract_final.pdf',
          file_path: '/storage/documents/roofing_contract_final.pdf',
          file_size: 2048576,
          mime_type: 'application/pdf',
          document_type: 'contract',
          description: 'Final signed roofing contract',
          is_visible_to_homeowner: true,
          created_at: '2024-01-15T10:30:00Z',
          updated_at: '2024-01-15T10:30:00Z',
          uploaded_by: 'user123'
        },
        {
          id: '2',
          filename: 'permit_application.pdf',
          file_path: '/storage/documents/permit_application.pdf',
          file_size: 1024000,
          mime_type: 'application/pdf', 
          document_type: 'permit',
          description: 'City building permit application',
          is_visible_to_homeowner: false,
          created_at: '2024-01-16T09:15:00Z',
          updated_at: '2024-01-16T09:15:00Z',
          uploaded_by: 'user123'
        },
        {
          id: '3',
          filename: 'material_warranty.pdf',
          file_path: '/storage/documents/material_warranty.pdf',
          file_size: 512000,
          mime_type: 'application/pdf',
          document_type: 'warranty',
          description: '25-year shingle warranty document',
          is_visible_to_homeowner: true,
          created_at: '2024-01-20T14:20:00Z',
          updated_at: '2024-01-20T14:20:00Z',
          uploaded_by: 'user123'
        },
        {
          id: '4',
          filename: 'inspection_report.pdf',
          file_path: '/storage/documents/inspection_report.pdf',
          file_size: 1536000,
          mime_type: 'application/pdf',
          document_type: 'inspection',
          description: 'Final inspection report from city inspector',
          is_visible_to_homeowner: true,
          created_at: '2024-01-25T16:45:00Z',
          updated_at: '2024-01-25T16:45:00Z',
          uploaded_by: 'user123'
        }
      ];
      
      setDocuments(mockDocuments);
    } catch (error) {
      console.error('Error fetching documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async () => {
    if (!selectedFile) return;

    try {
      // Mock upload - replace with actual Supabase storage upload
      const mockDocument: Document = {
        id: Date.now().toString(),
        filename: selectedFile.name,
        file_path: `/storage/documents/${selectedFile.name}`,
        file_size: selectedFile.size,
        mime_type: selectedFile.type,
        ...newDocument,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        uploaded_by: 'current_user'
      };

      setDocuments(prev => [...prev, mockDocument]);
      setShowUploadDialog(false);
      setSelectedFile(null);
      setNewDocument({
        document_type: 'contract',
        description: '',
        is_visible_to_homeowner: false
      });

      toast({
        title: 'Success',
        description: 'Document uploaded successfully'
      });
    } catch (error) {
      console.error('Error uploading document:', error);
      toast({
        title: 'Error',
        description: 'Failed to upload document',
        variant: 'destructive'
      });
    }
  };

  const toggleHomeownerVisibility = async (documentId: string) => {
    try {
      setDocuments(prev => prev.map(doc => 
        doc.id === documentId 
          ? { ...doc, is_visible_to_homeowner: !doc.is_visible_to_homeowner }
          : doc
      ));

      toast({
        title: 'Success',
        description: 'Document visibility updated'
      });
    } catch (error) {
      console.error('Error updating document visibility:', error);
      toast({
        title: 'Error',
        description: 'Failed to update document visibility',
        variant: 'destructive'
      });
    }
  };

  const deleteDocument = async (documentId: string) => {
    try {
      setDocuments(prev => prev.filter(d => d.id !== documentId));
      toast({
        title: 'Success',
        description: 'Document deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting document:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete document',
        variant: 'destructive'
      });
    }
  };

  const downloadDocument = (document: Document) => {
    // Mock download - replace with actual download logic
    toast({
      title: 'Download started',
      description: `Downloading ${document.filename}`
    });
  };

  const filteredDocuments = documents.filter(doc => {
    if (typeFilter === 'all') return true;
    return doc.document_type === typeFilter;
  });

  const getDocumentTypeColor = (type: string) => {
    const colors = {
      'contract': 'bg-blue-100 text-blue-800',
      'permit': 'bg-orange-100 text-orange-800',
      'warranty': 'bg-green-100 text-green-800',
      'inspection': 'bg-purple-100 text-purple-800',
      'invoice': 'bg-red-100 text-red-800',
      'insurance': 'bg-yellow-100 text-yellow-800',
      'other': 'bg-gray-100 text-gray-800'
    };
    return colors[type as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('pdf')) return <FileText className="h-5 w-5 text-red-500" />;
    if (mimeType.includes('image')) return <FileText className="h-5 w-5 text-blue-500" />;
    if (mimeType.includes('word')) return <FileText className="h-5 w-5 text-blue-600" />;
    return <FileText className="h-5 w-5 text-gray-500" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const documentTypes = ['all', 'contract', 'permit', 'warranty', 'inspection', 'invoice', 'insurance', 'other'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Document Manager</h3>
          <p className="text-muted-foreground">{documents.length} documents stored</p>
        </div>
        <div className="flex items-center space-x-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {documentTypes.map(type => (
                <SelectItem key={type} value={type}>
                  {type === 'all' ? 'All Types' : type.charAt(0).toUpperCase() + type.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Upload className="h-4 w-4 mr-2" />
                Upload Document
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Upload Document</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="document_file">Select Document</Label>
                  <Input
                    id="document_file"
                    type="file"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  />
                </div>
                <div>
                  <Label htmlFor="document_type">Document Type</Label>
                  <Select value={newDocument.document_type} onValueChange={(value) => setNewDocument(prev => ({ ...prev, document_type: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contract">Contract</SelectItem>
                      <SelectItem value="permit">Permit</SelectItem>
                      <SelectItem value="warranty">Warranty</SelectItem>
                      <SelectItem value="inspection">Inspection</SelectItem>
                      <SelectItem value="invoice">Invoice</SelectItem>
                      <SelectItem value="insurance">Insurance</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={newDocument.description}
                    onChange={(e) => setNewDocument(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Document description"
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="homeowner_visible"
                    checked={newDocument.is_visible_to_homeowner}
                    onCheckedChange={(checked) => setNewDocument(prev => ({ ...prev, is_visible_to_homeowner: checked }))}
                  />
                  <Label htmlFor="homeowner_visible">Visible to homeowner</Label>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowUploadDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleFileUpload} disabled={!selectedFile}>
                    Upload
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Document List */}
      <Card>
        <CardContent className="p-0">
          {filteredDocuments.length > 0 ? (
            <div className="space-y-0">
              {filteredDocuments.map((document, index) => (
                <div key={document.id} className={`p-4 flex items-center justify-between ${index > 0 ? 'border-t' : ''}`}>
                  <div className="flex items-center space-x-4">
                    <div className="h-10 w-10 flex items-center justify-center">
                      {getFileIcon(document.mime_type)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <p className="font-medium">{document.filename}</p>
                        <Badge className={getDocumentTypeColor(document.document_type)} variant="outline">
                          {document.document_type}
                        </Badge>
                        {document.is_visible_to_homeowner ? (
                          <Unlock className="h-4 w-4 text-green-500" />
                        ) : (
                          <Lock className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      {document.description && (
                        <p className="text-sm text-muted-foreground mb-1">{document.description}</p>
                      )}
                      <div className="flex items-center space-x-4 text-xs text-muted-foreground">
                        <span>{formatFileSize(document.file_size)}</span>
                        <span>Uploaded: {new Date(document.created_at).toLocaleDateString()}</span>
                        <span>{document.is_visible_to_homeowner ? 'Shared with homeowner' : 'Internal only'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => toggleHomeownerVisibility(document.id)}
                      title={document.is_visible_to_homeowner ? 'Hide from homeowner' : 'Share with homeowner'}
                    >
                      {document.is_visible_to_homeowner ? <Lock className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => downloadDocument(document)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => downloadDocument(document)}>
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => deleteDocument(document.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-semibold text-lg mb-2">No documents found</h3>
              <p className="text-muted-foreground mb-4">
                {typeFilter === 'all' 
                  ? 'Upload documents to get started'
                  : `No "${typeFilter}" documents found`
                }
              </p>
              <Button onClick={() => setShowUploadDialog(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Upload Document
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};