import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MeasurementTestResults } from '../MeasurementTestResults';
import { normalizeVisionTraceImageSize } from '../VisionTracePanel';

const { invokeMock, fromMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: invokeMock },
    from: fromMock,
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../SchematicRoofDiagram', () => ({
  SchematicRoofDiagram: () => <div data-testid="schematic-roof-diagram" />,
}));

vi.mock('../MeasurementReportDialog', () => ({
  default: () => <div data-testid="measurement-report-dialog" />,
}));

const blockedFonsicaResult = {
  measurementId: 'measurement-fonsica-1',
  resultState: 'ai_failed_source_acquisition',
  hardFailReason: 'dsm_bounds_missing',
  customerReportReady: false,
  timing: { totalMs: 115387 },
  data: {
    address: '4063 Fonsica Ave, North Port, FL 34286, USA',
    coordinates: { lat: 27.08965, lng: -82.17824 },
    measurements: {
      totalAreaSqft: 0,
      totalSquares: 0,
      predominantPitch: 'unknown',
      linear: { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0 },
    },
    aiAnalysis: { roofType: 'unknown', complexity: 'unknown', facetCount: 0 },
    confidence: { score: 0, factors: [] },
    solarApiData: { available: false, buildingFootprint: 0 },
    images: { selected: 'google_maps_imagery' },
  },
} as const;

describe('MeasurementTestResults quick trace fallback', () => {
  it('normalizes logical static-map metadata to raster pixels before tracing', () => {
    expect(normalizeVisionTraceImageSize({ width: 640, height: 640, rasterScale: 2 })).toEqual(
      expect.objectContaining({ width: 1280, height: 1280, logicalWidth: 640, logicalHeight: 640, rasterScale: 2 }),
    );
  });

  it('auto-runs the quick roof trace on blocked rows using a fresh roof-centered zoom-21 tile', async () => {
    invokeMock.mockResolvedValue({
      data: {
        image: { url: 'https://example.test/fresh-fonsica.png', width: 640, height: 640, zoom: 21, source: 'google_solar_centered_static_maps' },
        segments: [{ type: 'eave', points: [[100, 100], [300, 100]], confidence: 0.9 }],
        count: 1,
        model: 'test-vision-model',
        durationMs: 42,
      },
      error: null,
    });

    fromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'measurement-fonsica-1',
          result_state: 'ai_failed_source_acquisition',
          hard_fail_reason: 'dsm_bounds_missing',
          customer_report_ready: false,
          property_address: blockedFonsicaResult.data.address,
          target_lat: 27.08965,
          target_lng: -82.17824,
          analysis_zoom: 20,
          analysis_image_size: { width: 1280, height: 1280, logicalWidth: 640, logicalHeight: 640, rasterScale: 2 },
          google_maps_image_url: 'https://example.test/fonsica.png',
          footprint_source: 'google_maps_imagery',
        },
        error: null,
      }),
    });

    render(<MeasurementTestResults result={blockedFonsicaResult as any} />);

    expect(await screen.findByText('Quick roof trace')).toBeTruthy();
    expect(screen.getByText(/Measurement Blocked/i)).toBeTruthy();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('vision-trace-roof', {
        body: expect.objectContaining({
          lat: 27.08965,
          lng: -82.17824,
          size: 640,
          image_url: undefined,
          address: blockedFonsicaResult.data.address,
          prefer_roof_center: true,
          image_size: undefined,
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/1 segments/i)).toBeTruthy();
    });
  });
});