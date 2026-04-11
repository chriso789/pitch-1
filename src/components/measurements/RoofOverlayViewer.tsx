import React from 'react';
import type { RoofOverlaySchema } from '@/types/roofMeasurement';

const colorMap: Record<string, string> = {
  ridge: "#ef4444",
  hip: "#f59e0b",
  valley: "#3b82f6",
  eave: "#22c55e",
  rake: "#a855f7",
};

interface RoofOverlayViewerProps {
  overlay: RoofOverlaySchema | null;
}

export default function RoofOverlayViewer({ overlay }: RoofOverlayViewerProps) {
  if (!overlay || !overlay.image?.url) {
    return <p className="text-sm text-muted-foreground p-4">No overlay available.</p>;
  }

  const { image, polygon, features } = overlay;

  return (
    <div className="relative w-full aspect-video rounded-lg overflow-hidden border bg-muted">
      <img
        src={image.url}
        alt="Satellite"
        className="absolute inset-0 w-full h-full object-cover"
      />
      <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${image.width} ${image.height}`}>
        {polygon?.length > 1 && (
          <polygon
            points={polygon.map(([x, y]) => `${x},${y}`).join(" ")}
            fill="rgba(34,197,94,0.10)"
            stroke="#22c55e"
            strokeWidth={2}
          />
        )}
        {features?.map((f, idx) => (
          <line
            key={idx}
            x1={f.p1[0]}
            y1={f.p1[1]}
            x2={f.p2[0]}
            y2={f.p2[1]}
            stroke={colorMap[f.type] || "#fff"}
            strokeWidth={f.confidence > 0.8 ? 3 : 2}
            strokeDasharray={f.confidence < 0.6 ? "6,3" : undefined}
          />
        ))}
      </svg>
      {/* Legend */}
      <div className="absolute bottom-2 left-2 flex gap-2 bg-background/80 rounded px-2 py-1 text-xs">
        {Object.entries(colorMap).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5" style={{ backgroundColor: color }} />
            <span className="capitalize">{type}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
