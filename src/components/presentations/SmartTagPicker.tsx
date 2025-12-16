import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tag, Search, Copy, Check } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";

interface SmartTagPickerProps {
  onSelectTag?: (tag: string) => void;
  trigger?: React.ReactNode;
}

interface SmartTagDefinition {
  id: string;
  tag_key: string;
  category: string;
  description: string;
  format_type: string;
}

const categoryColors: Record<string, string> = {
  CUSTOMER: "bg-blue-500/10 text-blue-600",
  COMPANY: "bg-green-500/10 text-green-600",
  PROJECT: "bg-purple-500/10 text-purple-600",
  ESTIMATE: "bg-orange-500/10 text-orange-600",
  MEASUREMENTS: "bg-red-500/10 text-red-600",
};

export function SmartTagPicker({ onSelectTag, trigger }: SmartTagPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [copiedTag, setCopiedTag] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: tags, isLoading } = useQuery({
    queryKey: ["smart-tag-definitions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("smart_tag_definitions")
        .select("*")
        .order("category")
        .order("tag_key");
      
      if (error) throw error;
      return data as SmartTagDefinition[];
    },
    enabled: open,
  });

  const filteredTags = tags?.filter(tag =>
    tag.tag_key.toLowerCase().includes(search.toLowerCase()) ||
    tag.description?.toLowerCase().includes(search.toLowerCase()) ||
    tag.category.toLowerCase().includes(search.toLowerCase())
  );

  const groupedTags = filteredTags?.reduce((acc, tag) => {
    if (!acc[tag.category]) {
      acc[tag.category] = [];
    }
    acc[tag.category].push(tag);
    return acc;
  }, {} as Record<string, SmartTagDefinition[]>);

  const handleSelectTag = (tagKey: string) => {
    const tagString = `{{${tagKey}}}`;
    
    if (onSelectTag) {
      onSelectTag(tagString);
      setOpen(false);
    } else {
      // Copy to clipboard
      navigator.clipboard.writeText(tagString);
      setCopiedTag(tagKey);
      toast({
        title: "Tag copied",
        description: `${tagString} copied to clipboard`,
      });
      setTimeout(() => setCopiedTag(null), 2000);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="gap-2">
            <Tag className="h-4 w-4" />
            Insert Tag
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tags..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        
        <ScrollArea className="h-[300px]">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Loading tags...
            </div>
          ) : groupedTags && Object.keys(groupedTags).length > 0 ? (
            <div className="p-2">
              {Object.entries(groupedTags).map(([category, categoryTags]) => (
                <div key={category} className="mb-4 last:mb-0">
                  <div className={cn(
                    "text-xs font-semibold uppercase px-2 py-1 rounded mb-1",
                    categoryColors[category] || "bg-muted"
                  )}>
                    {category}
                  </div>
                  <div className="space-y-0.5">
                    {categoryTags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => handleSelectTag(tag.tag_key)}
                        className="w-full flex items-center justify-between p-2 rounded hover:bg-muted text-left group"
                      >
                        <div className="min-w-0">
                          <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">
                            {`{{${tag.tag_key}}}`}
                          </code>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {tag.description}
                          </p>
                        </div>
                        {copiedTag === tag.tag_key ? (
                          <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                        ) : (
                          <Copy className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 flex-shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No tags found
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
