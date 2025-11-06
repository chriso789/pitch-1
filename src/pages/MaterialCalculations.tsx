import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Calculator } from 'lucide-react';
import { MaterialCalculator } from '@/components/materials/MaterialCalculator';
import { useLatestMeasurement } from '@/hooks/useMeasurement';
import { Skeleton } from '@/components/ui/skeleton';
import type { RoofMeasurementData } from '@/lib/measurements/materialCalculations';

export default function MaterialCalculations() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  const { data: measurementResult, isLoading } = useLatestMeasurement(id, !!id);

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <Skeleton className="h-12 w-96" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!measurementResult?.measurement) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>No Measurement Data</CardTitle>
            <CardDescription>
              This project doesn't have any measurement data yet. Please add measurements first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const measurement = measurementResult.measurement;

  // Convert measurement data to RoofMeasurementData format
  const measurementData: RoofMeasurementData = {
    total_area_sqft: measurement.roof_area_sq_ft || 0,
    total_squares: (measurement.roof_area_sq_ft || 0) / 100,
    lf_ridge: measurement.ridges_lf || 0,
    lf_hip: measurement.hips_lf || 0,
    lf_valley: measurement.valleys_lf || 0,
    lf_eave: measurement.eaves_lf || 0,
    lf_rake: measurement.rakes_lf || 0,
    lf_step: measurement.step_flashing_lf || 0,
    penetration_counts: {
      pipe_vent: measurement.pipe_vents || 0,
      skylight: measurement.skylights || 0,
      chimney: measurement.chimneys || 0,
      hvac: 0,
    },
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Calculator className="h-8 w-8" />
              Material Calculations
            </h1>
            <p className="text-muted-foreground">
              Calculate material quantities with brand-specific products
            </p>
          </div>
        </div>
      </div>

      {/* Measurement Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Roof Measurements</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Total Area</p>
              <p className="text-2xl font-bold">{measurementData.total_area_sqft.toFixed(0)} sq ft</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Squares</p>
              <p className="text-2xl font-bold">{measurementData.total_squares.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Ridge + Hip</p>
              <p className="text-2xl font-bold">{(measurementData.lf_ridge + measurementData.lf_hip).toFixed(0)} LF</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Valley</p>
              <p className="text-2xl font-bold">{measurementData.lf_valley.toFixed(0)} LF</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Material Calculator */}
      <MaterialCalculator
        measurementData={measurementData}
        pipelineEntryId={id}
        onOrderCreated={(orderId) => {
          console.log('Order created:', orderId);
          // Navigate to order page or show success
        }}
      />
    </div>
  );
}
