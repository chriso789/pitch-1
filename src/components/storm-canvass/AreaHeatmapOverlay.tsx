/// <reference types="@types/google.maps" />
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface AreaHeatmapOverlayProps {
  map: google.maps.Map;
  tenantId: string;
  areaId: string;
}

export default function AreaHeatmapOverlay({ map, tenantId, areaId }: AreaHeatmapOverlayProps) {
  const circlesRef = useRef<google.maps.Circle[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase
        .from("canvass_area_heat_cells" as any)
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("area_id", areaId);

      if (cancelled || !data?.length) return;

      // Clear previous
      circlesRef.current.forEach(c => c.setMap(null));
      circlesRef.current = [];

      for (const cell of data as any[]) {
        const pct = cell.total_properties > 0
          ? cell.contacted_properties / cell.total_properties
          : 0;

        // Green = fully contacted, Red = mostly uncontacted
        const r = Math.round(220 * (1 - pct));
        const g = Math.round(180 * pct);
        const color = `rgb(${r}, ${g}, 40)`;

        const circle = new google.maps.Circle({
          center: { lat: cell.center_lat, lng: cell.center_lng },
          radius: 250, // ~250m radius per cell
          fillColor: color,
          fillOpacity: 0.35,
          strokeColor: color,
          strokeWeight: 1,
          strokeOpacity: 0.5,
          map,
          clickable: false,
        });

        circlesRef.current.push(circle);
      }
    };

    load();

    return () => {
      cancelled = true;
      circlesRef.current.forEach(c => c.setMap(null));
      circlesRef.current = [];
    };
  }, [map, tenantId, areaId]);

  // Hide at high zoom (individual pins visible)
  useEffect(() => {
    const listener = map.addListener("zoom_changed", () => {
      const zoom = map.getZoom() || 14;
      const visible = zoom < 16;
      circlesRef.current.forEach(c => c.setVisible(visible));
    });

    return () => google.maps.event.removeListener(listener);
  }, [map]);

  return null;
}
