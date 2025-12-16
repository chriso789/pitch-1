import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, AlertCircle, ClipboardCheck } from 'lucide-react';
import { QCResult, QCCheck } from '@/lib/measurements/roofWorksheetCalculations';

interface QCChecklistProps {
  qcResult: QCResult;
}

export const QCChecklist: React.FC<QCChecklistProps> = ({ qcResult }) => {
  const getStatusIcon = (check: QCCheck) => {
    if (check.pass === null) return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
    if (check.pass) return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    return <XCircle className="h-4 w-4 text-destructive" />;
  };
  
  const getStatusBadge = (check: QCCheck) => {
    if (check.pass === null) return <Badge variant="outline">Pending</Badge>;
    if (check.pass) return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">PASS</Badge>;
    return <Badge variant="destructive">FAIL</Badge>;
  };
  
  const passedCount = qcResult.checks.filter(c => c.pass === true).length;
  const failedCount = qcResult.checks.filter(c => c.pass === false).length;
  
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ClipboardCheck className="h-5 w-5" />
          7. QC Checklist
        </CardTitle>
        <CardDescription className="flex items-center gap-4">
          <span>Automated quality checks on your measurements</span>
          <div className="flex gap-2">
            <Badge className="bg-green-100 text-green-800">{passedCount} Passed</Badge>
            {failedCount > 0 && <Badge variant="destructive">{failedCount} Failed</Badge>}
          </div>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {qcResult.checks.map((check) => (
            <div
              key={check.id}
              className={`flex items-start gap-3 p-2 rounded-lg ${
                check.pass === false ? 'bg-destructive/10' : 
                check.pass === true ? 'bg-green-50' : 'bg-muted/50'
              }`}
            >
              {getStatusIcon(check)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{check.id}</span>
                  <span className="text-sm">{check.description}</span>
                  {getStatusBadge(check)}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{check.notes}</p>
              </div>
            </div>
          ))}
        </div>
        
        {/* Overall Status */}
        <div className={`mt-4 p-3 rounded-lg border-2 ${
          qcResult.overallOk 
            ? 'bg-green-50 border-green-400' 
            : 'bg-destructive/10 border-destructive'
        }`}>
          <div className="flex items-center gap-2">
            {qcResult.overallOk 
              ? <CheckCircle2 className="h-5 w-5 text-green-600" />
              : <XCircle className="h-5 w-5 text-destructive" />
            }
            <span className="font-semibold">
              {qcResult.overallOk 
                ? 'All QC checks passed - Ready for final summary'
                : 'QC issues found - Review before proceeding'
              }
            </span>
          </div>
          {qcResult.overallNotes.length > 0 && (
            <ul className="mt-2 text-sm space-y-1">
              {qcResult.overallNotes.map((note, idx) => (
                <li key={idx} className="text-destructive">• {note}</li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
