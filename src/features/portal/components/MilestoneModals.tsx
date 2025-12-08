import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { 
  FileText, Download, Calendar, MapPin, Play,
  Star, ExternalLink, CheckCircle, DollarSign,
  FileDown, Award, Shield, Clipboard
} from 'lucide-react';
import { CustomerProject, CustomerMilestone } from '../hooks/useCustomerPortal';
import { cn } from '@/lib/utils';

interface MilestoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  stageKey: string;
  project: CustomerProject;
  milestone?: CustomerMilestone;
  onPayNow?: () => void;
  onSubmitSurvey?: (ratings: Record<string, number>, notes: string) => void;
}

export function MilestoneModal({ 
  isOpen, 
  onClose, 
  stageKey, 
  project, 
  milestone,
  onPayNow,
  onSubmitSurvey 
}: MilestoneModalProps) {
  const renderContent = () => {
    switch (stageKey) {
      case 'contract_deposit':
        return <ContractDepositContent project={project} />;
      case 'permit_submitted':
        return <PermitSubmittedContent project={project} />;
      case 'permit_approved':
        return <PermitApprovedContent project={project} />;
      case 'job_scheduled':
        return <JobScheduledContent project={project} />;
      case 'install':
        return <InstallContent project={project} />;
      case 'final':
        return <FinalContent project={project} onPayNow={onPayNow} onSubmitSurvey={onSubmitSurvey} />;
      case 'paid_in_full':
        return <PaidInFullContent project={project} />;
      default:
        return <div>Content not available</div>;
    }
  };

  const getTitle = () => {
    switch (stageKey) {
      case 'contract_deposit': return 'Contract & Deposit';
      case 'permit_submitted': return 'Permit Application Submitted';
      case 'permit_approved': return 'Permit Approved';
      case 'job_scheduled': return 'Job Scheduled';
      case 'install': return 'Installation';
      case 'final': return 'Final Review';
      case 'paid_in_full': return 'Project Complete';
      default: return 'Milestone Details';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
        </DialogHeader>
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
}

function ContractDepositContent({ project }: { project: CustomerProject }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-4 bg-green-500/10 rounded-lg">
        <CheckCircle className="w-6 h-6 text-green-500" />
        <div>
          <p className="font-medium text-green-700 dark:text-green-400">Contract Signed</p>
          <p className="text-sm text-muted-foreground">Deposit received</p>
        </div>
      </div>
      
      <div className="space-y-3">
        <Button variant="outline" className="w-full justify-start">
          <FileText className="w-4 h-4 mr-2" />
          View Contract
          <Download className="w-4 h-4 ml-auto" />
        </Button>
        <Button variant="outline" className="w-full justify-start">
          <FileText className="w-4 h-4 mr-2" />
          Download Deposit Receipt
          <Download className="w-4 h-4 ml-auto" />
        </Button>
      </div>
    </div>
  );
}

function PermitSubmittedContent({ project }: { project: CustomerProject }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-4 bg-yellow-500/10 rounded-lg">
        <FileText className="w-6 h-6 text-yellow-600" />
        <div>
          <p className="font-medium">Under Review</p>
          <p className="text-sm text-muted-foreground">Awaiting building department approval</p>
        </div>
      </div>
      
      <div className="p-4 border rounded-lg space-y-3">
        <h4 className="font-medium">Building Department Info</h4>
        <div className="text-sm space-y-2 text-muted-foreground">
          <p className="flex items-center gap-2">
            <MapPin className="w-4 h-4" />
            Local Building Department
          </p>
          <p>Your permit application and NOC have been submitted.</p>
          <p>Average approval time: 5-10 business days</p>
        </div>
      </div>
    </div>
  );
}

function PermitApprovedContent({ project }: { project: CustomerProject }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-4 bg-green-500/10 rounded-lg">
        <CheckCircle className="w-6 h-6 text-green-500" />
        <div>
          <p className="font-medium text-green-700 dark:text-green-400">Permit Approved!</p>
          <p className="text-sm text-muted-foreground">Ready for scheduling</p>
        </div>
      </div>
      
      <Button variant="outline" className="w-full justify-start">
        <FileDown className="w-4 h-4 mr-2" />
        Download Permit
        <Download className="w-4 h-4 ml-auto" />
      </Button>
      
      <div className="p-4 border rounded-lg space-y-3 bg-primary/5">
        <h4 className="font-medium flex items-center gap-2">
          <Clipboard className="w-4 h-4 text-primary" />
          Important Instructions
        </h4>
        <ol className="text-sm space-y-2 text-muted-foreground list-decimal ml-4">
          <li>Print this permit</li>
          <li>Post it in a location visible from the street</li>
          <li>Keep it posted until final inspection is complete</li>
        </ol>
      </div>
    </div>
  );
}

function JobScheduledContent({ project }: { project: CustomerProject }) {
  return (
    <div className="space-y-4">
      <div className="p-4 border rounded-lg space-y-4">
        <h4 className="font-medium flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          Scheduled Dates
        </h4>
        
        <div className="grid gap-3">
          <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
            <div>
              <p className="text-sm font-medium">📦 Material Delivery</p>
              <p className="text-xs text-muted-foreground">Date TBD</p>
            </div>
            <Badge>Scheduled</Badge>
          </div>
          
          <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
            <div>
              <p className="text-sm font-medium">🔨 Work Start</p>
              <p className="text-xs text-muted-foreground">Date TBD</p>
            </div>
            <Badge variant="outline">Pending</Badge>
          </div>
          
          <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
            <div>
              <p className="text-sm font-medium">🔍 Dryin Inspection</p>
              <p className="text-xs text-muted-foreground">Date TBD</p>
            </div>
            <Badge variant="outline">Pending</Badge>
          </div>
        </div>
      </div>
      
      <p className="text-xs text-muted-foreground text-center">
        * Dates are subject to change based on weather conditions
      </p>
    </div>
  );
}

