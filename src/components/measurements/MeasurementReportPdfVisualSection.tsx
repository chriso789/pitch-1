// ============================================================================
// MeasurementReportPdfVisualSection
// ----------------------------------------------------------------------------
// Dedicated PDF-only export root for measurement reports. Rendered off-screen
// inside MeasurementReportDialog and captured by the export pipeline via the
// `[data-pdf-report-root="true"]` selector.
//
// Renders, in this order:
//   1. Header (address, diagnostic/export-only status, failure reason)
//   2. EXACTLY ONE roof-focused aerial overlay panel (RasterOverlayDebugView
//      in pdfMode), marked `[data-pdf-overlay-panel="true"]`
//   3. Compact diagnostic chips
//
// Excludes: Visual QA controls, buttons, edit/approve/reject controls, AI
// Process Viewer, raw JSON, layer toggles, hidden/collapsible panels, full
// debug grid. Backgrounds are forced white so html2canvas cannot produce a
// black/dark export artifact.
//
// Pure display component. Does NOT touch persisted geometry, gates, DSM
// logic, or any backend value.
// ============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import RasterOverlayDebugView from './RasterOverlayDebugView';
import { getRasterOverlayData } from '@/lib/measurements/rasterOverlayData';
import {
  formatDsmSize,
  resolveAerialCandidateEdgeCount,
  resolveDebugRoofLinesCount,
  resolveDsmStatusLabel,
} from '@/lib/measurements/pdfChipFields';
import { fetchAsDataUrl } from '@/lib/measurements/exportImageLoader';

const fmtNum = (v: any): string => {
  if (v == null || v === '' || (typeof v === 'number' && Number.isNaN(v))) {
    return '—';
  }
  const n = Number(v);
  return Number.isNaN(n) ? String(v) : String(n);
};

const Chip: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div
    style={{
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: 4,
      padding: '6px 8px',
    }}
  >
    <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>
      {label}
    </div>
    <div style={{ fontSize: 12, color: '#0f172a', fontFamily: 'monospace', marginTop: 2 }}>
      {value}
    </div>
  </div>
);

export interface MeasurementReportPdfVisualSectionProps {
  measurement: any;
  address?: string;
}

