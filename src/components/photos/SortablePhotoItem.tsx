import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Star,
  FileText,
  Edit2,
  Trash2,
  MoreVertical,
  GripVertical,
  Download,
  Tag,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { type CustomerPhoto, type PhotoCategory } from '@/hooks/usePhotos';

const CATEGORY_COLORS: Record<string, string> = {
  before: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  after: 'bg-green-500/10 text-green-600 border-green-500/20',
  damage: 'bg-red-500/10 text-red-600 border-red-500/20',
  materials: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  inspection: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  roof: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  general: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  other: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
};

const CATEGORY_LABELS: Record<string, string> = {
  before: 'Before',
  after: 'After',
  damage: 'Damage',
  materials: 'Materials',
  inspection: 'Inspection',
  roof: 'Roof',
  general: 'General',
  other: 'Other',
};

interface SortablePhotoItemProps {
  photo: CustomerPhoto;
  viewMode: 'grid' | 'list';
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onSetPrimary: () => void;
  onToggleEstimate: (include: boolean) => void;
  onDelete: () => void;
  onUpdateCategory: (category: PhotoCategory) => void;
}

export const SortablePhotoItem: React.FC<SortablePhotoItemProps> = ({
  photo,
  viewMode,
  isSelected,
  onSelect,
  onEdit,
  onSetPrimary,
  onToggleEstimate,
  onDelete,
  onUpdateCategory,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: photo.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const category = photo.category || 'general';

  if (viewMode === 'list') {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          'flex items-center gap-3 p-2 rounded-lg border bg-card transition-colors',
          isDragging && 'opacity-50',
          isSelected && 'ring-2 ring-primary'
        )}
      >
        <button
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <Checkbox checked={isSelected} onCheckedChange={onSelect} />

        <div className="w-12 h-12 rounded overflow-hidden flex-shrink-0">
          <img
            src={photo.file_url}
            alt={photo.description || 'Photo'}
            className="w-full h-full object-cover"
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">
              {photo.description || photo.original_filename || 'Untitled'}
            </p>
            {photo.is_primary && (
              <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 flex-shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className={cn('text-[10px] py-0', CATEGORY_COLORS[category])}>
              {CATEGORY_LABELS[category] || category}
            </Badge>
            {photo.include_in_estimate && (
              <Badge variant="outline" className="text-[10px] py-0 bg-green-50 text-green-600 border-green-200">
                In Estimate
              </Badge>
            )}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Edit2 className="h-4 w-4 mr-2" />
              Edit / Markup
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onSetPrimary}>
              <Star className="h-4 w-4 mr-2" />
              Set as Primary
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onToggleEstimate(!photo.include_in_estimate)}>
              <FileText className="h-4 w-4 mr-2" />
              {photo.include_in_estimate ? 'Remove from Estimate' : 'Add to Estimate'}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Tag className="h-4 w-4 mr-2" />
                Category
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <DropdownMenuItem
                    key={value}
                    onClick={() => onUpdateCategory(value as PhotoCategory)}
                  >
                    <span className={cn('w-2 h-2 rounded-full mr-2', 
                      value === 'before' && 'bg-blue-500',
                      value === 'after' && 'bg-green-500',
                      value === 'damage' && 'bg-red-500',
                      value === 'materials' && 'bg-orange-500',
                      value === 'inspection' && 'bg-purple-500',
                      value === 'roof' && 'bg-amber-500',
                      (value === 'general' || value === 'other') && 'bg-gray-500'
                    )} />
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={() => window.open(photo.file_url, '_blank')}
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  // Grid view
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative rounded-lg overflow-hidden border bg-card transition-all',
        isDragging && 'opacity-50 scale-105',
        isSelected && 'ring-2 ring-primary'
      )}
    >
      {/* Image */}
      <div className="aspect-square relative">
        <img
          src={photo.file_url}
          alt={photo.description || 'Photo'}
          className="w-full h-full object-cover"
        />

        {/* Overlay on hover */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors">
          {/* Drag handle */}
          <button
            className="absolute top-2 left-2 p-1 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-grab touch-none"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>

          {/* Checkbox */}
          <div 
            className={cn(
              'absolute top-2 right-2 transition-opacity',
              isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            )}
          >
            <Checkbox 
              checked={isSelected} 
              onCheckedChange={onSelect}
              className="bg-white/90 border-white"
            />
          </div>

          {/* Action buttons on hover */}
          <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button 
              size="icon" 
              variant="secondary" 
              className="h-7 w-7 bg-white/90 hover:bg-white"
              onClick={onEdit}
            >
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  size="icon" 
                  variant="secondary" 
                  className="h-7 w-7 bg-white/90 hover:bg-white"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onSetPrimary}>
                  <Star className="h-4 w-4 mr-2" />
                  Set as Primary
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onToggleEstimate(!photo.include_in_estimate)}>
                  <FileText className="h-4 w-4 mr-2" />
                  {photo.include_in_estimate ? 'Remove from Estimate' : 'Add to Estimate'}
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Tag className="h-4 w-4 mr-2" />
                    Category
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                      <DropdownMenuItem
                        key={value}
                        onClick={() => onUpdateCategory(value as PhotoCategory)}
                      >
                        {label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Badges */}
        <div className="absolute bottom-2 left-2 flex gap-1">
          {photo.is_primary && (
            <div className="p-1 rounded bg-amber-500 text-white">
              <Star className="h-3 w-3 fill-current" />
            </div>
          )}
          {photo.include_in_estimate && (
            <div className="p-1 rounded bg-green-500 text-white">
              <FileText className="h-3 w-3" />
            </div>
          )}
        </div>
      </div>

      {/* Category badge below image */}
      <div className="p-2 border-t">
        <Badge variant="outline" className={cn('text-[10px]', CATEGORY_COLORS[category])}>
          {CATEGORY_LABELS[category] || category}
        </Badge>
      </div>
    </div>
  );
};
