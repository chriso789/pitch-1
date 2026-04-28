import React, { useMemo } from "react";
import type { RoofOverlaySchema, RoofFeatureLine } from "@/types/roofMeasurement";

const colorMap: Record<string, string> = {
  ridge: "#ef4444",
  hip: "#f59e0b",
  valley: "#3b82f6",
  eave: "#22c55e",
  rake: "#a855f7",
};

interface RoofOverlayViewerProps {
  overlay: RoofOverlaySchema | null;
  /** Hide the per-segment length labels. Defaults to false (labels visible). */
  hideLabels?: boolean;
}

function formatFeet(ft: number | undefined | null): string | null {
  if (ft == null || !isFinite(ft) || ft <= 0) return null;
  const wholeFt = Math.floor(ft);
  const inches = Math.round((ft - wholeFt) * 12);
  if (inches === 12) return `${wholeFt + 1}'`;
  return inches === 0 ? `${wholeFt}'` : `${wholeFt}' ${inches}"`;
}

function lineMidpoint(f: RoofFeatureLine): { x: number; y: number; angle: number } {
  const x = (f.p1[0] + f.p2[0]) / 2;
  const y = (f.p1[1] + f.p2[1]) / 2;
  let angle = (Math.atan2(f.p2[1] - f.p1[1], f.p2[0] - f.p1[0]) * 180) / Math.PI;
  // Keep labels right-side-up
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return { x, y, angle };
}

export default function RoofOverlayViewer({ overlay, hideLabels }: RoofOverlayViewerProps) {
  const labels = useMemo(() => {
    if (!overlay?.features) return [];
    return overlay.features
      .map((f) => {
        const text = formatFeet(f.length_ft);
        if (!text) return null;
        const mid = lineMidpoint(f);
        return { ...mid, text, color: colorMap[f.type] || "#fff", type: f.type };
      })
      .filter(Boolean) as Array<{
        x: number;
        y: number;
        angle: number;
        text: string;
        color: string;
        type: string;
      }>;
  }, [overlay]);

  if (!overlay || !overlay.image?.url) {
    return <p className="text-sm text-muted-foreground p-4">No overlay available.</p>;
  }

  const { image, polygon, features } = overlay;
  const fontSize = Math.max(10, Math.round(image.width / 70));

  return (
    <div className="relative w-full aspect-square rounded-lg overflow-hidden border bg-muted">
      <img
        src={image.url}
        alt="Aerial roof imagery"
        className="absolute inset-0 w-full h-full object-cover"
      />
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox={`0 0 ${image.width} ${image.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {polygon?.length > 1 && (
          <polygon
            points={polygon.map(([x, y]) => `${x},${y}`).join(" ")}
            fill="rgba(34,197,94,0.08)"
            stroke="#ffffff"
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
        )}
        {features?.map((f, idx) => (
          <line
            key={`line-${idx}`}
            x1={f.p1[0]}
            y1={f.p1[1]}
            x2={f.p2[0]}
            y2={f.p2[1]}
            stroke={colorMap[f.type] || "#fff"}
            strokeWidth={f.confidence > 0.8 ? 3 : 2}
            strokeDasharray={f.confidence < 0.6 ? "6,3" : undefined}
            strokeLinecap="round"
          />
        ))}
        {!hideLabels &&
          labels.map((l, i) => (
            <g key={`lbl-${i}`} transform={`translate(${l.x} ${l.y}) rotate(${l.angle})`}>
              <rect
                x={-((l.text.length * fontSize) / 3.2)}
                y={-fontSize}
                width={(l.text.length * fontSize) / 1.6}
                height={fontSize * 1.6}
                rx={3}
                fill="rgba(0,0,0,0.65)"
              />
              <text
                x={0}
                y={fontSize / 3}
                textAnchor="middle"
                fontSize={fontSize}
                fontWeight={700}
                fill={l.color}
                style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.6)", strokeWidth: 0.6 }}
              >
                {l.text}
              </text>
            </g>
          ))}
      </svg>
      {/* Legend */}
      <div className="absolute bottom-2 left-2 flex flex-wrap gap-2 bg-background/85 rounded px-2 py-1 text-xs">
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
