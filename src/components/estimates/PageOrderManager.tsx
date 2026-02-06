/**
 * PageOrderManager - Drag-and-drop page reordering for estimate PDFs
 * 
 * Allows users to reorder the sections of their estimate document:
 * - Cover Page
 * - Estimate Content (always present)
 * - Warranty Info
 * - Attachments
 */
import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  FileText,
  ScrollText,
  Shield,
  Paperclip,
  Image,
  Ruler,
} from 'lucide-react';

export interface PageOrderItem {
  id: string;
  label: string;
  enabled: boolean;
  locked?: boolean; // Some pages can't be disabled (content)
  icon: React.ReactNode;
}

export const DEFAULT_PAGE_ORDER: PageOrderItem[] = [
  { id: 'cover_page', label: 'Cover Page', enabled: true, icon: <FileText className="h-3.5 w-3.5" /> },
  { id: 'estimate_content', label: 'Estimate Content', enabled: true, locked: true, icon: <ScrollText className="h-3.5 w-3.5" /> },
  { id: 'measurement_details', label: 'Measurement Details', enabled: false, icon: <Ruler className="h-3.5 w-3.5" /> },
  { id: 'job_photos', label: 'Job Photos', enabled: false, icon: <Image className="h-3.5 w-3.5" /> },
  { id: 'warranty_info', label: 'Warranty Info', enabled: true, icon: <Shield className="h-3.5 w-3.5" /> },
  { id: 'attachments', label: 'Attachments', enabled: true, icon: <Paperclip className="h-3.5 w-3.5" /> },
];

interface PageOrderManagerProps {
  pageOrder: PageOrderItem[];
  onPageOrderChange: (newOrder: PageOrderItem[]) => void;
  hasAttachments?: boolean;
  hasMeasurements?: boolean;
  hasPhotos?: boolean;
}

// Sortable page item component
function SortablePageItem({
  page,
  onToggle,
  isDisabled,
}: {
  page: PageOrderItem;
  onToggle: () => void;
  isDisabled?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-2 rounded-md border bg-background ${
        isDragging ? 'shadow-lg border-primary' : ''
      } ${!page.enabled || isDisabled ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      
      <div className="text-muted-foreground shrink-0">
        {page.icon}
      </div>
      
      <Label className="flex-1 text-sm cursor-pointer" htmlFor={`page-toggle-${page.id}`}>
        {page.label}
      </Label>
      
      <Switch
        id={`page-toggle-${page.id}`}
        checked={page.enabled && !isDisabled}
        onCheckedChange={onToggle}
        disabled={page.locked || isDisabled}
        className="scale-75"
      />
    </div>
  );
}

export function PageOrderManager({
  pageOrder,
  onPageOrderChange,
  hasAttachments = true,
  hasMeasurements = false,
  hasPhotos = false,
}: PageOrderManagerProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = pageOrder.findIndex(p => p.id === active.id);
      const newIndex = pageOrder.findIndex(p => p.id === over.id);
      const reordered = arrayMove(pageOrder, oldIndex, newIndex);
      onPageOrderChange(reordered);
    }
  };

  const handleToggle = (pageId: string) => {
    const updated = pageOrder.map(p =>
      p.id === pageId && !p.locked ? { ...p, enabled: !p.enabled } : p
    );
    onPageOrderChange(updated);
  };

  // Determine which pages should be disabled (no content available)
  const getIsDisabled = (pageId: string) => {
    if (pageId === 'attachments' && !hasAttachments) return true;
    if (pageId === 'measurement_details' && !hasMeasurements) return true;
    if (pageId === 'job_photos' && !hasPhotos) return true;
    return false;
  };

  return (
    <div className="space-y-2">
      <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
        <FileText className="h-3 w-3" />
        Page Order
      </h4>
      
      <p className="text-[10px] text-muted-foreground">
        Drag to reorder • Toggle to show/hide
      </p>

      <div className="space-y-1">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={pageOrder.map(p => p.id)}
            strategy={verticalListSortingStrategy}
          >
            {pageOrder.map(page => (
              <SortablePageItem
                key={page.id}
                page={page}
                onToggle={() => handleToggle(page.id)}
                isDisabled={getIsDisabled(page.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

export default PageOrderManager;
