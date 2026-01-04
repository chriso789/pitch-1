import React, { useEffect, useRef, useState, useCallback } from "react";
import { Canvas as FabricCanvas, Rect, FabricText, FabricObject } from "fabric";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { 
  X, 
  Save, 
  Trash2, 
  Search, 
  Tag as TagIcon,
  ZoomIn,
  ZoomOut,
  RotateCcw
} from "lucide-react";

interface TagPlacement {
  id?: string;
  tag_key: string;
  page_number: number;
  x_position: number;
  y_position: number;
  width: number;
  height: number;
  font_size: number;
  font_family: string;
  text_align: string;
}

interface DocumentTagEditorProps {
  document: {
    id: string;
    filename: string;
    file_path: string;
    mime_type?: string;
  };
  onClose: () => void;
  onSave: () => void;
}

// Available smart tags grouped by category
const SMART_TAG_CATEGORIES = {
  Contact: [
    { key: "contact.first_name", label: "First Name" },
    { key: "contact.last_name", label: "Last Name" },
    { key: "contact.full_name", label: "Full Name" },
    { key: "contact.email", label: "Email" },
    { key: "contact.phone", label: "Phone" },
    { key: "contact.address", label: "Address" },
    { key: "contact.city", label: "City" },
    { key: "contact.state", label: "State" },
    { key: "contact.zip", label: "ZIP Code" },
  ],
  Project: [
    { key: "project.name", label: "Project Name" },
    { key: "project.address", label: "Project Address" },
    { key: "project.status", label: "Status" },
    { key: "project.created_date", label: "Created Date" },
  ],
  Estimate: [
    { key: "estimate.total", label: "Total Amount" },
    { key: "estimate.subtotal", label: "Subtotal" },
    { key: "estimate.tax", label: "Tax" },
    { key: "estimate.number", label: "Estimate #" },
  ],
  Company: [
    { key: "company.name", label: "Company Name" },
    { key: "company.phone", label: "Company Phone" },
    { key: "company.email", label: "Company Email" },
    { key: "company.address", label: "Company Address" },
  ],
  Date: [
    { key: "today.date", label: "Today's Date" },
    { key: "today.date_long", label: "Today (Long)" },
  ],
};

