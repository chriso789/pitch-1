import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Tag, Filter } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface TagCatalogItem {
  id: string;
  name: string;
  description: string;
  example_value: string;
  context_type: string;
  is_sensitive: boolean;
  transform_support: string[] | null;
}

interface TagPickerProps {
  context: string;
  onSelectTag: (tag: string) => void;
  onClose: () => void;
}

export const TagPicker: React.FC<TagPickerProps> = ({
  context,
  onSelectTag,
  onClose
}) => {
  const [tags, setTags] = useState<TagCatalogItem[]>([]);
  const [filteredTags, setFilteredTags] = useState<TagCatalogItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedContext, setSelectedContext] = useState(context);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    loadTags();
  }, []);

  useEffect(() => {
    filterTags();
  }, [tags, searchTerm, selectedContext]);

  const loadTags = async () => {
    try {
      const { data, error } = await supabase
        .from('smartdoc_tag_catalog')
        .select('*')
        .order('context_type, name');

      if (error) throw error;

      setTags(data || []);
    } catch (error) {
      console.error('Error loading tags:', error);
      toast({
        title: "Error",
        description: "Failed to load tag catalog",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const filterTags = () => {
    let filtered = tags;

    // Filter by context if selected
    if (selectedContext !== 'ALL') {
      filtered = filtered.filter(tag => tag.context_type === selectedContext);
    }

    // Filter by search term
    if (searchTerm) {
      filtered = filtered.filter(tag => 
        tag.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tag.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    setFilteredTags(filtered);
  };

  const handleSelectTag = (tag: TagCatalogItem) => {
    onSelectTag(tag.name);
    onClose();
  };

  const getContextColor = (contextType: string) => {
    switch (contextType) {
      case 'CONTACT': return 'bg-blue-100 text-blue-800';
      case 'PROJECT': return 'bg-green-100 text-green-800';
      case 'ESTIMATE': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const contexts = ['ALL', ...Array.from(new Set(tags.map(tag => tag.context_type)))];

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Tag className="h-5 w-5" />
            <span>Select a Tag</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search and Filter */}
          <div className="flex items-center space-x-4">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tags..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
              />
            </div>
            <select
              value={selectedContext}
              onChange={(e) => setSelectedContext(e.target.value)}
              className="px-3 py-2 border rounded-md bg-background min-w-[120px]"
            >
              {contexts.map(ctx => (
                <option key={ctx} value={ctx}>
                  {ctx === 'ALL' ? 'All Contexts' : ctx}
                </option>
              ))}
            </select>
          </div>

          {/* Tags List */}
          <div className="max-h-96 overflow-y-auto space-y-2">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : filteredTags.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No tags found matching your criteria
              </div>
            ) : (
              filteredTags.map(tag => (
                <div
                  key={tag.id}
                  className="p-3 border rounded-lg hover:bg-accent cursor-pointer transition-colors"
                  onClick={() => handleSelectTag(tag)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                          {`{{${tag.name}}}`}
                        </code>
                        <Badge className={getContextColor(tag.context_type)}>
                          {tag.context_type}
                        </Badge>
                        {tag.is_sensitive && (
                          <Badge variant="destructive">Sensitive</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mb-1">
                        {tag.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <strong>Example:</strong> {tag.example_value}
                      </p>
                      {tag.transform_support && tag.transform_support.length > 0 && (
                        <div className="flex items-center space-x-1 mt-1">
                          <span className="text-xs text-muted-foreground">Transforms:</span>
                          {tag.transform_support.map(transform => (
                            <Badge key={transform} variant="outline" className="text-xs">
                              {transform}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex justify-end space-x-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};