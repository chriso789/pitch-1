import { ScrollArea } from '@/components/ui/scroll-area';
import type { PdfEnginePage } from '@/lib/pdf-engine/engineTypes';

interface PdfPageSidebarProps {
  pages: PdfEnginePage[];
  activePage: number;
  onSelectPage: (page: number) => void;
  thumbnailUrls: Map<number, string>;
}

export function PdfPageSidebar({ pages, activePage, onSelectPage, thumbnailUrls }: PdfPageSidebarProps) {
  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-2">
        {pages.map(page => {
          const thumbUrl = thumbnailUrls.get(page.page_number);
          const isActive = page.page_number === activePage;
          return (
            <button
              key={page.id}
              onClick={() => onSelectPage(page.page_number)}
              className={`w-full rounded border-2 transition-colors ${
                isActive ? 'border-primary' : 'border-transparent hover:border-muted-foreground/30'
              }`}
            >
              {thumbUrl ? (
                <img src={thumbUrl} alt={`Page ${page.page_number}`} className="w-full rounded" />
              ) : (
                <div className="w-full aspect-[8.5/11] bg-muted flex items-center justify-center text-xs text-muted-foreground rounded">
                  {page.page_number}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground text-center py-0.5">{page.page_number}</p>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
