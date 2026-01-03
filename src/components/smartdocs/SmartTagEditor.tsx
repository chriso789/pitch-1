import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Search, RotateCcw, Edit2, Check, X, Tag } from 'lucide-react';

interface TagValue {
  key: string;
  originalValue: any;
  currentValue: any;
  isOverridden: boolean;
  category?: string;
}

interface SmartTagEditorProps {
  tags: TagValue[];
  onTagChange: (key: string, value: any) => void;
  onTagReset: (key: string) => void;
  onResetAll: () => void;
}

const categoryColors: Record<string, string> = {
  contact: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  company: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  project: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  estimate: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  measurements: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  other: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
};

export function SmartTagEditor({ tags, onTagChange, onTagReset, onResetAll }: SmartTagEditorProps) {
  const [search, setSearch] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const filteredTags = useMemo(() => {
    if (!search) return tags;
    const searchLower = search.toLowerCase();
    return tags.filter(tag => 
      tag.key.toLowerCase().includes(searchLower) ||
      String(tag.currentValue).toLowerCase().includes(searchLower)
    );
  }, [tags, search]);

  const groupedTags = useMemo(() => {
    const groups: Record<string, TagValue[]> = {};
    filteredTags.forEach(tag => {
      const category = tag.category || getCategoryFromKey(tag.key);
      if (!groups[category]) groups[category] = [];
      groups[category].push(tag);
    });
    return groups;
  }, [filteredTags]);

  const overriddenCount = tags.filter(t => t.isOverridden).length;

  const startEdit = (tag: TagValue) => {
    setEditingKey(tag.key);
    setEditValue(String(tag.currentValue || ''));
  };

  const saveEdit = () => {
    if (editingKey) {
      onTagChange(editingKey, editValue);
      setEditingKey(null);
      setEditValue('');
    }
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue('');
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Tag className="h-5 w-5" />
            Smart Tags
            {overriddenCount > 0 && (
              <Badge variant="secondary">{overriddenCount} modified</Badge>
            )}
          </CardTitle>
          {overriddenCount > 0 && (
            <Button variant="ghost" size="sm" onClick={onResetAll}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset All
            </Button>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-4">
            {Object.entries(groupedTags).map(([category, categoryTags]) => (
              <div key={category}>
                <h4 className="text-sm font-medium text-muted-foreground mb-2 capitalize">
                  {category}
                </h4>
                <div className="space-y-2">
                  {categoryTags.map(tag => (
                    <div
                      key={tag.key}
                      className={`p-3 rounded-lg border transition-colors ${
                        tag.isOverridden 
                          ? 'border-primary/50 bg-primary/5' 
                          : 'border-border hover:border-primary/30'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                          {`{{${tag.key}}}`}
                        </code>
                        <div className="flex items-center gap-1">
                          {tag.isOverridden && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => onTagReset(tag.key)}
                              title="Reset to original"
                            >
                              <RotateCcw className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => startEdit(tag)}
                            title="Edit value"
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      
                      {editingKey === tag.key ? (
                        <div className="flex items-center gap-2 mt-2">
                          <Input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="h-8 text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEdit();
                              if (e.key === 'Escape') cancelEdit();
                            }}
                          />
                          <Button size="icon" className="h-8 w-8" onClick={saveEdit}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={cancelEdit}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <p className="text-sm truncate" title={String(tag.currentValue)}>
                          {tag.currentValue || <span className="text-muted-foreground italic">Empty</span>}
                        </p>
                      )}
                      
                      {tag.isOverridden && tag.originalValue !== tag.currentValue && (
                        <p className="text-xs text-muted-foreground mt-1 line-through">
                          Original: {tag.originalValue || 'Empty'}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            
            {Object.keys(groupedTags).length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No tags found matching "{search}"
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function getCategoryFromKey(key: string): string {
  const keyLower = key.toLowerCase();
  if (keyLower.startsWith('contact.') || keyLower.includes('customer') || keyLower.includes('homeowner')) {
    return 'contact';
  }
  if (keyLower.startsWith('company.') || keyLower.includes('tenant')) {
    return 'company';
  }
  if (keyLower.startsWith('project.') || keyLower.includes('job')) {
    return 'project';
  }
  if (keyLower.startsWith('estimate.') || keyLower.includes('price') || keyLower.includes('total')) {
    return 'estimate';
  }
  if (keyLower.includes('roof') || keyLower.includes('area') || keyLower.includes('pitch')) {
    return 'measurements';
  }
  return 'other';
}

// Inline tag picker for inserting tags into text
export function InlineTagPicker({ 
  onSelect, 
  availableTags 
}: { 
  onSelect: (tag: string) => void;
  availableTags: string[];
}) {
  const [search, setSearch] = useState('');
  
  const filtered = availableTags.filter(tag => 
    tag.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Tag className="mr-2 h-4 w-4" />
          Insert Tag
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <Input
          placeholder="Search tags..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2"
        />
        <ScrollArea className="h-48">
          <div className="space-y-1">
            {filtered.map(tag => (
              <button
                key={tag}
                className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors"
                onClick={() => {
                  onSelect(`{{${tag}}}`);
                }}
              >
                <code className="text-xs">{`{{${tag}}}`}</code>
              </button>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
