import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Trash2, Edit, Plus, Tag, Star } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface DynamicTag {
  id: string;
  token: string;
  label: string;
  description?: string;
  json_path: string;
  is_frequently_used: boolean;
  sample_value?: string;
  created_at: string;
  updated_at: string;
}

interface TagDialogProps {
  tag?: DynamicTag;
  onSave: () => void;
  trigger: React.ReactNode;
}

const TagDialog: React.FC<TagDialogProps> = ({ tag, onSave, trigger }) => {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(tag?.token || '');
  const [label, setLabel] = useState(tag?.label || '');
  const [description, setDescription] = useState(tag?.description || '');
  const [jsonPath, setJsonPath] = useState(tag?.json_path || '');
  const [isFrequentlyUsed, setIsFrequentlyUsed] = useState(tag?.is_frequently_used ?? false);
  const [sampleValue, setSampleValue] = useState(tag?.sample_value || '');
  const { toast } = useToast();

  const handleSave = async () => {
    try {
      if (tag) {
        const { error } = await supabase
          .from('dynamic_tags')
          .update({
            token,
            label,
            description,
            json_path: jsonPath,
            is_frequently_used: isFrequentlyUsed,
            sample_value: sampleValue,
            updated_at: new Date().toISOString()
          })
          .eq('id', tag.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('dynamic_tags')
          .insert({
            token,
            label,
            description,
            json_path: jsonPath,
            is_frequently_used: isFrequentlyUsed,
            sample_value: sampleValue
          });
        if (error) throw error;
      }
      
      toast({
        title: 'Success',
        description: `Tag ${tag ? 'updated' : 'created'} successfully`,
      });
      
      setOpen(false);
      onSave();
    } catch (error) {
      console.error('Error saving tag:', error);
      toast({
        title: 'Error',
        description: 'Failed to save tag',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tag ? 'Edit Dynamic Tag' : 'Create New Dynamic Tag'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          <div>
            <Label htmlFor="token">Token</Label>
            <Input
              id="token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="e.g., contact.first_name"
            />
            <p className="text-xs text-muted-foreground mt-1">
              The token used in templates (without curly braces)
            </p>
          </div>
          
          <div>
            <Label htmlFor="label">Label</Label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g., Contact First Name"
            />
          </div>
          
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of what this tag represents"
              rows={2}
            />
          </div>
          
          <div>
            <Label htmlFor="jsonPath">JSON Path</Label>
            <Input
              id="jsonPath"
              value={jsonPath}
              onChange={(e) => setJsonPath(e.target.value)}
              placeholder="e.g., contact.first_name"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Dot-notation path to the data in the database object
            </p>
          </div>
          
          <div>
            <Label htmlFor="sampleValue">Sample Value</Label>
            <Input
              id="sampleValue"
              value={sampleValue}
              onChange={(e) => setSampleValue(e.target.value)}
              placeholder="e.g., John"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Example value for previews and documentation
            </p>
          </div>
          
          <div className="flex items-center space-x-2">
            <Switch id="frequently-used" checked={isFrequentlyUsed} onCheckedChange={setIsFrequentlyUsed} />
            <Label htmlFor="frequently-used">Frequently Used</Label>
            <p className="text-xs text-muted-foreground">
              Show in the main tag list for easy access
            </p>
          </div>
          
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {tag ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const DynamicTagManager: React.FC = () => {
  const [tags, setTags] = useState<DynamicTag[]>([]);
  const [filteredTags, setFilteredTags] = useState<DynamicTag[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showFrequentOnly, setShowFrequentOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchTags = async () => {
    try {
      const { data, error } = await supabase
        .from('dynamic_tags')
        .select('*')
        .order('is_frequently_used', { ascending: false })
        .order('label', { ascending: true });

      if (error) throw error;
      setTags(data || []);
    } catch (error) {
      console.error('Error fetching tags:', error);
      toast({
        title: 'Error',
        description: 'Failed to load tags',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const deleteTag = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this tag?')) return;

    try {
      const { error } = await supabase
        .from('dynamic_tags')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      toast({
        title: 'Success',
        description: 'Tag deleted successfully',
      });
      
      fetchTags();
    } catch (error) {
      console.error('Error deleting tag:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete tag',
        variant: 'destructive',
      });
    }
  };

  const seedCommonTags = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      // Get the user's tenant_id (this is a simplified approach)
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) throw new Error('No tenant found');

      const { error } = await supabase.rpc('seed_dynamic_tags', { 
        p_tenant_id: profile.tenant_id 
      });

      if (error) throw error;
      
      toast({
        title: 'Success',
        description: 'Common tags seeded successfully',
      });
      
      fetchTags();
    } catch (error) {
      console.error('Error seeding tags:', error);
      toast({
        title: 'Error',
        description: 'Failed to seed common tags',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    fetchTags();
  }, []);

  useEffect(() => {
    let filtered = tags;
    
    if (searchTerm) {
      filtered = filtered.filter(tag => 
        tag.token.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tag.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tag.description?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    if (showFrequentOnly) {
      filtered = filtered.filter(tag => tag.is_frequently_used);
    }
    
    setFilteredTags(filtered);
  }, [tags, searchTerm, showFrequentOnly]);

  if (loading) {
    return <div className="p-6">Loading tags...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Dynamic Tag Manager</h2>
          <p className="text-muted-foreground">Manage available tokens for smart documents</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={seedCommonTags}>
            Seed Common Tags
          </Button>
          <TagDialog
            onSave={fetchTags}
            trigger={
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Create Tag
              </Button>
            }
          />
        </div>
      </div>

      <div className="flex gap-4 items-center">
        <Input
          placeholder="Search tags..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex items-center space-x-2">
          <Switch
            id="frequent-only"
            checked={showFrequentOnly}
            onCheckedChange={setShowFrequentOnly}
          />
          <Label htmlFor="frequent-only">Frequent only</Label>
        </div>
      </div>

      <div className="grid gap-4">
        {filteredTags.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <div className="text-center">
                <Tag className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No tags found</h3>
                <p className="text-muted-foreground mb-4">
                  {searchTerm ? 'Try a different search term' : 'Create your first dynamic tag'}
                </p>
                <TagDialog
                  onSave={fetchTags}
                  trigger={<Button>Create First Tag</Button>}
                />
              </div>
            </CardContent>
          </Card>
        ) : (
          filteredTags.map((tag) => (
            <Card key={tag.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Tag className="w-5 h-5" />
                      <code className="text-primary">{`{{${tag.token}}}`}</code>
                      {tag.is_frequently_used && (
                        <Badge variant="secondary">
                          <Star className="w-3 h-3 mr-1" />
                          Frequent
                        </Badge>
                      )}
                    </CardTitle>
                    <p className="text-lg font-medium mt-1">{tag.label}</p>
                    {tag.description && (
                      <p className="text-sm text-muted-foreground">{tag.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <TagDialog
                      tag={tag}
                      onSave={fetchTags}
                      trigger={
                        <Button variant="ghost" size="sm">
                          <Edit className="w-4 h-4" />
                        </Button>
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteTag(tag.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium">JSON Path:</span>
                    <code className="ml-2 text-muted-foreground">{tag.json_path}</code>
                  </div>
                  {tag.sample_value && (
                    <div>
                      <span className="font-medium">Sample:</span>
                      <span className="ml-2 text-green-600">{tag.sample_value}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};