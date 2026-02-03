import React, { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Search,
  ChevronRight,
  GripVertical,
  User,
  Briefcase,
  Building2,
  DollarSign,
  FileText,
  Ruler,
  Calendar,
  Pen,
  CheckSquare,
  Type,
  Shield,
  UserCircle,
} from 'lucide-react';

export type SmartTagType = 'smart_tag' | 'text_input' | 'signature' | 'checkbox' | 'initial';
export type RecipientType = 'system' | 'homeowner' | 'contractor';

export interface SmartTag {
  key: string;
  label: string;
  type?: SmartTagType;
  recipient?: RecipientType;
  description?: string;
}

export interface SmartTagCategory {
  name: string;
  icon: React.ReactNode;
  tags: SmartTag[];
}

interface SmartTagPaletteProps {
  categories: SmartTagCategory[];
  onTagDragStart?: (tag: SmartTag) => void;
  onTagClick?: (tag: SmartTag) => void;
  searchPlaceholder?: string;
  className?: string;
}

// Default smart tag categories
export const DEFAULT_SMART_TAG_CATEGORIES: SmartTagCategory[] = [
  {
    name: 'Contact',
    icon: <User className="h-4 w-4" />,
    tags: [
      { key: 'contact.first_name', label: 'First Name' },
      { key: 'contact.last_name', label: 'Last Name' },
      { key: 'contact.full_name', label: 'Full Name' },
      { key: 'contact.email', label: 'Email' },
      { key: 'contact.phone', label: 'Phone' },
      { key: 'contact.address', label: 'Address' },
      { key: 'contact.city', label: 'City' },
      { key: 'contact.state', label: 'State' },
      { key: 'contact.zip', label: 'ZIP Code' },
    ],
  },
  {
    name: 'Project',
    icon: <Briefcase className="h-4 w-4" />,
    tags: [
      { key: 'project.name', label: 'Project Name' },
      { key: 'project.address', label: 'Project Address' },
      { key: 'project.status', label: 'Status' },
      { key: 'project.lead_number', label: 'Lead Number' },
      { key: 'project.estimated_value', label: 'Estimated Value' },
    ],
  },
  {
    name: 'Company',
    icon: <Building2 className="h-4 w-4" />,
    tags: [
      { key: 'company.name', label: 'Company Name' },
      { key: 'company.phone', label: 'Company Phone' },
      { key: 'company.email', label: 'Company Email' },
      { key: 'company.address', label: 'Company Address' },
      { key: 'company.license_number', label: 'License Number' },
    ],
  },
  {
    name: 'Financial',
    icon: <DollarSign className="h-4 w-4" />,
    tags: [
      { key: 'estimate.total', label: 'Total Amount' },
      { key: 'estimate.subtotal', label: 'Subtotal' },
      { key: 'estimate.tax', label: 'Tax' },
      { key: 'job.deposit_amount', label: 'Deposit Amount' },
      { key: 'job.remaining_balance', label: 'Remaining Balance' },
    ],
  },
  {
    name: 'Measurement',
    icon: <Ruler className="h-4 w-4" />,
    tags: [
      { key: 'measurement.total_sqft', label: 'Total Sq Ft' },
      { key: 'measurement.total_squares', label: 'Total Squares' },
      { key: 'measurement.predominant_pitch', label: 'Predominant Pitch' },
      { key: 'measurement.ridge_lf', label: 'Ridge LF' },
      { key: 'measurement.valley_lf', label: 'Valley LF' },
    ],
  },
  {
    name: 'Sales Rep',
    icon: <UserCircle className="h-4 w-4" />,
    tags: [
      { key: 'rep.name', label: 'Rep Full Name' },
      { key: 'rep.email', label: 'Rep Email' },
      { key: 'rep.phone', label: 'Rep Phone' },
      { key: 'rep.title', label: 'Rep Title' },
    ],
  },
  {
    name: 'Insurance',
    icon: <Shield className="h-4 w-4" />,
    tags: [
      { key: 'insurance.claim_number', label: 'Claim Number' },
      { key: 'insurance.carrier', label: 'Insurance Carrier' },
      { key: 'insurance.adjuster_name', label: 'Adjuster Name' },
      { key: 'insurance.deductible', label: 'Deductible' },
    ],
  },
  {
    name: 'Date',
    icon: <Calendar className="h-4 w-4" />,
    tags: [
      { key: 'today.date', label: "Today's Date" },
      { key: 'today.date_long', label: 'Today (Long Format)' },
      { key: 'today.year', label: 'Current Year' },
    ],
  },
  {
    name: 'Signatures',
    icon: <Pen className="h-4 w-4" />,
    tags: [
      { key: 'signature.homeowner', label: 'Homeowner Signature', type: 'signature', recipient: 'homeowner' },
      { key: 'signature.homeowner_date', label: 'Homeowner Sign Date', type: 'signature', recipient: 'homeowner' },
      { key: 'signature.homeowner_name', label: 'Homeowner Printed Name', type: 'signature', recipient: 'homeowner' },
      { key: 'signature.contractor', label: 'Contractor Signature', type: 'signature', recipient: 'contractor' },
      { key: 'initials.homeowner', label: 'Homeowner Initials', type: 'initial', recipient: 'homeowner' },
    ],
  },
  {
    name: 'Text Fields',
    icon: <Type className="h-4 w-4" />,
    tags: [
      { key: 'input.text', label: 'Text Box', type: 'text_input', recipient: 'homeowner' },
      { key: 'input.date', label: 'Date Field', type: 'text_input', recipient: 'homeowner' },
      { key: 'input.number', label: 'Number Field', type: 'text_input', recipient: 'homeowner' },
    ],
  },
  {
    name: 'Checkboxes',
    icon: <CheckSquare className="h-4 w-4" />,
    tags: [
      { key: 'checkbox.single', label: 'Checkbox', type: 'checkbox', recipient: 'homeowner' },
      { key: 'checkbox.required', label: 'Required Checkbox', type: 'checkbox', recipient: 'homeowner' },
      { key: 'checkbox.terms', label: 'Accept Terms', type: 'checkbox', recipient: 'homeowner' },
    ],
  },
];

