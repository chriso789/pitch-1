import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { GripVertical, FileText, Ruler, Image, Calculator, BookOpen, PenTool } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ReportSection } from '@/pages/reports/ReportBuilderPage';

interface SectionOrderListProps {
  sections: ReportSection[];
  onReorder: (sections: ReportSection[]) => void;
}

const sectionIcons: Record<string, any> = {
  cover: FileText,
  measurements: Ruler,
  photos: Image,
  estimate: Calculator,
  marketing: BookOpen,
  signature: PenTool,
};

function SortableItem({ section }: { section: ReportSection }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const Icon = sectionIcons[section.type] || FileText;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 bg-card border rounded-lg mb-2 ${
        isDragging ? 'shadow-lg ring-2 ring-primary' : 'hover:bg-muted/50'
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="flex-1 text-sm font-medium">{section.label}</span>
      {section.pageCount && section.pageCount > 0 && (
        <Badge variant="outline" className="text-xs">
          {section.pageCount} {section.pageCount === 1 ? 'page' : 'pages'}
        </Badge>
      )}
    </div>
  );
}

export function SectionOrderList({ sections, onReorder }: SectionOrderListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = sections.findIndex((s) => s.id === active.id);
      const newIndex = sections.findIndex((s) => s.id === over.id);
      const reordered = arrayMove(sections, oldIndex, newIndex);
      onReorder(reordered);
    }
  };

  if (sections.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p className="text-sm">No sections selected</p>
        <p className="text-xs mt-1">Enable sections in the left panel</p>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
        <div>
          {sections.map((section) => (
            <SortableItem key={section.id} section={section} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
