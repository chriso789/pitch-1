/**
 * PITCH PDF Page Thumbnails Strip
 * Shows all pages as clickable thumbnails for navigation.
 */

import { cn } from '@/lib/utils';
import type { PdfPageMeta } from '@/lib/pdf-engine/types';

interface PageThumbnailStripProps {
  pages: PdfPageMeta[];
  activePage: number;
  onSelectPage: (pageNumber: number) => void;
  thumbnailUrls: Map<number, string>;
}

export function PageThumbnailStrip({ pages, activePage, onSelectPage, thumbnailUrls }: PageThumbnailStripProps) {
  return (
    <div className="flex flex-col gap-2 p-2 overflow-y-auto">
      {pages.map((page) => (
        <button
          key={page.page_number}
          onClick={() => onSelectPage(page.page_number)}
          className={cn(
            "relative border-2 rounded transition-colors cursor-pointer",
            activePage === page.page_number
              ? "border-primary ring-2 ring-primary/30"
              : "border-border hover:border-primary/50"
          )}
        >
          {thumbnailUrls.has(page.page_number) ? (
            <img
              src={thumbnailUrls.get(page.page_number)}
              alt={`Page ${page.page_number}`}
              className="w-24 h-auto rounded-sm"
            />
          ) : (
            <div className="w-24 h-32 bg-muted flex items-center justify-center text-xs text-muted-foreground">
              {page.page_number}
            </div>
          )}
          <span className="absolute bottom-0.5 right-1 text-[10px] bg-background/80 px-1 rounded">
            {page.page_number}
          </span>
        </button>
      ))}
    </div>
  );
}