/**
 * Smart Tag Palette Component
 * 
 * Provides a searchable, categorized list of smart tags that can be
 * dragged and dropped onto a document template.
 */
export const SmartTagPalette: React.FC<SmartTagPaletteProps> = ({
  categories = DEFAULT_SMART_TAG_CATEGORIES,
  onTagDragStart,
  onTagClick,
  searchPlaceholder = 'Search tags...',
  className,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(categories.slice(0, 3).map(c => c.name))
  );

  const toggleCategory = (name: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const filteredCategories = useMemo(() => {
    if (!searchTerm) return categories;

    const term = searchTerm.toLowerCase();
    return categories
      .map(category => ({
        ...category,
        tags: category.tags.filter(
          tag =>
            tag.label.toLowerCase().includes(term) ||
            tag.key.toLowerCase().includes(term)
        ),
      }))
      .filter(category => category.tags.length > 0);
  }, [categories, searchTerm]);

  const handleDragStart = (e: React.DragEvent, tag: SmartTag) => {
    e.dataTransfer.setData('application/json', JSON.stringify(tag));
    e.dataTransfer.effectAllowed = 'copy';
    onTagDragStart?.(tag);
  };

  const getTagTypeColor = (type?: SmartTagType): string => {
    switch (type) {
      case 'signature':
        return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
      case 'text_input':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      case 'checkbox':
        return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      case 'initial':
        return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
      default:
        return 'bg-muted text-foreground';
    }
  };

  return (
    <div className={cn('flex flex-col h-full bg-background border-l', className)}>
      {/* Header */}
      <div className="p-3 border-b">
        <h3 className="text-sm font-semibold mb-2">Smart Tags</h3>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* Tag Categories */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {filteredCategories.map((category) => (
            <Collapsible
              key={category.name}
              open={searchTerm ? true : expandedCategories.has(category.name)}
              onOpenChange={() => !searchTerm && toggleCategory(category.name)}
            >
              <CollapsibleTrigger asChild>
                <button
                  className={cn(
                    'flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm font-medium',
                    'hover:bg-muted/50 transition-colors',
                    expandedCategories.has(category.name) && 'bg-muted/30'
                  )}
                >
                  <ChevronRight
                    className={cn(
                      'h-4 w-4 transition-transform',
                      (searchTerm || expandedCategories.has(category.name)) && 'rotate-90'
                    )}
                  />
                  {category.icon}
                  <span className="flex-1 text-left">{category.name}</span>
                  <Badge variant="secondary" className="text-xs h-5">
                    {category.tags.length}
                  </Badge>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="pl-6 pr-2 py-1 space-y-1">
                  {category.tags.map((tag) => (
                    <div
                      key={tag.key}
                      draggable
                      onDragStart={(e) => handleDragStart(e, tag)}
                      onClick={() => onTagClick?.(tag)}
                      className={cn(
                        'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-grab',
                        'text-sm hover:bg-muted/50 transition-colors active:cursor-grabbing',
                        getTagTypeColor(tag.type)
                      )}
                    >
                      <GripVertical className="h-3 w-3 opacity-40" />
                      <span className="flex-1 truncate">{tag.label}</span>
                      {tag.type && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1">
                          {tag.type === 'signature' ? '✍️' : 
                           tag.type === 'checkbox' ? '☑️' :
                           tag.type === 'text_input' ? '📝' : '🖊️'}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}

          {filteredCategories.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No tags matching "{searchTerm}"
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Instructions */}
      <div className="p-3 border-t bg-muted/30">
        <p className="text-xs text-muted-foreground">
          Drag tags onto the document or click to add at cursor position.
        </p>
      </div>
    </div>
  );
};

export default SmartTagPalette;
