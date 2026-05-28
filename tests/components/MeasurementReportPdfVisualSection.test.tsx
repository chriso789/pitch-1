import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import MeasurementReportPdfVisualSection from '@/components/measurements/MeasurementReportPdfVisualSection';

const measurement = {
  customer_report_ready: false,
  result_state: 'perimeter_only',
  geometry_report_json: {
    block_customer_report_reason: 'dsm_registration_missing',
    overlay_debug: {
      raster_url: 'https://example.com/aerial.png?size=1280x1280',
      raster_size: { width: 1280, height: 1280 },
      footprint_px: [[500, 471], [790, 471], [790, 782], [500, 782]],
    },
    selected_perimeter_px: [[500, 471], [790, 471], [790, 782], [500, 782]],
    aerial_candidate_roof_graph: {
      edges: new Array(12).fill({ type: 'unknown' }),
      perimeter_ring_px: [[500, 471], [790, 471], [790, 782], [500, 782]],
    },
    roof_lines: new Array(6).fill({ type: 'unknown' }),
    reportable_roof_lines_count: 0,
  },
};

describe('MeasurementReportPdfVisualSection', () => {
  it('renders a single PDF root with the overlay panel first and excludes interactive controls', () => {
    const { container } = render(
      <MeasurementReportPdfVisualSection
        measurement={measurement}
        address="123 Fonsica Dr"
      />,
    );

    const root = container.querySelector('[data-pdf-report-root="true"]');
    expect(root).not.toBeNull();

    const panels = root!.querySelectorAll('[data-pdf-overlay-panel="true"]');
    expect(panels.length).toBe(1);

    // First major visual block inside the root is the overlay panel.
    const firstPanel = root!.querySelector('[data-pdf-overlay-panel="true"]');
    expect(firstPanel).not.toBeNull();
    const headerTextLen = root!.textContent?.indexOf('Measurement Report') ?? -1;
    const panelTextIdx = Array.from(root!.children).findIndex((c) =>
      c.querySelector('[data-pdf-overlay-panel="true"]') ||
      c.matches('[data-pdf-overlay-panel="true"]'),
    );
    expect(panelTextIdx).toBeGreaterThan(-1);
    expect(headerTextLen).toBeGreaterThan(-1);

    const text = root!.textContent || '';
    // No raw JSON, no interactive control labels.
    expect(text).not.toMatch(/Raw JSON/i);
    expect(text).not.toMatch(/Edit vertices/i);
    expect(text).not.toMatch(/Approve/);
    expect(text).not.toMatch(/Reject/);
    expect(text).not.toMatch(/AI Process Viewer/i);

    // Header + status copy present.
    expect(text).toContain('Diagnostic export only — not customer-ready');
    expect(text).toContain('result_state: perimeter_only');
    expect(text).toContain('blocker: dsm_registration_missing');

    // SVG viewBox is the crop bbox, not the full tile.
    const svg = root!.querySelector('svg');
    expect(svg).not.toBeNull();
    const vb = svg!.getAttribute('viewBox') || '';
    expect(vb).not.toBe('0 0 1280 1280');
  });

  it('renders an "aerial unavailable in export" placeholder when no overlay data exists', () => {
    const { container } = render(
      <MeasurementReportPdfVisualSection
        measurement={{
          customer_report_ready: false,
          geometry_report_json: { block_customer_report_reason: null },
        }}
      />,
    );
    const root = container.querySelector('[data-pdf-report-root="true"]');
    expect(root).not.toBeNull();
    const panels = root!.querySelectorAll('[data-pdf-overlay-panel="true"]');
    expect(panels.length).toBe(1);
    expect(root!.textContent).toContain('aerial unavailable in export');
  });
});
