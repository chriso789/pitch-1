import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, Edit, Plus, FileText, Code, Eye } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface SmartDoc {
  id: string;
  name: string;
  description?: string;
  engine: string;
  body: string;
  created_at: string;
  updated_at: string;
}

interface DynamicTag {
  id: string;
  token: string;
  label: string;
  description?: string;
  sample_value?: string;
}

interface SmartDocDialogProps {
  doc?: SmartDoc;
  onSave: () => void;
  trigger: React.ReactNode;
}

const SmartDocDialog: React.FC<SmartDocDialogProps> = ({ doc, onSave, trigger }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(doc?.name || '');
  const [description, setDescription] = useState(doc?.description || '');
  const [body, setBody] = useState(doc?.body || '');
  const [tags, setTags] = useState<DynamicTag[]>([]);
  const [preview, setPreview] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const { toast } = useToast();

  const fetchTags = async () => {
    try {
      const { data, error } = await supabase.rpc('api_dynamic_tags_frequently_used', { p_limit: 100 });
      if (error) throw error;
      setTags(data || []);
    } catch (error) {
      console.error('Error fetching tags:', error);
    }
  };

  const insertTag = (token: string) => {
    const textarea = document.getElementById('body') as HTMLTextAreaElement;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;
      const before = text.substring(0, start);
      const after = text.substring(end, text.length);
      const newText = before + `{{${token}}}` + after;
      setBody(newText);
      
      // Focus back to textarea and set cursor position
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + token.length + 4, start + token.length + 4);
      }, 0);
    }
  };

  const renderPreview = async () => {
    try {
      // Simple preview with sample values
      let previewText = body;
      tags.forEach(tag => {
        if (tag.sample_value) {
          const regex = new RegExp(`\\{\\{\\s*${tag.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g');
          previewText = previewText.replace(regex, tag.sample_value);
        }
      });
      setPreview(previewText);
      setShowPreview(true);
    } catch (error) {
      console.error('Error rendering preview:', error);
      toast({
        title: 'Error',
        description: 'Failed to render preview',
        variant: 'destructive',
      });
    }
  };

  const handleSave = async () => {
    try {
      if (doc) {
        const { error } = await supabase
          .from('smart_docs')
          .update({
            name,
            description,
            body,
            updated_at: new Date().toISOString()
          })
          .eq('id', doc.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('smart_docs')
          .insert({
            name,
            description,
            engine: 'liquid',
            body
          });
        if (error) throw error;
      }
      
      toast({
        title: 'Success',
        description: `Document ${doc ? 'updated' : 'created'} successfully`,
      });
      
      setOpen(false);
      onSave();
    } catch (error) {
      console.error('Error saving document:', error);
      toast({
        title: 'Error',
        description: 'Failed to save document',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    if (open) {
      fetchTags();
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>{doc ? 'Edit Smart Document' : 'Create New Smart Document'}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-6 h-[70vh]">
          <div className="col-span-2 space-y-4">
            <div>
              <Label htmlFor="name">Document Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter document name"
              />
            </div>
            
            <div>
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this document"
              />
            </div>
            
            <div className="flex-1">
              <div className="flex justify-between items-center mb-2">
                <Label htmlFor="body">Template Body (Liquid)</Label>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={renderPreview}>
                    <Eye className="w-4 h-4 mr-2" />
                    Preview
                  </Button>
                </div>
              </div>
              <Textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Enter your Liquid template here..."
                className="min-h-[400px] font-mono text-sm"
              />
            </div>
          </div>
          
          <div className="space-y-4">
            <div>
              <Label>Available Tags</Label>
              <ScrollArea className="h-[500px] border rounded-md p-2">
                <div className="space-y-2">
                  {tags.map((tag) => (
                    <div
                      key={tag.id}
                      className="p-2 border rounded cursor-pointer hover:bg-accent"
                      onClick={() => insertTag(tag.token)}
                    >
                      <div className="font-mono text-sm text-primary">
                        {`{{${tag.token}}}`}
                      </div>
                      <div className="text-xs font-medium">{tag.label}</div>
                      {tag.description && (
                        <div className="text-xs text-muted-foreground">{tag.description}</div>
                      )}
                      {tag.sample_value && (
                        <div className="text-xs text-green-600">
                          Example: {tag.sample_value}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
        
        {showPreview && (
          <div className="mt-4 p-4 border rounded-md bg-muted">
            <Label>Preview with Sample Data:</Label>
            <div className="mt-2 whitespace-pre-wrap text-sm">{preview}</div>
          </div>
        )}
        
        <div className="flex justify-end space-x-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            {doc ? 'Update' : 'Create'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const SmartDocumentEditor: React.FC = () => {
  const [docs, setDocs] = useState<SmartDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchDocs = async () => {
    try {
      const { data, error } = await supabase
        .from('smart_docs')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setDocs(data || []);
    } catch (error) {
      console.error('Error fetching documents:', error);
      toast({
        title: 'Error',
        description: 'Failed to load documents',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const deleteDoc = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this document?')) return;

    try {
      const { error } = await supabase
        .from('smart_docs')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      toast({
        title: 'Success',
        description: 'Document deleted successfully',
      });
      
      fetchDocs();
    } catch (error) {
      console.error('Error deleting document:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete document',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    fetchDocs();
  }, []);

  if (loading) {
    return <div className="p-6">Loading documents...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Smart Document Editor</h2>
          <p className="text-muted-foreground">Create and manage Liquid templates with dynamic content</p>
        </div>
        <SmartDocDialog
          onSave={fetchDocs}
          trigger={
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Create Document
            </Button>
          }
        />
      </div>

      <div className="grid gap-4">
        {docs.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <div className="text-center">
                <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No documents yet</h3>
                <p className="text-muted-foreground mb-4">
                  Create your first smart document template
                </p>
                <SmartDocDialog
                  onSave={fetchDocs}
                  trigger={<Button>Create First Document</Button>}
                />
              </div>
            </CardContent>
          </Card>
        ) : (
          docs.map((doc) => (
            <Card key={doc.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="w-5 h-5" />
                      {doc.name}
                      <Badge variant="outline">
                        <Code className="w-3 h-3 mr-1" />
                        {doc.engine}
                      </Badge>
                    </CardTitle>
                    {doc.description && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {doc.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <SmartDocDialog
                      doc={doc}
                      onSave={fetchDocs}
                      trigger={
                        <Button variant="ghost" size="sm">
                          <Edit className="w-4 h-4" />
                        </Button>
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteDoc(doc.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>Updated: {new Date(doc.updated_at).toLocaleDateString()}</span>
                  <span>Characters: {doc.body.length}</span>
                </div>
                {doc.body.length > 0 && (
                  <div className="mt-2 p-2 bg-muted rounded text-xs font-mono max-h-20 overflow-hidden">
                    {doc.body.substring(0, 200)}
                    {doc.body.length > 200 && '...'}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};