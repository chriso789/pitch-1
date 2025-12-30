import React from "react";
import { cn } from "@/lib/utils";

interface ActivitySparklineProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  showLabels?: boolean;
}

export const ActivitySparkline: React.FC<ActivitySparklineProps> = ({
  data,
  width = 100,
  height = 24,
  className,
  showLabels = false
}) => {
  if (!data || data.length === 0) {
    return (
      <div 
        className={cn("flex items-center justify-center text-xs text-muted-foreground", className)}
        style={{ width, height }}
      >
        No activity
      </div>
    );
  }

  const max = Math.max(...data, 1);
  const min = 0;
  const range = max - min || 1;
  
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1 || 1)) * (width - 4) + 2;
    const y = height - 2 - ((value - min) / range) * (height - 4);
    return `${x},${y}`;
  }).join(' ');

  // Calculate fill area
  const areaPoints = [
    `2,${height - 2}`,
    ...data.map((value, index) => {
      const x = (index / (data.length - 1 || 1)) * (width - 4) + 2;
      const y = height - 2 - ((value - min) / range) * (height - 4);
      return `${x},${y}`;
    }),
    `${width - 2},${height - 2}`
  ].join(' ');

  const totalActivity = data.reduce((sum, val) => sum + val, 0);
  const avgActivity = Math.round(totalActivity / data.length);

  return (
    <div className={cn("relative", className)}>
      <svg width={width} height={height} className="overflow-visible">
        {/* Gradient fill */}
        <defs>
          <linearGradient id="sparkline-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        
        {/* Area fill */}
        <polygon
          points={areaPoints}
          fill="url(#sparkline-gradient)"
        />
        
        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* End dot */}
        {data.length > 0 && (
          <circle
            cx={(width - 4) + 2}
            cy={height - 2 - ((data[data.length - 1] - min) / range) * (height - 4)}
            r="2"
            fill="hsl(var(--primary))"
          />
        )}
      </svg>
      
      {showLabels && (
        <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
          <span>30d ago</span>
          <span>Today</span>
        </div>
      )}
    </div>
  );
};
