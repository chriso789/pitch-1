import React, { useState, useMemo } from 'react';
import { Check, ChevronsUpDown, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';

interface Template {
  id: string;
  name: string;
  roof_type?: string;
  labor?: Record<string, any>;
  overhead?: Record<string, any>;
  currency?: string;
}

interface TemplateComboboxProps {
  templates: Template[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const ROOF_TYPE_LABELS: Record<string, string> = {
  shingle: 'Shingle',
  metal: 'Metal',
  tile: 'Tile',
  flat: 'Flat / Low Slope',
  stone_coated: 'Stone Coated',
  other: 'Other',
};

const ROOF_TYPE_ORDER = ['shingle', 'metal', 'tile', 'stone_coated', 'flat', 'other'];

export const TemplateCombobox: React.FC<TemplateComboboxProps> = ({
  templates,
  value,
  onValueChange,
  placeholder = 'Select a template...',
  disabled = false,
  className,
}) => {
  const [open, setOpen] = useState(false);

  // Group templates by roof_type
  const groupedTemplates = useMemo(() => {
    const groups: Record<string, Template[]> = {};
    
    templates.forEach(template => {
      const roofType = template.roof_type || 'other';
      if (!groups[roofType]) {
        groups[roofType] = [];
      }
      groups[roofType].push(template);
    });

    // Sort each group by name
    Object.values(groups).forEach(group => {
      group.sort((a, b) => a.name.localeCompare(b.name));
    });

    return groups;
  }, [templates]);

  // Get sorted roof types that have templates
  const sortedRoofTypes = useMemo(() => {
    return ROOF_TYPE_ORDER.filter(type => groupedTemplates[type]?.length > 0);
  }, [groupedTemplates]);

  // Find selected template
  const selectedTemplate = useMemo(() => {
    return templates.find(t => t.id === value);
  }, [templates, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full justify-between', className)}
        >
          <div className="flex items-center gap-2 truncate">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            {selectedTemplate ? (
              <span className="truncate">{selectedTemplate.name}</span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search templates..." />
          <CommandList>
            <CommandEmpty>No template found.</CommandEmpty>
            
            {sortedRoofTypes.map(roofType => (
              <CommandGroup 
                key={roofType} 
                heading={
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs uppercase tracking-wide">
                      {ROOF_TYPE_LABELS[roofType] || roofType}
                    </span>
                    <Badge variant="secondary" className="text-xs h-5">
                      {groupedTemplates[roofType].length}
                    </Badge>
                  </div>
                }
              >
                {groupedTemplates[roofType].map(template => (
                  <CommandItem
                    key={template.id}
                    value={template.name}
                    onSelect={() => {
                      onValueChange(template.id);
                      setOpen(false);
                    }}
                    className="cursor-pointer"
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === template.id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="truncate">{template.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
