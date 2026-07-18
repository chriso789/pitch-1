import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MeasurementTestResults } from '../MeasurementTestResults';

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
  it('auto-runs the quick roof trace on blocked rows and uses persisted target imagery', async () => {
    invokeMock.mockResolvedValue({
      data: {
        image: { url: 'https://example.test/fonsica.png', width: 1280, height: 1280, zoom: 20, source: 'google_static_maps' },
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
          google_maps_image_url: 'https://example.test/fonsica.png',
          footprint_source: 'google_maps_imagery',
        },
        error: null,
      }),
    });

    render(<MeasurementTestResults result={blockedFonsicaResult as any} />);

    expect(screen.getByText('Quick roof trace')).toBeInTheDocument();
    expect(screen.getByText(/Measurement Blocked/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('vision-trace-roof', {
        body: expect.objectContaining({
          lat: 27.08965,
          lng: -82.17824,
          zoom: 20,
          size: 640,
          image_url: 'https://example.test/fonsica.png',
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/1 segments/i)).toBeInTheDocument();
    });
  });
});