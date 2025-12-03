import { Navigation } from 'lucide-react';

interface GPSAcquiringOverlayProps {
  message?: string;
}

export default function GPSAcquiringOverlay({ message = 'Acquiring precise location...' }: GPSAcquiringOverlayProps) {
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
      <div className="bg-background/95 backdrop-blur-sm border rounded-full px-4 py-2 shadow-lg flex items-center gap-2">
        <div className="relative">
          <Navigation className="h-4 w-4 text-primary animate-pulse" />
          <div className="absolute inset-0 animate-ping">
            <Navigation className="h-4 w-4 text-primary opacity-50" />
          </div>
        </div>
        <span className="text-sm font-medium">{message}</span>
      </div>
    </div>
  );
}