const MeasurementReportPdfVisualSection: React.FC<MeasurementReportPdfVisualSectionProps> = ({
  measurement,
  address,
}) => {
  const grj = measurement?.geometry_report_json || {};
  const {
    rasterUrl,
    rasterSize,
    planes_px,
    edges_px,
    footprint_px,
    focusPerimeterPx,
    hasRasterOverlay,
  } = getRasterOverlayData(measurement);

  // ---- Export-safe aerial: pre-resolve to data: URL so html2canvas can
  // rasterize it even when the upstream host blocks tainted canvas reads.
  const [aerialState, setAerialState] = useState<
    'pending' | 'loaded' | 'failed'
  >(rasterUrl ? 'pending' : 'failed');
  const [aerialDataUrl, setAerialDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!rasterUrl) {
      setAerialState('failed');
      setAerialDataUrl(null);
      return;
    }
    setAerialState('pending');
    fetchAsDataUrl(rasterUrl, { timeoutMs: 5000 }).then((res) => {
      if (cancelled) return;
      if (res.state === 'loaded' && res.dataUrl) {
        setAerialDataUrl(res.dataUrl);
        setAerialState('loaded');
      } else {
        // eslint-disable-next-line no-console
        console.warn('PDF aerial fetch failed', { state: res.state, error: res.error });
        setAerialDataUrl(null);
        setAerialState('failed');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [rasterUrl]);

  const customerReady = measurement?.customer_report_ready === true;
  const resultState: string = String(
    measurement?.result_state ?? grj?.result_state ?? '—',
  );
  const blocker: string | null = grj?.block_customer_report_reason ??
    grj?.hard_fail_reason ??
    measurement?.gate_reason ??
    null;

  // Compact diagnostic chip values — pure resolvers shared with tests.
  const dsmStatus = resolveDsmStatusLabel(grj);
  const dsmSize = formatDsmSize(grj);
  const aerialEdgeCount = resolveAerialCandidateEdgeCount(grj);
  const debugRoofLines = resolveDebugRoofLinesCount(grj);
  const reportableCount = Number(
    grj?.reportable_roof_lines_count ??
      (Array.isArray(grj?.reportable_roof_lines)
        ? grj.reportable_roof_lines.length
        : 0),
  );

  const cpuElapsedMs = Number(
    grj?.cpu_budget_elapsed_ms ?? grj?.cpu?.elapsed_ms ?? NaN,
  );
  const cpuRemainingMs = Number(
    grj?.cpu_budget_remaining_ms ?? grj?.cpu?.remaining_ms ?? NaN,
  );
  const cpuStatus = Number.isFinite(cpuElapsedMs)
    ? `${(cpuElapsedMs / 1000).toFixed(1)}s elapsed${
        Number.isFinite(cpuRemainingMs)
          ? ` / ${(cpuRemainingMs / 1000).toFixed(1)}s left`
          : ''
      }`
    : 'n/a';

  // Overlay SVG (lines/polygon) used when aerial cannot be embedded — keeps
  // diagnostic value of the export even in the placeholder case.
  const overlaySvg = useMemo(() => {
    if (!Array.isArray(focusPerimeterPx) || focusPerimeterPx.length < 3) return null;
    const xs = focusPerimeterPx.map((p) => p[0]);
    const ys = focusPerimeterPx.map((p) => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    // Generous padding so polygon is not flush against the panel edge.
    const pad = Math.max(40, Math.max(maxX - minX, maxY - minY) * 0.3);
    const vb = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
    const pts = focusPerimeterPx.map((p) => `${p[0]},${p[1]}`).join(' ');
    return (
      <svg
        viewBox={vb}
        preserveAspectRatio="xMidYMid meet"
        width="100%"
        height="100%"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
        }}
      >
        <polygon
          points={pts}
          fill="rgba(59,130,246,0.10)"
          stroke="#2563eb"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }, [focusPerimeterPx]);


  const showAerial = hasRasterOverlay && aerialState !== 'failed';

  return (
    <div
      data-pdf-report-root="true"
      className="measurement-report-page"
      style={{
        background: '#ffffff',
        color: '#0f172a',
        padding: 16,
        width: '100%',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
          Measurement Report
        </div>
        {address && (
          <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
            {address}
          </div>
        )}
        {!customerReady && (
          <div
            style={{
              fontSize: 11,
              color: '#dc2626',
              fontWeight: 600,
              marginTop: 4,
            }}
          >
            Diagnostic export only — not customer-ready
          </div>
        )}
        <div
          style={{
            fontSize: 11,
            color: '#475569',
            fontFamily: 'monospace',
            marginTop: 4,
          }}
        >
          result_state: {resultState}
        </div>
        {blocker && (
          <div
            style={{
              fontSize: 11,
              color: '#dc2626',
              fontFamily: 'monospace',
              marginTop: 2,
              wordBreak: 'break-word',
            }}
          >
            blocker: {String(blocker)}
          </div>
        )}
      </div>

      {/* Aerial overlay — exactly one panel */}
      <div style={{ background: '#ffffff', marginBottom: 12 }}>
        {showAerial ? (
          <RasterOverlayDebugView
            pdfMode
            imageUrl={aerialDataUrl ?? rasterUrl}
            rasterSize={rasterSize}
            planes_px={planes_px}
            edges_px={edges_px}
            footprint_px={footprint_px}
            overlayCalibration={grj?.overlay_calibration || null}
            roofTargetBboxPx={grj?.roof_target_bbox_px ||
              grj?.debug_geometry?.solar_bbox_px || null}
            geometryPxSpace={grj?.geometry_px_space || null}
            focusPerimeterPx={focusPerimeterPx as any}
          />
        ) : (
          <div
            data-pdf-overlay-panel="true"
            style={{
              position: 'relative',
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              padding: 0,
              aspectRatio: '4 / 3',
              width: '100%',
              overflow: 'hidden',
            }}
          >
            {overlaySvg}
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                padding: '8px 12px',
                background: 'rgba(255,255,255,0.92)',
                borderTop: '1px solid #e2e8f0',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 12, color: '#0f172a', fontWeight: 600 }}>
                Aerial image unavailable in PDF export
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                Overlay lines are still shown for diagnostic review.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Compact diagnostic chips */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 6,
        }}
      >
        <Chip label="DSM Status" value={dsmStatus} />
        <Chip label="DSM Size" value={dsmSize} />
        <Chip label="Aerial Candidate Graph" value={`${aerialEdgeCount} edges`} />
        <Chip label="Debug Roof Lines" value={fmtNum(debugRoofLines)} />
        <Chip label="Reportable Roof Lines" value={fmtNum(reportableCount)} />
        <Chip label="Customer Ready" value={String(customerReady)} />
        <Chip label="CPU Status" value={cpuStatus} />
      </div>

      {/* Compact debug table — PDF-safe, after the visual. Read-only,
          whitelisted fields only, no buttons, no <pre>, no Raw JSON.
          Never reintroduces the full interactive Measurement Data Summary. */}
      <PdfDebugTable measurement={measurement} />
    </div>
  );
};

const DEBUG_FIELDS: Array<{ label: string; path: (m: any) => any }> = [
  { label: 'result_state', path: (m) => m?.result_state ?? m?.geometry_report_json?.result_state },
  { label: 'geometry_source', path: (m) => m?.geometry_report_json?.geometry_source ?? m?.geometry_source },
  { label: 'pitch_source', path: (m) => m?.geometry_report_json?.pitch_source ?? m?.pitch_source },
  { label: 'facet_count', path: (m) => m?.geometry_report_json?.facet_count ?? m?.facet_count },
  { label: 'ridge_lf', path: (m) => m?.geometry_report_json?.ridge_lf ?? m?.ridge_lf },
  { label: 'hip_lf', path: (m) => m?.geometry_report_json?.hip_lf ?? m?.hip_lf },
  { label: 'valley_lf', path: (m) => m?.geometry_report_json?.valley_lf ?? m?.valley_lf },
  { label: 'eave_lf', path: (m) => m?.geometry_report_json?.eave_lf ?? m?.eave_lf },
  { label: 'rake_lf', path: (m) => m?.geometry_report_json?.rake_lf ?? m?.rake_lf },
  { label: 'coverage', path: (m) => m?.geometry_report_json?.coverage },
  { label: 'validated_faces_pct', path: (m) => m?.geometry_report_json?.validated_faces_pct },
  { label: 'footprint_confidence', path: (m) => m?.geometry_report_json?.footprint_confidence },
  { label: 'area_ratio', path: (m) => m?.geometry_report_json?.area_ratio },
  { label: 'topology_score_vs_vendor', path: (m) => m?.geometry_report_json?.topology_score_vs_vendor },
  { label: 'block_customer_report_reason', path: (m) => m?.geometry_report_json?.block_customer_report_reason },
  { label: 'hard_fail_reason', path: (m) => m?.geometry_report_json?.hard_fail_reason },
];

const PdfDebugTable: React.FC<{ measurement: any }> = ({ measurement }) => {
  const rows = DEBUG_FIELDS
    .map(({ label, path }) => {
      let v: any;
      try { v = path(measurement); } catch { v = undefined; }
      if (v == null || v === '') return null;
      const str = typeof v === 'object' ? JSON.stringify(v) : String(v);
      const truncated = str.length > 80 ? str.slice(0, 77) + '…' : str;
      return { label, value: truncated };
    })
    .filter(Boolean) as Array<{ label: string; value: string }>;

  if (rows.length === 0) return null;
  const limited = rows.slice(0, 20);

  return (
    <div
      data-pdf-debug-table="true"
      style={{
        marginTop: 12,
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 4,
        padding: 8,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: '#64748b',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          marginBottom: 6,
        }}
      >
        Diagnostics
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          rowGap: 2,
          columnGap: 8,
          fontSize: 11,
          fontFamily: 'monospace',
          color: '#0f172a',
        }}
      >
        {limited.map((r) => (
          <React.Fragment key={r.label}>
            <div style={{ color: '#475569' }}>{r.label}</div>
            <div style={{ wordBreak: 'break-word' }}>{r.value}</div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default MeasurementReportPdfVisualSection;
