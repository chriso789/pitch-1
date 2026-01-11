import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Trash2, GripVertical } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface NavigationLink {
  label: string;
  target_section?: string;
  target_slide_index?: number;
  style: 'button' | 'card' | 'link' | 'pill';
  description?: string;
  color?: string;
}

interface SectionMenuSlideEditorProps {
  slide: any;
  onUpdate: () => void;
}

export function SectionMenuSlideEditor({ slide, onUpdate }: SectionMenuSlideEditorProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState(slide.content?.title || "");
  const [description, setDescription] = useState(slide.content?.description || "");
  const [navigationLinks, setNavigationLinks] = useState<NavigationLink[]>(
    slide.navigation_links || slide.content?.navigation_links || []
  );

  useEffect(() => {
    setTitle(slide.content?.title || "");
    setDescription(slide.content?.description || "");
    setNavigationLinks(slide.navigation_links || slide.content?.navigation_links || []);
  }, [slide.id]);

  const handleUpdate = async () => {
    try {
      const { error } = await supabase
        .from("presentation_slides")
        .update({
          content: {
            ...slide.content,
            title,
            description,
          },
          navigation_links: navigationLinks as any,
        })
        .eq("id", slide.id);

      if (error) throw error;
      onUpdate();
    } catch (error: any) {
      toast({
        title: "Error saving slide",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const addLink = () => {
    setNavigationLinks([
      ...navigationLinks,
      { label: "New Link", style: "card" as const },
    ]);
  };

  const updateLink = (index: number, updates: Partial<NavigationLink>) => {
    const newLinks = [...navigationLinks];
    newLinks[index] = { ...newLinks[index], ...updates };
    setNavigationLinks(newLinks);
  };

  const removeLink = (index: number) => {
    setNavigationLinks(navigationLinks.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      {/* Preview */}
      <Card className="p-8 bg-gradient-to-br from-background to-muted">
        <div className="text-center space-y-4">
          <h2 className="text-3xl font-bold">{title || "Choose a Topic"}</h2>
          {description && <p className="text-muted-foreground">{description}</p>}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6">
            {navigationLinks.map((link, i) => (
              <Card key={i} className="p-4 text-center cursor-pointer hover:shadow-md transition-all">
                <span className="font-medium">{link.label}</span>
                {link.description && (
                  <p className="text-xs text-muted-foreground mt-1">{link.description}</p>
                )}
              </Card>
            ))}
          </div>
        </div>
      </Card>

      {/* Editor Fields */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Menu Title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleUpdate}
            placeholder="Choose a Topic"
          />
        </div>

        <div className="space-y-2">
          <Label>Description (optional)</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={handleUpdate}
            placeholder="Select a section to learn more..."
            rows={2}
          />
        </div>

        {/* Navigation Links Editor */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Navigation Links</Label>
            <Button variant="outline" size="sm" onClick={addLink}>
              <Plus className="h-4 w-4 mr-1" />
              Add Link
            </Button>
          </div>

          {navigationLinks.map((link, index) => (
            <Card key={index} className="p-4">
              <div className="flex items-start gap-3">
                <GripVertical className="h-5 w-5 text-muted-foreground mt-2 cursor-grab" />
                
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Label</Label>
                    <Input
                      value={link.label}
                      onChange={(e) => updateLink(index, { label: e.target.value })}
                      onBlur={handleUpdate}
                      placeholder="Button Label"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Target Section (slug)</Label>
                    <Input
                      value={link.target_section || ""}
                      onChange={(e) => updateLink(index, { target_section: e.target.value })}
                      onBlur={handleUpdate}
                      placeholder="section-slug"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Style</Label>
                    <Select
                      value={link.style}
                      onValueChange={(value: any) => {
                        updateLink(index, { style: value });
                        handleUpdate();
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="card">Card</SelectItem>
                        <SelectItem value="button">Button</SelectItem>
                        <SelectItem value="pill">Pill</SelectItem>
                        <SelectItem value="link">Link</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Description (optional)</Label>
                    <Input
                      value={link.description || ""}
                      onChange={(e) => updateLink(index, { description: e.target.value })}
                      onBlur={handleUpdate}
                      placeholder="Short description"
                    />
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    removeLink(index);
                    handleUpdate();
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}

          {navigationLinks.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No navigation links. Add links to create a menu.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
