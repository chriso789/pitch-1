import React, { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Tag, Filter, Copy, Check } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SMART_TAGS, SMART_TAG_CATEGORIES, type SmartTagDefinition } from "@/lib/measurements/smartTagRegistry";

interface MeasurementTagPickerProps {
  onSelectTag: (tag: string) => void;
  onClose: () => void;
  sampleData?: Record<string, any>;
}

export const MeasurementTagPicker: React.FC<MeasurementTagPickerProps> = ({
  onSelectTag,
  onClose,
  sampleData
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [copiedTag, setCopiedTag] = useState<string | null>(null);

  const filteredTags = useMemo(() => {
    let filtered = SMART_TAGS;

    // Filter by category
    if (selectedCategory !== "ALL") {
      filtered = filtered.filter(tag => tag.category === selectedCategory);
    }

    // Filter by search term
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      filtered = filtered.filter(tag => 
        tag.key.toLowerCase().includes(lower) ||
        tag.description.toLowerCase().includes(lower)
      );
    }

    return filtered;
  }, [searchTerm, selectedCategory]);

  const handleSelectTag = (tag: SmartTagDefinition) => {
    onSelectTag(`{{${tag.key}}}`);
    onClose();
  };

  const handleCopyTag = (tagKey: string) => {
    navigator.clipboard.writeText(`{{${tagKey}}}`);
    setCopiedTag(tagKey);
    setTimeout(() => setCopiedTag(null), 2000);
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      ROOF_BASIC: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      ROOF_FACETS: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
      ROOF_PITCH: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      ROOF_WASTE: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      LINEAR: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      LINEAR_COMBINED: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
      PENETRATIONS: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
      MATERIALS_BASE: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
      MATERIALS_WASTE: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
      PROPERTY: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
      CALCULATIONS: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    };
    return colors[category] || 'bg-gray-100 text-gray-800';
  };

  const getSampleValue = (tagKey: string) => {
    if (sampleData && tagKey in sampleData) {
      return String(sampleData[tagKey]);
    }
    return null;
  };

  const categories = ['ALL', ...Object.keys(SMART_TAG_CATEGORIES)];

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            <span>Measurement Smart Tags</span>
            <Badge variant="outline">{filteredTags.length} tags</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search and Filter */}
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tags by name or description..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-[280px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Categories</SelectItem>
                {Object.entries(SMART_TAG_CATEGORIES).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tags Grid */}
          <div className="max-h-[calc(85vh-200px)] overflow-y-auto space-y-2 pr-2">
            {filteredTags.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Tag className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No tags found matching your criteria</p>
              </div>
            ) : (
              filteredTags.map(tag => {
                const sampleValue = getSampleValue(tag.key);
                const isCopied = copiedTag === tag.key;
                
                return (
                  <div
                    key={tag.key}
                    className="group p-3 border rounded-lg hover:bg-accent cursor-pointer transition-all hover:shadow-sm"
                    onClick={() => handleSelectTag(tag)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded font-semibold">
                            {`{{${tag.key}}}`}
                          </code>
                          <Badge 
                            variant="secondary" 
                            className={`text-xs ${getCategoryColor(tag.category)}`}
                          >
                            {SMART_TAG_CATEGORIES[tag.category as keyof typeof SMART_TAG_CATEGORIES]}
                          </Badge>
                          {tag.unit && (
                            <Badge variant="outline" className="text-xs">
                              {tag.unit}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mb-1">
                          {tag.description}
                        </p>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-muted-foreground">
                            <strong>Example:</strong> {sampleValue || tag.example}
                          </span>
                          {sampleValue && (
                            <Badge variant="outline" className="text-xs bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">
                              Live Data
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyTag(tag.key);
                        }}
                      >
                        {isCopied ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Info */}
          <div className="flex items-center justify-between pt-4 border-t text-xs text-muted-foreground">
            <p>
              Click any tag to insert it into your template. Use mathematical expressions like{" "}
              <code className="bg-muted px-1 py-0.5 rounded">
                {`{{ ceil(lf.ridge / 33) }}`}
              </code>
            </p>
            <Button variant="outline" onClick={onClose} size="sm">
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
