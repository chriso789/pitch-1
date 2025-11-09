import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import ComprehensiveMeasurementReport from './ComprehensiveMeasurementReport';

interface MeasurementReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  measurement: any;
  tags?: Record<string, any>;
  address?: string;
  onMeasurementUpdate?: (measurement: any, tags: any) => void;
}

const MeasurementReportDialog: React.FC<MeasurementReportDialogProps> = ({
  open,
  onOpenChange,
  measurement,
  tags,
  address,
  onMeasurementUpdate,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>Measurement Report</DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-[calc(90vh-100px)] px-6 pb-6">
          <ComprehensiveMeasurementReport
            measurement={measurement}
            tags={tags}
            address={address}
            onMeasurementUpdate={onMeasurementUpdate}
          />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default MeasurementReportDialog;
