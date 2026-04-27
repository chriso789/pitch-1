/**
 * 6-page patent-aligned roof report (US 9,514,568 / US 8,670,961 Fig. 5A-5F).
 *
 * Pages, in order:
 *   1. Overview        - aerial image with property label
 *   2. Length Diagram  - perimeter + structural lines with foot labels
 *   3. Pitch Diagram   - per-plane pitch annotations (inches per foot)
 *   4. Area Diagram    - per-plane area + total
 *   5. Perimeter Table - tabulated lengths per plane (US9329749 user-editable)
 *   6. Notes           - free-form notes + Quick-Square summary (US9183538)
 *
 * Interactivity (patent claims):
 *   - Length fields on page 5 are editable (US9329749 area-only override)
 *   - Pitch values on page 3 are editable via PitchDeterminationMarker
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { applyLengthOverride, recalcModelTotals } from "@/lib/measurements/patentAreaEngine";
import { slopeFactor } from "@/lib/measurements/slopeFactor";
import { detectImageryAbnormalities } from "@/lib/measurements/imageryQc";
import type { PatentRoofModel } from "@/types/roofMeasurementPatent";

const COLOR: Record<string, string> = {
  perimeter: "hsl(var(--foreground))",
  ridge: "hsl(0 84% 60%)",
  hip: "hsl(38 92% 50%)",
  valley: "hsl(217 91% 60%)",
  eave: "hsl(142 71% 45%)",
  rake: "hsl(271 76% 60%)",
};

interface Props {
  initialModel: PatentRoofModel;
  address?: string;
  onChange?: (model: PatentRoofModel) => void;
}

export default function PatentRoofReport({ initialModel, address, onChange }: Props) {
  const [model, setModel] = useState<PatentRoofModel>(initialModel);

  const update = (next: PatentRoofModel) => {
    setModel(next);
    onChange?.(next);
  };

  const handleLengthOverride = (id: string, value: string) => {
    const n = value.trim() === "" ? null : Number(value);
    if (n != null && (!Number.isFinite(n) || n <= 0)) return;
    update(applyLengthOverride(model, id, n));
  };

  const handlePitchChange = (label: string, pitch: number) => {
    if (!Number.isFinite(pitch) || pitch < 0) return;
    const planes = model.planes.map((p) =>
      p.label === label
        ? { ...p, pitch, roof_area_sqft: p.plan_area_sqft * slopeFactor(pitch) }
        : p,
    );
    update(recalcModelTotals({ ...model, planes }));
  };

  return (
    <div className="space-y-6">
      <Page1Overview model={model} address={address} />
      <Page2Length model={model} />
      <Page3Pitch model={model} onPitchChange={handlePitchChange} />
      <Page4Area model={model} />
      <Page5Perimeter model={model} onOverride={handleLengthOverride} />
      <Page6Notes model={model} />
    </div>
  );
}

/* ---------- Pages ---------- */

function PageHeader({ n, title, address }: { n: number; title: string; address?: string }) {
  return (
    <div className="flex items-center justify-between border-b pb-2 mb-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {address && <p className="text-sm text-muted-foreground">{address}</p>}
      </div>
      <Badge variant="outline">Page {n} of 6</Badge>
    </div>
  );
}

function Page1Overview({ model, address }: { model: PatentRoofModel; address?: string }) {
  return (
    <Card className="p-6">
      <PageHeader n={1} title="Overview" address={address} />
      {model.image.url ? (
        <img
          src={model.image.url}
          alt="Roof overview"
          className="w-full max-h-[600px] object-contain rounded border"
        />
      ) : (
        <p className="text-muted-foreground">No imagery available.</p>
      )}
    </Card>
  );
}

function ModelSvg({ model, showLengths = false }: { model: PatentRoofModel; showLengths?: boolean }) {
  const { width, height } = model.image;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto bg-muted/30 rounded border">
      {model.image.url && (
        <image href={model.image.url} x={0} y={0} width={width} height={height} opacity={0.55} />
      )}
      {/* Layer 1 perimeter */}
      {model.layer1_perimeter.map((p) => (
        <g key={p.id}>
          <polyline
            points={p.points.map(([x, y]) => `${x},${y}`).join(" ")}
            fill="none"
            stroke={COLOR.perimeter}
            strokeWidth={2}
          />
          {showLengths && (
            <text
              x={(p.points[0][0] + p.points[1][0]) / 2}
              y={(p.points[0][1] + p.points[1][1]) / 2}
              fill="hsl(var(--foreground))"
              fontSize={11}
              textAnchor="middle"
              className="font-mono"
            >
              {p.length_ft.toFixed(1)} ft
            </text>
          )}
        </g>
      ))}
      {/* Layer 2 structural */}
      {model.layer2_structural.map((s) => (
        <line
          key={s.id}
          x1={s.points[0][0]}
          y1={s.points[0][1]}
          x2={s.points[1][0]}
          y2={s.points[1][1]}
          stroke={COLOR[s.type]}
          strokeWidth={s.overlapsLayer1Id ? 3 : 2}
          strokeDasharray={s.confidence < 0.6 ? "5,3" : undefined}
        />
      ))}
    </svg>
  );
}

