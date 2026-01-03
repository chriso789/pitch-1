/**
 * Session Breadcrumbs
 * Visual page flow showing navigation path during a session
 */

import { ChevronRight, Globe } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

interface SessionBreadcrumbsProps {
  paths: string[];
}

const getPageLabel = (path: string): string => {
  // Remove leading slash and clean up
  const cleanPath = path.replace(/^\//, '').replace(/\//g, ' / ');
  
  if (!cleanPath) return 'Home';
  
  // Capitalize and format
  return cleanPath
    .split(' / ')
    .map(segment => {
      // Handle UUIDs and IDs
      if (/^[0-9a-f-]{36}$/.test(segment)) return '...'
      if (/^\d+$/.test(segment)) return `#${segment}`;
      // Capitalize
      return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
    })
    .join(' / ');
};

export function SessionBreadcrumbs({ paths }: SessionBreadcrumbsProps) {
  if (paths.length === 0) return null;

  return (
    <div className="bg-muted/50 rounded-lg p-3 border">
      <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
        <Globe className="h-3.5 w-3.5" />
        <span>Page Navigation Flow</span>
      </div>
      
      <ScrollArea className="w-full">
        <div className="flex items-center gap-1 pb-2">
          {paths.map((path, index) => (
            <div key={index} className="flex items-center">
              <Badge
                variant="secondary"
                className="whitespace-nowrap text-xs font-normal"
              >
                {getPageLabel(path)}
              </Badge>
              {index < paths.length - 1 && (
                <ChevronRight className="h-4 w-4 mx-1 text-muted-foreground flex-shrink-0" />
              )}
            </div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
