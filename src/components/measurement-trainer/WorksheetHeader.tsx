import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { FileText } from 'lucide-react';

export interface JobInfo {
  jobName: string;
  date: string;
  measurer: string;
  source: 'field' | 'plan' | 'takeoff' | 'other';
  notes: string[];
}

interface WorksheetHeaderProps {
  jobInfo: JobInfo;
  onChange: (info: JobInfo) => void;
}

export const WorksheetHeader: React.FC<WorksheetHeaderProps> = ({ jobInfo, onChange }) => {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="h-5 w-5" />
          1. Job Header
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="jobName">Job / Address</Label>
            <Input
              id="jobName"
              placeholder="123 Main St, City, State"
              value={jobInfo.jobName}
              onChange={(e) => onChange({ ...jobInfo, jobName: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              value={jobInfo.date}
              onChange={(e) => onChange({ ...jobInfo, date: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="measurer">Measurer</Label>
            <Input
              id="measurer"
              placeholder="Name"
              value={jobInfo.measurer}
              onChange={(e) => onChange({ ...jobInfo, measurer: e.target.value })}
            />
          </div>
        </div>
        
        <div className="space-y-2">
          <Label>Source</Label>
          <RadioGroup
            value={jobInfo.source}
            onValueChange={(value: 'field' | 'plan' | 'takeoff' | 'other') => 
              onChange({ ...jobInfo, source: value })
            }
            className="flex flex-wrap gap-4"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="field" id="field" />
              <Label htmlFor="field" className="font-normal">Field</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="plan" id="plan" />
              <Label htmlFor="plan" className="font-normal">Plan/Blueprint</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="takeoff" id="takeoff" />
              <Label htmlFor="takeoff" className="font-normal">Takeoff</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="other" id="other" />
              <Label htmlFor="other" className="font-normal">Other</Label>
            </div>
          </RadioGroup>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="notes">Notes / Assumptions</Label>
          <Textarea
            id="notes"
            placeholder="Enter any assumptions, limitations, or special notes about this measurement..."
            value={jobInfo.notes.join('\n')}
            onChange={(e) => onChange({ ...jobInfo, notes: e.target.value.split('\n').filter(n => n.trim()) })}
            rows={3}
          />
        </div>
      </CardContent>
    </Card>
  );
};
