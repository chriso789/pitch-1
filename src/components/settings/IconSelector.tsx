import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import * as LucideIcons from 'lucide-react';

interface IconSelectorProps {
  value: string;
  onChange: (iconName: string) => void;
}

export const IconSelector = ({ value, onChange }: IconSelectorProps) => {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  // Get all available icon names
  const allIcons = Object.keys(LucideIcons).filter(
    name => name !== 'createLucideIcon' && typeof LucideIcons[name as keyof typeof LucideIcons] === 'object'
  );

  // Filter icons based on search
  const filteredIcons = allIcons.filter(name =>
    name.toLowerCase().includes(search.toLowerCase())
  );

  // Get current icon component
  const CurrentIcon = (LucideIcons[value as keyof typeof LucideIcons] || LucideIcons.Settings) as React.ComponentType<{ className?: string }>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start">
          <CurrentIcon className="mr-2 h-4 w-4" />
          {value}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-2 border-b">
          <Input
            placeholder="Search icons..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9"
          />
        </div>
        <ScrollArea className="h-72">
          <div className="grid grid-cols-6 gap-1 p-2">
            {filteredIcons.slice(0, 60).map(iconName => {
              const Icon = LucideIcons[iconName as keyof typeof LucideIcons] as React.ComponentType<{ className?: string }>;
              return (
                <button
                  key={iconName}
                  onClick={() => {
                    onChange(iconName);
                    setOpen(false);
                  }}
                  className="p-2 hover:bg-accent rounded-md transition-colors flex items-center justify-center"
                  title={iconName}
                >
                  <Icon className="h-5 w-5" />
                </button>
              );
            })}
          </div>
        </ScrollArea>
        <div className="p-2 border-t text-xs text-muted-foreground">
          {filteredIcons.length} icons found
        </div>
      </PopoverContent>
    </Popover>
  );
};
