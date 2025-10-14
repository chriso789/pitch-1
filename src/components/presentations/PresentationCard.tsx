import { Edit, Copy, Trash2, Eye, Play, Share2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { SharePresentationDialog } from "./SharePresentationDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface PresentationCardProps {
  presentation: any;
  onRefetch: () => void;
}

export const PresentationCard = ({
  presentation,
  onRefetch,
}: PresentationCardProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleEdit = () => {
    navigate(`/presentations/${presentation.id}/edit`);
  };

  const handleDuplicate = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Duplicate presentation
      const { data: newPresentation, error: presentationError } = await supabase
        .from("presentations")
        .insert({
          tenant_id: presentation.tenant_id,
          name: `${presentation.name} (Copy)`,
          description: presentation.description,
          template_type: presentation.template_type,
          is_template: false,
          created_by: user.id,
          metadata: presentation.metadata,
        })
        .select()
        .single();

      if (presentationError) throw presentationError;

      // Duplicate slides
      const { data: slides, error: slidesError } = await supabase
        .from("presentation_slides")
        .select("*")
        .eq("presentation_id", presentation.id)
        .order("slide_order", { ascending: true });

      if (slidesError) throw slidesError;

      if (slides && slides.length > 0) {
        const newSlides = slides.map((slide) => ({
          presentation_id: newPresentation.id,
          slide_order: slide.slide_order,
          slide_type: slide.slide_type,
          content: slide.content,
          transition_effect: slide.transition_effect,
          notes: slide.notes,
        }));

        const { error: insertError } = await supabase
          .from("presentation_slides")
          .insert(newSlides);

        if (insertError) throw insertError;
      }

      toast({
        title: "Presentation duplicated",
        description: "A copy has been created successfully.",
      });

      onRefetch();
    } catch (error: any) {
      console.error("Error duplicating presentation:", error);
      toast({
        title: "Failed to duplicate",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    try {
      const { error } = await supabase
        .from("presentations")
        .delete()
        .eq("id", presentation.id);

      if (error) throw error;

      toast({
        title: "Presentation deleted",
        description: "The presentation has been removed.",
      });

      onRefetch();
    } catch (error: any) {
      console.error("Error deleting presentation:", error);
      toast({
        title: "Failed to delete",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handlePreview = () => {
    navigate(`/presentations/${presentation.id}/present`);
  };

  return (
    <Card className="hover:shadow-lg transition-all">
      <CardContent className="p-0">
        <div className="aspect-video bg-muted flex items-center justify-center border-b">
          {presentation.thumbnail_url ? (
            <img
              src={presentation.thumbnail_url}
              alt={presentation.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="text-muted-foreground text-center p-4">
              <Eye className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No preview available</p>
            </div>
          )}
        </div>
        <div className="p-4">
          <div className="flex items-start justify-between mb-2">
            <h3 className="font-semibold text-lg line-clamp-1">
              {presentation.name}
            </h3>
            {presentation.is_template && (
              <Badge variant="secondary" className="ml-2">
                Template
              </Badge>
            )}
          </div>
          {presentation.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
              {presentation.description}
            </p>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {new Date(presentation.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="p-4 pt-0 flex gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={handleEdit}
          className="flex-1"
        >
          <Edit className="h-3 w-3 mr-1" />
          Edit
        </Button>
        <Button variant="outline" size="sm" onClick={handlePreview}>
          <Play className="h-3 w-3" />
        </Button>
        <SharePresentationDialog presentationId={presentation.id} />
        <Button variant="outline" size="sm" onClick={handleDuplicate}>
          <Copy className="h-3 w-3" />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Presentation</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{presentation.name}"? This
                action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardFooter>
    </Card>
  );
};
