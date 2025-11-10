import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Trash2, Image as ImageIcon, TrendingUp, Database, Clock, Download, FileJson, FileSpreadsheet } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow, format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import Papa from "papaparse";

interface CacheEntry {
  url: string;
  lastAccessed: number;
  size: number;
}

interface CacheStats {
  currentSize: number;
  maxSize: number;
  totalMemoryBytes: number;
  totalMemoryMB: string;
  entries: CacheEntry[];
  hits: number;
  misses: number;
  evictions: number;
  hitRate: string;
  totalRequests: number;
}

interface ImageCacheStatisticsProps {
  cacheStats: CacheStats;
  onClearCache: () => void;
}

export function ImageCacheStatistics({ cacheStats, onClearCache }: ImageCacheStatisticsProps) {
  const cacheUsagePercent = (cacheStats.currentSize / cacheStats.maxSize) * 100;

  const getShortUrl = (url: string) => {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      return path.split('/').pop() || url.substring(0, 40) + '...';
    } catch {
      return url.substring(0, 40) + '...';
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const exportToJSON = () => {
    const exportData = {
      exportDate: new Date().toISOString(),
      summary: {
        currentSize: cacheStats.currentSize,
        maxSize: cacheStats.maxSize,
        totalMemoryBytes: cacheStats.totalMemoryBytes,
        totalMemoryMB: cacheStats.totalMemoryMB,
        hitRate: `${cacheStats.hitRate}%`,
        totalHits: cacheStats.hits,
        totalMisses: cacheStats.misses,
        totalEvictions: cacheStats.evictions,
        totalRequests: cacheStats.totalRequests,
      },
      cachedImages: cacheStats.entries.map((entry, index) => ({
        rank: index + 1,
        url: entry.url,
        lastAccessedTimestamp: entry.lastAccessed,
        lastAccessedDate: format(entry.lastAccessed, 'yyyy-MM-dd HH:mm:ss'),
        sizeBytes: entry.size,
        sizeMB: (entry.size / (1024 * 1024)).toFixed(2),
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cache-statistics-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Cache statistics exported to JSON');
  };

  const exportToCSV = () => {
    const csvData = [
      {
        'Metric': 'Export Date',
        'Value': format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
      },
      {
        'Metric': 'Current Cache Size',
        'Value': `${cacheStats.currentSize} images`,
      },
      {
        'Metric': 'Max Cache Size',
        'Value': `${cacheStats.maxSize} images`,
      },
      {
        'Metric': 'Total Memory Used',
        'Value': `${cacheStats.totalMemoryMB} MB`,
      },
      {
        'Metric': 'Cache Hit Rate',
        'Value': `${cacheStats.hitRate}%`,
      },
      {
        'Metric': 'Total Hits',
        'Value': cacheStats.hits,
      },
      {
        'Metric': 'Total Misses',
        'Value': cacheStats.misses,
      },
      {
        'Metric': 'Total Evictions',
        'Value': cacheStats.evictions,
      },
      {
        'Metric': 'Total Requests',
        'Value': cacheStats.totalRequests,
      },
      { 'Metric': '', 'Value': '' }, // Empty row
      { 'Metric': 'CACHED IMAGES', 'Value': '' },
    ];

    // Add cached images data
    const imageRows = cacheStats.entries.map((entry, index) => ({
      'Rank': index + 1,
      'URL': entry.url,
      'Last Accessed': format(entry.lastAccessed, 'yyyy-MM-dd HH:mm:ss'),
      'Size (Bytes)': entry.size,
      'Size (MB)': (entry.size / (1024 * 1024)).toFixed(2),
    }));

    const csv = Papa.unparse({
      fields: ['Metric', 'Value'],
      data: csvData,
    }) + '\n\n' + Papa.unparse(imageRows);

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cache-statistics-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Cache statistics exported to CSV');
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Satellite Image Cache
            </CardTitle>
            <CardDescription>
              Performance statistics for cached satellite imagery
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={cacheStats.totalRequests === 0}>
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportToJSON}>
                  <FileJson className="h-4 w-4 mr-2" />
                  Export as JSON
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportToCSV}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Export as CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={cacheStats.currentSize === 0}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear Cache
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear Image Cache?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove all {cacheStats.currentSize} cached images ({cacheStats.totalMemoryMB} MB).
                    Images will need to be re-downloaded when accessed again.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onClearCache}>Clear Cache</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Cache Usage */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Cache Usage</span>
            <span className="font-medium">
              {cacheStats.currentSize} / {cacheStats.maxSize} images
            </span>
          </div>
          <Progress value={cacheUsagePercent} className="h-2" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{cacheStats.totalMemoryMB} MB used</span>
            <span>{cacheUsagePercent.toFixed(0)}% full</span>
          </div>
        </div>

        {/* Performance Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3" />
              Hit Rate
            </div>
            <div className="text-2xl font-bold text-primary">
              {cacheStats.hitRate}%
            </div>
            <div className="text-xs text-muted-foreground">
              {cacheStats.hits} hits
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ImageIcon className="h-3 w-3" />
              Total Requests
            </div>
            <div className="text-2xl font-bold">
              {cacheStats.totalRequests}
            </div>
            <div className="text-xs text-muted-foreground">
              {cacheStats.misses} misses
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Trash2 className="h-3 w-3" />
              Evictions
            </div>
            <div className="text-2xl font-bold text-destructive">
              {cacheStats.evictions}
            </div>
            <div className="text-xs text-muted-foreground">
              LRU evicted
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Database className="h-3 w-3" />
              Avg Size
            </div>
            <div className="text-2xl font-bold">
              {cacheStats.currentSize > 0
                ? formatBytes(cacheStats.totalMemoryBytes / cacheStats.currentSize)
                : '0 B'}
            </div>
            <div className="text-xs text-muted-foreground">
              per image
            </div>
          </div>
        </div>

        {/* Cached Images List */}
        {cacheStats.entries.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Cached Images</h4>
              <Badge variant="secondary">{cacheStats.entries.length} images</Badge>
            </div>
            <ScrollArea className="h-[300px] rounded-md border">
              <div className="p-4 space-y-2">
                {cacheStats.entries.map((entry, index) => (
                  <div
                    key={entry.url}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Badge variant="outline" className="shrink-0">
                        #{index + 1}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {getShortUrl(entry.url)}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(entry.lastAccessed, { addSuffix: true })}
                        </div>
                      </div>
                    </div>
                    <Badge variant="secondary" className="shrink-0 ml-2">
                      {formatBytes(entry.size)}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Empty State */}
        {cacheStats.entries.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No images cached yet</p>
            <p className="text-xs mt-1">
              View property measurements to cache satellite images
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