export const DocumentTagEditor: React.FC<DocumentTagEditorProps> = ({
  document,
  onClose,
  onSave,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [placements, setPlacements] = useState<TagPlacement[]>([]);
  const [selectedObject, setSelectedObject] = useState<FabricObject | null>(null);
  const [zoom, setZoom] = useState(1);
  const [tenantId, setTenantId] = useState<string | null>(null);

  // Load tenant ID
  useEffect(() => {
    const loadTenantId = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("tenant_id")
          .eq("id", user.id)
          .single();
        if (profile?.tenant_id) {
          setTenantId(profile.tenant_id);
        }
      }
    };
    loadTenantId();
  }, []);

  // Load document and existing placements
  useEffect(() => {
    const loadDocument = async () => {
      setLoading(true);
      try {
        // Get signed URL for the document
        const { data: urlData, error: urlError } = await supabase.storage
          .from("smartdoc-assets")
          .createSignedUrl(document.file_path, 3600);

        if (urlError) throw urlError;
        setDocumentUrl(urlData.signedUrl);

        // Load existing tag placements
        const { data: existingPlacements, error: placementsError } = await supabase
          .from("document_tag_placements")
          .select("*")
          .eq("document_id", document.id);

        if (placementsError) throw placementsError;

        if (existingPlacements && existingPlacements.length > 0) {
          setPlacements(existingPlacements.map(p => ({
            id: p.id,
            tag_key: p.tag_key,
            page_number: p.page_number || 1,
            x_position: Number(p.x_position),
            y_position: Number(p.y_position),
            width: Number(p.width),
            height: Number(p.height),
            font_size: p.font_size || 12,
            font_family: p.font_family || "Arial",
            text_align: p.text_align || "left",
          })));
        }
      } catch (error) {
        console.error("Error loading document:", error);
        toast.error("Failed to load document");
      } finally {
        setLoading(false);
      }
    };

    loadDocument();
  }, [document]);

  // Initialize Fabric canvas
  useEffect(() => {
    if (!canvasRef.current || !documentUrl) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: 800,
      height: 1000,
      backgroundColor: "#f5f5f5",
    });

    setFabricCanvas(canvas);

    // Load document as background
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const scale = Math.min(800 / img.width, 1000 / img.height);
      canvas.setWidth(img.width * scale);
      canvas.setHeight(img.height * scale);
      
      // Set background using fabric Image
      import("fabric").then(({ FabricImage }) => {
        FabricImage.fromURL(img.src, { crossOrigin: "anonymous" }).then((fabricImg) => {
          fabricImg.scaleToWidth(img.width * scale);
          canvas.backgroundImage = fabricImg;
          canvas.renderAll();
        });
      });
    };
    img.src = documentUrl;

    // Selection events
    canvas.on("selection:created", (e) => {
      setSelectedObject(e.selected?.[0] || null);
    });

    canvas.on("selection:updated", (e) => {
      setSelectedObject(e.selected?.[0] || null);
    });

    canvas.on("selection:cleared", () => {
      setSelectedObject(null);
    });

    return () => {
      canvas.dispose();
    };
  }, [documentUrl]);

  // Add existing placements to canvas
  useEffect(() => {
    if (!fabricCanvas || placements.length === 0) return;

    placements.forEach((placement) => {
      addTagToCanvas(placement.tag_key, placement.x_position, placement.y_position, placement.width, placement.height);
    });
  }, [fabricCanvas, placements]);

  const addTagToCanvas = useCallback((tagKey: string, x?: number, y?: number, w?: number, h?: number) => {
    if (!fabricCanvas) return;

    const width = w || 150;
    const height = h || 24;
    const left = x ?? 100;
    const top = y ?? 100;

    // Create a group with background rect and text
    const rect = new Rect({
      width,
      height,
      fill: "rgba(59, 130, 246, 0.2)",
      stroke: "#3b82f6",
      strokeWidth: 1,
      rx: 4,
      ry: 4,
    });

    const text = new FabricText(`{{${tagKey}}}`, {
      fontSize: 11,
      fill: "#1e40af",
      fontFamily: "monospace",
      left: 4,
      top: 4,
    });

    // Create a simple rect with custom data
    const tagRect = new Rect({
      left,
      top,
      width,
      height,
      fill: "rgba(59, 130, 246, 0.15)",
      stroke: "#3b82f6",
      strokeWidth: 2,
      rx: 4,
      ry: 4,
      hasControls: true,
      hasBorders: true,
    });

    // Store tag key in object data
    (tagRect as any).tagKey = tagKey;

    fabricCanvas.add(tagRect);

    // Add label text on top
    const labelText = new FabricText(`{{${tagKey}}}`, {
      left: left + 4,
      top: top + 4,
      fontSize: 10,
      fill: "#1e40af",
      fontFamily: "monospace",
      selectable: false,
      evented: false,
    });
    (labelText as any).isLabel = true;
    (labelText as any).parentRect = tagRect;

    fabricCanvas.add(labelText);

    // Update label position when rect moves
    tagRect.on("moving", () => {
      labelText.set({
        left: (tagRect.left || 0) + 4,
        top: (tagRect.top || 0) + 4,
      });
      fabricCanvas.renderAll();
    });

    tagRect.on("scaling", () => {
      const newWidth = (tagRect.width || 150) * (tagRect.scaleX || 1);
      const newHeight = (tagRect.height || 24) * (tagRect.scaleY || 1);
      labelText.set({
        left: (tagRect.left || 0) + 4,
        top: (tagRect.top || 0) + 4,
      });
      fabricCanvas.renderAll();
    });

    fabricCanvas.setActiveObject(tagRect);
    fabricCanvas.renderAll();
  }, [fabricCanvas]);

  const handleAddTag = (tagKey: string) => {
    addTagToCanvas(tagKey);
    toast.success(`Added {{${tagKey}}} tag`);
  };

  const handleDeleteSelected = () => {
    if (!fabricCanvas || !selectedObject) return;

    // Find and remove associated label
    const objects = fabricCanvas.getObjects();
    const labelToRemove = objects.find((obj: any) => obj.isLabel && obj.parentRect === selectedObject);
    if (labelToRemove) {
      fabricCanvas.remove(labelToRemove);
    }

    fabricCanvas.remove(selectedObject);
    setSelectedObject(null);
    fabricCanvas.renderAll();
    toast.success("Tag removed");
  };

  const handleSave = async () => {
    if (!fabricCanvas || !tenantId) {
      toast.error("Unable to save - missing required data");
      return;
    }

    setSaving(true);
    try {
      // Get all tag rects from canvas
      const objects = fabricCanvas.getObjects();
      const tagRects = objects.filter((obj: any) => obj.tagKey && !obj.isLabel);

      const newPlacements: TagPlacement[] = tagRects.map((rect: any) => ({
        tag_key: rect.tagKey,
        page_number: 1,
        x_position: rect.left || 0,
        y_position: rect.top || 0,
        width: (rect.width || 150) * (rect.scaleX || 1),
        height: (rect.height || 24) * (rect.scaleY || 1),
        font_size: 12,
        font_family: "Arial",
        text_align: "left",
      }));

      // Delete existing placements
      await supabase
        .from("document_tag_placements")
        .delete()
        .eq("document_id", document.id);

      // Insert new placements
      if (newPlacements.length > 0) {
        const { error } = await supabase
          .from("document_tag_placements")
          .insert(
            newPlacements.map((p) => ({
              tenant_id: tenantId,
              document_id: document.id,
              tag_key: p.tag_key,
              page_number: p.page_number,
              x_position: p.x_position,
              y_position: p.y_position,
              width: p.width,
              height: p.height,
              font_size: p.font_size,
              font_family: p.font_family,
              text_align: p.text_align,
            }))
          );

        if (error) throw error;
      }

      toast.success(`Saved ${newPlacements.length} tag placements`);
      onSave();
    } catch (error) {
      console.error("Error saving placements:", error);
      toast.error("Failed to save tag placements");
    } finally {
      setSaving(false);
    }
  };

  const handleZoom = (direction: "in" | "out" | "reset") => {
    if (!fabricCanvas) return;
    
    let newZoom = zoom;
    if (direction === "in") newZoom = Math.min(zoom + 0.25, 3);
    else if (direction === "out") newZoom = Math.max(zoom - 0.25, 0.5);
    else newZoom = 1;

    setZoom(newZoom);
    fabricCanvas.setZoom(newZoom);
    fabricCanvas.renderAll();
  };

  const filteredTags = Object.entries(SMART_TAG_CATEGORIES).reduce((acc, [category, tags]) => {
    const filtered = tags.filter(
      (tag) =>
        tag.key.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tag.label.toLowerCase().includes(searchTerm.toLowerCase())
    );
    if (filtered.length > 0) acc[category] = filtered;
    return acc;
  }, {} as Record<string, typeof SMART_TAG_CATEGORIES.Contact>);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-background z-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-card">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="font-semibold">Edit Smart Tags</h2>
            <p className="text-sm text-muted-foreground">{document.filename}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 mr-4">
            <Button variant="outline" size="icon" onClick={() => handleZoom("out")}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-sm w-12 text-center">{Math.round(zoom * 100)}%</span>
            <Button variant="outline" size="icon" onClick={() => handleZoom("in")}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => handleZoom("reset")}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
          {selectedObject && (
            <Button variant="destructive" size="sm" onClick={handleDeleteSelected}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Selected
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving..." : "Save Tags"}
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tag palette sidebar */}
        <div className="w-72 border-r bg-card flex flex-col">
          <div className="p-4 border-b">
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <TagIcon className="h-4 w-4" />
              Smart Tags
            </h3>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tags..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4">
              {Object.entries(filteredTags).map(([category, tags]) => (
                <div key={category}>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">
                    {category}
                  </h4>
                  <div className="space-y-1">
                    {tags.map((tag) => (
                      <Button
                        key={tag.key}
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start text-left h-auto py-2"
                        onClick={() => handleAddTag(tag.key)}
                      >
                        <div>
                          <div className="font-medium">{tag.label}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {`{{${tag.key}}}`}
                          </div>
                        </div>
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="p-4 border-t bg-muted/50">
            <p className="text-xs text-muted-foreground">
              Click a tag to add it to the document. Drag to reposition, resize using handles.
            </p>
          </div>
        </div>

        {/* Canvas area */}
        <div className="flex-1 overflow-auto bg-muted/30 p-8">
          <div className="inline-block shadow-lg rounded-lg overflow-hidden">
            <canvas ref={canvasRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