function Page2Length({ model }: { model: PatentRoofModel }) {
  return (
    <Card className="p-6">
      <PageHeader n={2} title="Length Diagram" />
      <p className="text-xs text-muted-foreground mb-2">
        All measurements rounded to the nearest foot.
      </p>
      <ModelSvg model={model} showLengths />
    </Card>
  );
}

function Page3Pitch({
  model,
  onPitchChange,
}: {
  model: PatentRoofModel;
  onPitchChange: (label: string, pitch: number) => void;
}) {
  return (
    <Card className="p-6">
      <PageHeader n={3} title="Pitch Diagram" />
      <p className="text-xs text-muted-foreground mb-2">Pitch units are inches per foot.</p>
      <ModelSvg model={model} />
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        {model.planes.map((p) => (
          <div key={p.label} className="flex items-center gap-2">
            <span className="text-sm font-medium w-16">Plane {p.label}</span>
            <Input
              type="number"
              min={0}
              max={24}
              step={1}
              value={p.pitch}
              onChange={(e) => onPitchChange(p.label, Number(e.target.value))}
              className="h-8"
            />
            <span className="text-xs text-muted-foreground">/12</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Page4Area({ model }: { model: PatentRoofModel }) {
  return (
    <Card className="p-6">
      <PageHeader n={4} title="Area Diagram" />
      <p className="text-sm font-medium mb-3">
        Total Area = {model.totals.roof_area_sqft.toFixed(0)} sqft
      </p>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1">Plane</th>
            <th>Pitch</th>
            <th>Slope Factor</th>
            <th>Plan Area</th>
            <th>Roof Area</th>
          </tr>
        </thead>
        <tbody>
          {model.planes.map((p) => (
            <tr key={p.label} className="border-t">
              <td className="py-1.5">{p.label}</td>
              <td>{p.pitch}/12</td>
              <td className="font-mono">{slopeFactor(p.pitch).toFixed(4)}</td>
              <td>{p.plan_area_sqft.toFixed(0)} sqft</td>
              <td className="font-medium">{p.roof_area_sqft.toFixed(0)} sqft</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Page5Perimeter({
  model,
  onOverride,
}: {
  model: PatentRoofModel;
  onOverride: (id: string, value: string) => void;
}) {
  return (
    <Card className="p-6">
      <PageHeader n={5} title="Perimeter Table" />
      <p className="text-xs text-muted-foreground mb-3">
        Edit a length value to override the computed measurement. Area
        recalculates automatically (US 9,329,749).
      </p>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1">Plane</th>
            <th>Computed (ft)</th>
            <th>Override (ft)</th>
            <th>Effective</th>
          </tr>
        </thead>
        <tbody>
          {model.layer1_perimeter.map((p) => {
            const eff = p.user_length_ft_override ?? p.length_ft;
            return (
              <tr key={p.id} className="border-t">
                <td className="py-1.5">{p.plane}</td>
                <td className="font-mono">{p.length_ft.toFixed(2)}</td>
                <td>
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    placeholder="—"
                    defaultValue={p.user_length_ft_override ?? ""}
                    onBlur={(e) => onOverride(p.id, e.target.value)}
                    className="h-8 w-28"
                  />
                </td>
                <td className="font-medium">{eff.toFixed(2)} ft</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function Page6Notes({ model }: { model: PatentRoofModel }) {
  const qcBadge = useMemo(() => {
    if (model.imagery_qc.reshoot_requested) {
      return <Badge variant="destructive">Imagery re-shoot recommended</Badge>;
    }
    return <Badge variant="secondary">Imagery QC passed</Badge>;
  }, [model.imagery_qc]);

  return (
    <Card className="p-6">
      <PageHeader n={6} title="Notes & Summary" />
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2">{qcBadge}</div>
        <div className="grid grid-cols-2 gap-2">
          <div>Footprint:</div>
          <div className="font-mono">{model.totals.footprint_sqft.toFixed(0)} sqft</div>
          <div>Predominant pitch:</div>
          <div className="font-mono">{model.totals.predominant_pitch}/12</div>
          <div>Slope factor:</div>
          <div className="font-mono">{model.totals.slope_factor.toFixed(4)}</div>
          <div>Total roof area:</div>
          <div className="font-mono">{model.totals.roof_area_sqft.toFixed(0)} sqft</div>
          <div>Roofing squares:</div>
          <div className="font-mono">{model.totals.roofing_squares.toFixed(2)} sq</div>
        </div>
        {model.imagery_qc.abnormalities.length > 0 && (
          <div className="text-destructive">
            Abnormalities: {model.imagery_qc.abnormalities.join(", ")}
          </div>
        )}
        <p className="text-xs text-muted-foreground pt-2 border-t">
          Calculations per US 9,183,538 (Quick-Square) and US 9,329,749 (length
          override). Two-layer rendering per US 8,515,125 / US 9,244,589.
        </p>
      </div>
    </Card>
  );
}
