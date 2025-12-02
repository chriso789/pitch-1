import React from 'react';
import { RoofMeasurementTool } from '@/components/roof-measurement';

const TestRoofMeasurement: React.FC = () => {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Roof Measurement Test</h1>
          <p className="text-muted-foreground">
            Testing with address: 4205 Custer Drive, Valrico, FL 33594
          </p>
        </div>
        
        <RoofMeasurementTool 
          customerId="test-123"
          initialAddress="4205 Custer Drive, Valrico, FL 33594"
        />
      </div>
    </div>
  );
};

export default TestRoofMeasurement;