function InstallContent({ project }: { project: CustomerProject }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-4 bg-primary/10 rounded-lg">
        <div className="relative">
          <div className="w-6 h-6 bg-primary rounded-full animate-pulse" />
        </div>
        <div>
          <p className="font-medium">Installation In Progress</p>
          <p className="text-sm text-muted-foreground">Weather dependent</p>
        </div>
      </div>
      
      <div className="p-4 border rounded-lg space-y-3">
        <h4 className="font-medium flex items-center gap-2">
          <Play className="w-4 h-4 text-primary" />
          What to Expect
        </h4>
        <Button variant="outline" className="w-full">
          <Play className="w-4 h-4 mr-2" />
          Watch Installation Video
        </Button>
      </div>
      
      <div className="space-y-2 p-4 bg-muted/50 rounded-lg">
        <h4 className="font-medium text-sm">During Installation:</h4>
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>✓ Secure pets and children inside</li>
          <li>✓ Move vehicles away from work area</li>
          <li>✓ Expect some noise during work hours</li>
          <li>✓ Crew will clean up daily</li>
        </ul>
      </div>
    </div>
  );
}

function FinalContent({ 
  project, 
  onPayNow,
  onSubmitSurvey 
}: { 
  project: CustomerProject; 
  onPayNow?: () => void;
  onSubmitSurvey?: (ratings: Record<string, number>, notes: string) => void;
}) {
  const [ratings, setRatings] = useState({
    workmanship: 5,
    customerService: 5,
    speed: 5,
    overall: 5
  });
  const [notes, setNotes] = useState('');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-4 bg-green-500/10 rounded-lg">
        <CheckCircle className="w-6 h-6 text-green-500" />
        <div>
          <p className="font-medium text-green-700 dark:text-green-400">Work Complete!</p>
          <p className="text-sm text-muted-foreground">Final review and payment</p>
        </div>
      </div>
      
      <div className="space-y-3">
        <Button variant="outline" className="w-full justify-start">
          <FileText className="w-4 h-4 mr-2" />
          View Certificate of Completion
          <Download className="w-4 h-4 ml-auto" />
        </Button>
        
        <Button onClick={onPayNow} className="w-full">
          <DollarSign className="w-4 h-4 mr-2" />
          Pay Final Invoice
        </Button>
      </div>
      
      <div className="p-4 border rounded-lg space-y-4">
        <h4 className="font-medium">Rate Your Experience</h4>
        
        {Object.entries(ratings).map(([key, value]) => (
          <div key={key} className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
              <span className="font-medium">{value}/10</span>
            </div>
            <Slider
              value={[value]}
              onValueChange={([v]) => setRatings(prev => ({ ...prev, [key]: v }))}
              min={1}
              max={10}
              step={1}
            />
          </div>
        ))}
        
        <div className="space-y-2">
          <Label>Punch-out Notes (any remaining items)</Label>
          <Textarea
            placeholder="Any issues or items that need attention..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        
        <Button 
          variant="outline" 
          className="w-full"
          onClick={() => onSubmitSurvey?.(ratings, notes)}
        >
          Submit Feedback
        </Button>
      </div>
    </div>
  );
}

function PaidInFullContent({ project }: { project: CustomerProject }) {
  return (
    <div className="space-y-4">
      <div className="text-center py-6">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center">
          <CheckCircle className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-xl font-bold">Thank You!</h3>
        <p className="text-muted-foreground">Your project is complete</p>
      </div>
      
      <div className="space-y-3">
        <Button variant="outline" className="w-full justify-start">
          <FileText className="w-4 h-4 mr-2" />
          Final Bill
          <Download className="w-4 h-4 ml-auto" />
        </Button>
        <Button variant="outline" className="w-full justify-start">
          <Shield className="w-4 h-4 mr-2" />
          Warranty Certificate
          <Download className="w-4 h-4 ml-auto" />
        </Button>
        <Button variant="outline" className="w-full justify-start">
          <FileText className="w-4 h-4 mr-2" />
          Lien Waiver
          <Download className="w-4 h-4 ml-auto" />
        </Button>
      </div>
      
      {project.wind_mitigation_eligible && (
        <div className="p-4 bg-gradient-to-r from-primary/10 to-primary/5 rounded-lg border border-primary/20">
          <div className="flex items-center gap-3">
            <Award className="w-8 h-8 text-primary" />
            <div>
              <p className="font-medium text-primary">FREE Wind Mitigation Inspection</p>
              <p className="text-sm text-muted-foreground">You're eligible! We'll contact you to schedule.</p>
            </div>
          </div>
        </div>
      )}
      
      <div className="p-4 border rounded-lg space-y-3">
        <h4 className="font-medium">Leave Us a Review</h4>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="https://google.com/search" target="_blank" rel="noopener noreferrer">
              <Star className="w-4 h-4 mr-1" /> Google
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href="https://facebook.com" target="_blank" rel="noopener noreferrer">
              <Star className="w-4 h-4 mr-1" /> Facebook
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href="https://bbb.org" target="_blank" rel="noopener noreferrer">
              <Star className="w-4 h-4 mr-1" /> BBB
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href="https://yelp.com" target="_blank" rel="noopener noreferrer">
              <Star className="w-4 h-4 mr-1" /> Yelp
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
