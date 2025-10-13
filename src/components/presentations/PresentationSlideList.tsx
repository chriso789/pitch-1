import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface SlideItemProps {
  slide: any;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

const SlideItem = ({ slide, isSelected, onSelect, onDelete }: SlideItemProps) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: slide.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const getSlideTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      title: "Title",
      text: "Text",
      image: "Image",
      video: "Video",
      estimate_summary: "Estimate",
      testimonial: "Testimonial",
      signature: "Signature",
      company_intro: "Company",
      financing: "Financing",
      warranty: "Warranty",
    };
    return labels[type] || type;
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative border rounded-lg p-3 mb-2 cursor-pointer transition-all",
        isSelected
          ? "bg-primary/10 border-primary"
          : "bg-card border-border hover:border-primary/50"
      )}
      onClick={onSelect}
    >
      <div className="flex items-start gap-2">
        <button
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground mt-1"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground">
              Slide {slide.slide_order + 1}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          </div>
          <p className="text-sm font-medium truncate">
            {getSlideTypeLabel(slide.slide_type)}
          </p>
          {slide.content?.title && (
            <p className="text-xs text-muted-foreground truncate mt-1">
              {slide.content.title}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

interface PresentationSlideListProps {
  slides: any[];
  selectedSlideId: string | null;
  onSlideSelect: (id: string) => void;
  onSlidesReorder: (slides: any[]) => void;
  onRefetch: () => void;
}

export const PresentationSlideList = ({
  slides,
  selectedSlideId,
  onSlideSelect,
  onSlidesReorder,
  onRefetch,
}: PresentationSlideListProps) => {
  const { toast } = useToast();
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = slides.findIndex((slide) => slide.id === active.id);
      const newIndex = slides.findIndex((slide) => slide.id === over.id);

      const newSlides = arrayMove(slides, oldIndex, newIndex).map(
        (slide, index) => ({
          ...slide,
          slide_order: index,
        })
      );

      onSlidesReorder(newSlides);

      try {
        const updates = newSlides.map((slide) =>
          supabase
            .from("presentation_slides")
            .update({ slide_order: slide.slide_order })
            .eq("id", slide.id)
        );

        await Promise.all(updates);

        toast({
          title: "Slides reordered",
          description: "Slide order has been updated.",
        });
      } catch (error: any) {
        console.error("Error reordering slides:", error);
        toast({
          title: "Failed to reorder",
          description: error.message,
          variant: "destructive",
        });
        onRefetch();
      }
    }
  };

  const handleDeleteSlide = async (slideId: string) => {
    try {
      const { error } = await supabase
        .from("presentation_slides")
        .delete()
        .eq("id", slideId);

      if (error) throw error;

      toast({
        title: "Slide deleted",
        description: "The slide has been removed.",
      });

      onRefetch();
    } catch (error: any) {
      console.error("Error deleting slide:", error);
      toast({
        title: "Failed to delete slide",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold mb-4">Slides</h3>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={slides.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          {slides.map((slide) => (
            <SlideItem
              key={slide.id}
              slide={slide}
              isSelected={selectedSlideId === slide.id}
              onSelect={() => onSlideSelect(slide.id)}
              onDelete={() => handleDeleteSlide(slide.id)}
            />
          ))}
        </SortableContext>
      </DndContext>
      {slides.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No slides yet. Add your first slide to get started.
        </p>
      )}
    </div>
  );
};
