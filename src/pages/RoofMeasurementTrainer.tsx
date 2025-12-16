import React, { useState, useMemo } from 'react';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { BookOpen, Calculator, FileText, RotateCcw } from 'lucide-react';

import { TrainingContent } from '@/components/measurement-trainer/TrainingContent';
import { WorksheetHeader, JobInfo } from '@/components/measurement-trainer/WorksheetHeader';
import { PitchReferenceTable } from '@/components/measurement-trainer/PitchReferenceTable';
import { PlaneWorksheet } from '@/components/measurement-trainer/PlaneWorksheet';
import { LinearComponentsWorksheet } from '@/components/measurement-trainer/LinearComponentsWorksheet';
import { ComplexityAndWaste } from '@/components/measurement-trainer/ComplexityAndWaste';
import { QCChecklist } from '@/components/measurement-trainer/QCChecklist';
import { FinalSummary } from '@/components/measurement-trainer/FinalSummary';

import {
  PlaneCalculation,
  LinearSegment,
  ComplexityCounts,
  PitchInfo,
  runQCChecks,
  parsePitch,
} from '@/lib/measurements/roofWorksheetCalculations';

const RoofMeasurementTrainer: React.FC = () => {
  // Job Info
  const [jobInfo, setJobInfo] = useState<JobInfo>({
    jobName: '',
    date: new Date().toISOString().split('T')[0],
    measurer: '',
    source: 'field',
    notes: [],
  });
  
  // Custom pitches
  const [customPitches, setCustomPitches] = useState<PitchInfo[]>([]);
  
  // Planes
  const [planes, setPlanes] = useState<PlaneCalculation[]>([]);
  
  // Linear segments
  const [linearSegments, setLinearSegments] = useState<LinearSegment[]>([]);
  
  // Complexity
  const [complexity, setComplexity] = useState<ComplexityCounts>({
    planesCount: 0,
    valleysCount: 0,
    dormersCount: 0,
    penetrationsCount: 0,
  });
  const [complexityNotes, setComplexityNotes] = useState('');
  
  // Waste
  const [wastePercent, setWastePercent] = useState(10);
  const [material, setMaterial] = useState('asphalt');
  
  // Calculate average pitch for waste recommendation
  const avgPitch = useMemo(() => {
    const includedPlanes = planes.filter(p => p.include);
    if (includedPlanes.length === 0) return '6/12';
    const avgRise = includedPlanes.reduce((sum, p) => sum + p.pitchInfo.rise, 0) / includedPlanes.length;
    return `${Math.round(avgRise)}/12`;
  }, [planes]);
  
  // Run QC checks
  const qcResult = useMemo(() => {
    return runQCChecks(planes, linearSegments, complexity, wastePercent);
  }, [planes, linearSegments, complexity, wastePercent]);
  
  // Update complexity counts when planes change
  React.useEffect(() => {
    const valleyCount = linearSegments.filter(s => s.type === 'valley').length;
    setComplexity(prev => ({
      ...prev,
      planesCount: planes.filter(p => p.include).length,
      valleysCount: valleyCount,
    }));
  }, [planes, linearSegments]);
  
  const resetWorksheet = () => {
    setJobInfo({
      jobName: '',
      date: new Date().toISOString().split('T')[0],
      measurer: '',
      source: 'field',
      notes: [],
    });
    setCustomPitches([]);
    setPlanes([]);
    setLinearSegments([]);
    setComplexity({
      planesCount: 0,
      valleysCount: 0,
      dormersCount: 0,
      penetrationsCount: 0,
    });
    setComplexityNotes('');
    setWastePercent(10);
    setMaterial('asphalt');
  };
  
  return (
    <GlobalLayout>
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Calculator className="h-6 w-6 text-primary" />
              Roof Measurement Trainer & Worksheet
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Learn to measure roofs by hand with explainable geometry. No magic AI guesses.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={resetWorksheet}>
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset
            </Button>
            <Badge variant="secondary" className="py-1 px-3">
              {planes.filter(p => p.include).length} planes | {linearSegments.length} segments
            </Badge>
          </div>
        </div>
        
        {/* Main Content */}
        <Tabs defaultValue="worksheet" className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2 mb-6">
            <TabsTrigger value="training" className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Training Guide
            </TabsTrigger>
            <TabsTrigger value="worksheet" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Worksheet
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="training">
            <TrainingContent />
          </TabsContent>
          
          <TabsContent value="worksheet" className="space-y-6">
            {/* 1. Job Header */}
            <WorksheetHeader jobInfo={jobInfo} onChange={setJobInfo} />
            
            {/* 2. Pitch Reference */}
            <PitchReferenceTable
              customPitches={customPitches}
              onAddPitch={(pitch) => setCustomPitches([...customPitches, pitch])}
              onRemovePitch={(idx) => setCustomPitches(customPitches.filter((_, i) => i !== idx))}
            />
            
            {/* 3. Plane Worksheet */}
            <PlaneWorksheet
              planes={planes}
              customPitches={customPitches}
              onPlanesChange={setPlanes}
            />
            
            {/* 4. Linear Components */}
            <LinearComponentsWorksheet
              segments={linearSegments}
              onSegmentsChange={setLinearSegments}
            />
            
            {/* 5 & 6. Complexity and Waste */}
            <ComplexityAndWaste
              complexity={complexity}
              onComplexityChange={setComplexity}
              wastePercent={wastePercent}
              onWasteChange={setWastePercent}
              material={material}
              onMaterialChange={setMaterial}
              avgPitch={avgPitch}
              complexityNotes={complexityNotes}
              onComplexityNotesChange={setComplexityNotes}
            />
            
            {/* 7. QC Checklist */}
            <QCChecklist qcResult={qcResult} />
            
            {/* 8. Final Summary */}
            <FinalSummary
              jobInfo={jobInfo}
              planes={planes}
              linearSegments={linearSegments}
              complexity={complexity}
              wastePercent={wastePercent}
              material={material}
              qcResult={qcResult}
              customPitches={customPitches}
              complexityNotes={complexityNotes}
            />
          </TabsContent>
        </Tabs>
      </div>
    </GlobalLayout>
  );
};

export default RoofMeasurementTrainer;
