import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MeasurementReportPdfVisualSection from "../MeasurementReportPdfVisualSection";

const measurement = {
  customer_report_ready: false,
  result_state: "perimeter_only",
  geometry_report_json: {
    address: "1 Test Way",
    raster_url: null, // forces aerial-unavailable placeholder
    overlay_transform: {
      coord_space: "raster_px",
      source_raster_px: { width: 1280, height: 1280 },
      crop_bbox_px: { minX: 500, minY: 471, maxX: 790, maxY: 782 },
    },
    selected_perimeter_px: [
      [600, 500],
      [780, 500],
      [780, 760],
      [600, 760],
    ],
    user_confirmed_roof_target: true,
  },
};

describe("MeasurementReportPdfVisualSection — PDF root contract", () => {
  it("exposes exactly one PDF report root and one overlay panel", () => {
    const { container } = render(
      <MeasurementReportPdfVisualSection measurement={measurement} address="1 Test Way" />,
    );
    const roots = container.querySelectorAll('[data-pdf-report-root="true"]');
    expect(roots.length).toBe(1);
    const panels = container.querySelectorAll('[data-pdf-overlay-panel="true"]');
    expect(panels.length).toBe(1);
  });

  it("uses a white background on the root", () => {
    const { container } = render(
      <MeasurementReportPdfVisualSection measurement={measurement} />,
    );
    const root = container.querySelector<HTMLElement>(
      '[data-pdf-report-root="true"]',
    )!;
    expect(root.style.background.toLowerCase()).toBe("#ffffff");
  });

  it("excludes raw JSON and interactive control text", () => {
    const { container } = render(
      <MeasurementReportPdfVisualSection measurement={measurement} />,
    );
    const text = container.textContent ?? "";
    for (const banned of [
      "Raw JSON",
      "Edit vertices",
      "Approve",
      "Reject",
      "Reset",
      "AI Process Viewer",
    ]) {
      expect(text).not.toContain(banned);
    }
  });

  it("renders an aerial-unavailable placeholder rather than a dark box when raster is absent", () => {
    const { container } = render(
      <MeasurementReportPdfVisualSection measurement={measurement} />,
    );
    const panel = container.querySelector<HTMLElement>(
      '[data-pdf-overlay-panel="true"]',
    )!;
    expect(panel.textContent ?? "").toMatch(/aerial unavailable in export/i);
    expect(panel.style.background.toLowerCase()).toBe("#ffffff");
  });
});
