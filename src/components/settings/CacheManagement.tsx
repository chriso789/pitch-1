import { useState, useEffect } from "react";
import { ImageCacheStatistics } from "./ImageCacheStatistics";
import { useImageCache } from "@/contexts/ImageCacheContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export function CacheManagement() {
  const imageCache = useImageCache();
  const [stats, setStats] = useState(imageCache.getCacheStats());

  const refreshStats = () => {
    setStats(imageCache.getCacheStats());
  };

  const handleClearCache = () => {
    imageCache.clearCache();
    refreshStats();
    toast.success("Cache cleared successfully");
  };

  // Auto-refresh stats every 5 seconds
  useEffect(() => {
    const interval = setInterval(refreshStats, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Cache Management</h2>
          <p className="text-muted-foreground">
            Monitor and manage satellite image caching performance
          </p>
        </div>
        <Button onClick={refreshStats} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh Stats
        </Button>
      </div>

      <ImageCacheStatistics cacheStats={stats} onClearCache={handleClearCache} />
    </div>
  );
}
