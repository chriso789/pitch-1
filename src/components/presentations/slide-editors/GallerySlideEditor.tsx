import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Trash2, Image, GripVertical } from "lucide-react";

interface GalleryImage {
  id: string;
  url: string;
  caption?: string;
}

interface GallerySlideEditorProps {
  slide: any;
  onUpdate: () => void;
}

export const GallerySlideEditor = ({ slide, onUpdate }: GallerySlideEditorProps) => {
  const { toast } = useToast();
  const [title, setTitle] = useState(slide.content?.title || "Photo Gallery");
  const [images, setImages] = useState<GalleryImage[]>(slide.content?.images || []);
  const [newImageUrl, setNewImageUrl] = useState("");

  useEffect(() => {
    setTitle(slide.content?.title || "Photo Gallery");
    setImages(slide.content?.images || []);
  }, [slide.id]);

  const saveContent = async (updatedImages: GalleryImage[], updatedTitle?: string) => {
    try {
      const updatedContent = {
        ...slide.content,
        title: updatedTitle ?? title,
        images: updatedImages,
      };

      const { error } = await supabase
        .from("presentation_slides")
        .update({ content: updatedContent })
        .eq("id", slide.id);

      if (error) throw error;
      onUpdate();
    } catch (error: any) {
      console.error("Error updating slide:", error);
      toast({
        title: "Failed to update",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleAddImage = () => {
    if (!newImageUrl.trim()) return;
    
    const newImage: GalleryImage = {
      id: crypto.randomUUID(),
      url: newImageUrl.trim(),
      caption: "",
    };
    
    const updatedImages = [...images, newImage];
    setImages(updatedImages);
    setNewImageUrl("");
    saveContent(updatedImages);
  };

  const handleRemoveImage = (id: string) => {
    const updatedImages = images.filter((img) => img.id !== id);
    setImages(updatedImages);
    saveContent(updatedImages);
  };

  const handleCaptionChange = (id: string, caption: string) => {
    const updatedImages = images.map((img) =>
      img.id === id ? { ...img, caption } : img
    );
    setImages(updatedImages);
  };

  const handleCaptionBlur = (id: string, caption: string) => {
    const updatedImages = images.map((img) =>
      img.id === id ? { ...img, caption } : img
    );
    saveContent(updatedImages);
  };

  return (
    <div className="space-y-6">
      <Card className="p-8">
        <h2 className="text-3xl font-bold text-center mb-6">{title}</h2>
        {images.length > 0 ? (
          <div className="grid grid-cols-2 gap-4">
            {images.slice(0, 4).map((image) => (
              <div key={image.id} className="relative group">
                <img
                  src={image.url}
                  alt={image.caption || "Gallery image"}
                  className="w-full aspect-video object-cover rounded-lg"
                />
                {image.caption && (
                  <p className="text-sm text-center text-muted-foreground mt-2">
                    {image.caption}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <Image className="h-16 w-16 mx-auto mb-4 opacity-50" />
            <p>No images in gallery. Add images below.</p>
          </div>
        )}
      </Card>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="title">Gallery Title</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={(e) => saveContent(images, e.target.value)}
            placeholder="Photo Gallery"
          />
        </div>

        <div className="space-y-2">
          <Label>Add Image</Label>
          <div className="flex gap-2">
            <Input
              value={newImageUrl}
              onChange={(e) => setNewImageUrl(e.target.value)}
              placeholder="https://example.com/image.jpg"
              onKeyDown={(e) => e.key === "Enter" && handleAddImage()}
            />
            <Button onClick={handleAddImage} size="icon">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {images.length > 0 && (
          <div className="space-y-2">
            <Label>Gallery Images ({images.length})</Label>
            <div className="space-y-3">
              {images.map((image) => (
                <div
                  key={image.id}
                  className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg"
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                  <img
                    src={image.url}
                    alt={image.caption || "Gallery image"}
                    className="w-16 h-12 object-cover rounded"
                  />
                  <Input
                    value={image.caption || ""}
                    onChange={(e) => handleCaptionChange(image.id, e.target.value)}
                    onBlur={(e) => handleCaptionBlur(image.id, e.target.value)}
                    placeholder="Add caption..."
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleRemoveImage(image.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
