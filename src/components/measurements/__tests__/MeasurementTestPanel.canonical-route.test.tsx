import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeasurementTestPanel } from '../MeasurementTestPanel';

const invokeMock = vi.fn();

function roofMeasurementRow() {
  return {
    id: 'measurement-1',
    ai_measurement_job_id: 'ai-job-1',
    property_address: '27.9501, -82.2423',
    target_lat: 27.9501,
    target_lng: -82.2423,
    total_area_adjusted_sqft: 3077,
    total_squares: 30.77,
    predominant_pitch: '6/12',
    total_ridge_length: 42,
    total_hip_length: 96,
    total_valley_length: 38,
    total_eave_length: 188,
    total_rake_length: 76,
    measurement_confidence: 82,
    facet_count: 14,
    footprint_source: 'usa_structures',
    result_state: 'perimeter_only',
    created_by_function: 'start-ai-measurement',
    canonical_measurement_route: true,
    geometry_report_json: {
      route_provenance: {
        created_by_function: 'start-ai-measurement',
        canonical_measurement_route: true,
      },
      phase3_5: { version: 'test', skipped_reason: 'fixture' },
      phase3C: { version: 'test', skipped_reason: 'fixture' },
      phase3D: { version: 'test', skipped_reason: 'fixture' },
      phase3E: { version: 'test', skipped_reason: 'fixture' },
    },
  };
}

function queryBuilder(table: string) {
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => {
      if (table === 'measurement_jobs') {
        return {
          data: {
            id: 'job-1',
            status: 'completed',
            progress_message: 'Measurement complete',
            measurement_id: 'measurement-1',
            ai_measurement_job_id: 'ai-job-1',
          },
          error: null,
        };
      }
      if (table === 'roof_measurements') {
        return { data: roofMeasurementRow(), error: null };
      }
      return { data: null, error: null };
    }),
    then: undefined,
  };
  return builder;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } })),
    },
    functions: {
      invoke: invokeMock,
    },
    from: vi.fn((table: string) => queryBuilder(table)),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/hooks/useEffectiveTenantId', () => ({
  useEffectiveTenantId: () => 'tenant-1',
}));

vi.mock('@/components/AddressAutocomplete', () => ({
  AddressAutocomplete: ({ value, onChange, disabled }: any) => (
    <input
      aria-label="Property Address"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock('../SchematicRoofDiagram', () => ({
  SchematicRoofDiagram: () => <div data-testid="schematic-roof-diagram" />,
}));

vi.mock('../MeasurementReportDialog', () => ({
  default: () => <div data-testid="measurement-report-dialog" />,
}));

describe('MeasurementTestPanel canonical route', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (functionName: string) => {
      if (functionName === 'start-ai-measurement') {
        return {
          data: {
            success: true,
            jobId: 'job-1',
            job_id: 'job-1',
            aiMeasurementJobId: 'ai-job-1',
          },
          error: null,
        };
      }
      if (functionName === 'analyze-image-quality') {
        return { data: { success: false }, error: null };
      }
      return { data: null, error: null };
    });
    vi.stubGlobal('crypto', {
      ...(globalThis.crypto ?? {}),
      randomUUID: () => 'test-run-1',
    });
  });

  it('starts the developer test through start-ai-measurement with canonical provenance inputs', async () => {
    const user = userEvent.setup();
    render(<MeasurementTestPanel />);

    await user.click(screen.getByRole('button', { name: /advanced options/i }));
    await user.type(screen.getByLabelText(/latitude/i), '27.9501');
    await user.type(screen.getByLabelText(/longitude/i), '-82.2423');
    await user.click(screen.getByRole('button', { name: /run measurement test/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'start-ai-measurement',
        expect.objectContaining({
          body: expect.objectContaining({
            measurement_test_run_id: 'test-run-1',
            tenant_id: 'tenant-1',
            user_confirmed_roof_target: true,
            confirmed_roof_center_lat: 27.9501,
            confirmed_roof_center_lng: -82.2423,
            original_geocode_lat: 27.9501,
            original_geocode_lng: -82.2423,
            source_button: 'AI Measurement Developer Test',
          }),
        }),
      );
    });

    expect(invokeMock).not.toHaveBeenCalledWith(
      'analyze-roof-aerial',
      expect.anything(),
    );
  });
});