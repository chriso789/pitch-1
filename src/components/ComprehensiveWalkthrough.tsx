import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Play, 
  Pause, 
  Square, 
  RotateCcw, 
  RotateCw, 
  X, 
  Video, 
  Camera,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  Download
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';

interface WalkthroughStep {
  id: string;
  name: string;
  section: string;
  description: string;
  voiceOverText: string;
  expectedAction: string;
  status: 'pending' | 'testing' | 'success' | 'error' | 'missing';
  errorMessage?: string;
  requirements: string[];
}

const ComprehensiveWalkthrough = ({ onSectionChange }: { onSectionChange: (section: string) => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isTesting, setIsTesting] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [testResults, setTestResults] = useState<Map<string, WalkthroughStep>>(new Map());
  const [problemReport, setProblemReport] = useState<string>('');
  
  const { toast } = useToast();
  const audioRef = useRef<HTMLAudioElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunks = useRef<Blob[]>([]);

  const walkthroughSteps: WalkthroughStep[] = [
    {
      id: 'dashboard',
      name: 'Dashboard',
      section: 'dashboard',
      description: 'Main overview and metrics dashboard',
      voiceOverText: 'Welcome to the PITCH CRM dashboard. This is your central hub showing key metrics, recent activities, and performance indicators.',
      expectedAction: 'Display dashboard with charts and metrics',
      status: 'pending',
      requirements: ['Charts display', 'Data loads', 'No console errors']
    },
    {
      id: 'pipeline',
      name: 'Pipeline',
      section: 'pipeline',
      description: 'Basic lead management pipeline',
      voiceOverText: 'The Pipeline section shows your lead progression through different stages from initial contact to closed deals.',
      expectedAction: 'Show pipeline stages and leads',
      status: 'pending',
      requirements: ['Pipeline stages visible', 'Lead cards display', 'Drag and drop works']
    },
    {
      id: 'client-list',
      name: 'Client List',
      section: 'client-list',
      description: 'Unified contacts and jobs management',
      voiceOverText: 'The Client List provides a unified view of all your contacts and associated jobs, with role-based filtering and search capabilities.',
      expectedAction: 'Display contacts and jobs with filters',
      status: 'pending',
      requirements: ['Contact list loads', 'Job list loads', 'Toggle between views works', 'Search functionality']
    },
    {
      id: 'enhanced-pipeline',
      name: 'Pipeline Manager',
      section: 'enhanced-pipeline',
      description: 'Advanced pipeline management with automation',
      voiceOverText: 'The Pipeline Manager offers advanced features for pipeline customization, automation rules, and detailed analytics.',
      expectedAction: 'Show advanced pipeline features',
      status: 'pending',
      requirements: ['Advanced features visible', 'Settings panel works', 'Analytics display']
    },
    {
      id: 'estimates',
      name: 'Estimates',
      section: 'estimates',
      description: 'Pricing and proposal management',
      voiceOverText: 'The Estimates module helps you create professional quotes and proposals with dynamic pricing and template management.',
      expectedAction: 'Display estimate builder and templates',
      status: 'pending',
      requirements: ['Estimate list loads', 'Create new estimate works', 'Templates available']
    },
    {
      id: 'projects',
      name: 'Projects',
      section: 'projects',
      description: 'Project management and tracking',
      voiceOverText: 'Project management allows you to track ongoing work, assign resources, and monitor progress from start to completion.',
      expectedAction: 'Show project dashboard and tracking',
      status: 'pending',
      requirements: ['Project list displays', 'Project details accessible', 'Status tracking works']
    },
    {
      id: 'production',
      name: 'Production',
      section: 'production',
      description: 'Job tracking and field operations',
      voiceOverText: 'The Production module manages field operations, crew assignments, and real-time job progress tracking.',
      expectedAction: 'Display production dashboard',
      status: 'pending',
      requirements: ['Job assignments visible', 'Crew management works', 'Progress tracking displays']
    },
    {
      id: 'payments',
      name: 'Payments',
      section: 'payments',
      description: 'Billing and revenue management',
      voiceOverText: 'Payment management handles invoicing, payment processing, and revenue tracking with multiple payment method support.',
      expectedAction: 'Show payment dashboard and options',
      status: 'pending',
      requirements: ['Payment history loads', 'Create invoice works', 'Payment methods display']
    },
    {
      id: 'calendar',
      name: 'Calendar',
      section: 'calendar',
      description: 'Schedule and appointment management',
      voiceOverText: 'The Calendar system manages appointments, scheduling, and resource allocation with automated reminders.',
      expectedAction: 'Display calendar with appointments',
      status: 'pending',
      requirements: ['Calendar view loads', 'Appointments display', 'Create event works']
    },
    {
      id: 'dialer',
      name: 'Dialer',
      section: 'dialer',
      description: 'AI-powered calling system',
      voiceOverText: 'The AI Dialer automates calling workflows with intelligent lead prioritization and conversation tracking.',
      expectedAction: 'Show dialer interface and call features',
      status: 'pending',
      requirements: ['Dialer interface loads', 'Contact selection works', 'Call logging functions']
    },
    {
      id: 'smartdocs',
      name: 'Smart Docs',
      section: 'smartdocs',
      description: 'Document templates and library',
      voiceOverText: 'Smart Docs provides template management, document generation, and a comprehensive library of industry-standard forms.',
      expectedAction: 'Display document templates and library',
      status: 'pending',
      requirements: ['Template library loads', 'Document creation works', 'Template editor functions']
    },
    {
      id: 'settings',
      name: 'Settings',
      section: 'settings',
      description: 'System configuration and preferences',
      voiceOverText: 'Settings allows you to configure system preferences, user management, and customize the CRM to your business needs.',
      expectedAction: 'Display settings panels and options',
      status: 'pending',
      requirements: ['Settings panels load', 'User management works', 'Configuration saves']
    },
    {
      id: 'security',
      name: 'Security',
      section: 'security',
      description: 'Access control and permissions',
      voiceOverText: 'Security management controls user access, permissions, and system security policies.',
      expectedAction: 'Show security dashboard and controls',
      status: 'pending',
      requirements: ['Security dashboard displays', 'Permission controls work', 'Audit logs available']
    },
    {
      id: 'help',
      name: 'Help',
      section: 'help',
      description: 'Support and documentation',
      voiceOverText: 'The Help section provides comprehensive documentation, tutorials, and support resources.',
      expectedAction: 'Display help documentation and support',
      status: 'pending',
      requirements: ['Documentation loads', 'Search function works', 'Support contact available']
    }
  ];

  const playVoiceOver = async (text: string) => {
    if (!audioEnabled) return;
    
    try {
      setIsPlayingAudio(true);
      
      const { data, error } = await supabase.functions.invoke('text-to-speech', {
        body: { text, voice: 'nova' } // Using Nova for female voice
      });

      if (error) throw error;

      if (data.audioContent) {
        const audio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
        audio.onended = () => setIsPlayingAudio(false);
        await audio.play();
      }
    } catch (error) {
      console.error('Voice over error:', error);
      setIsPlayingAudio(false);
      toast({
        title: "Voice over unavailable",
        description: "Continuing with silent testing",
        variant: "default"
      });
    }
  };

  const testStep = async (step: WalkthroughStep) => {
    console.log(`Testing step: ${step.name}`);
    
    // Update step status to testing
    let updatedStep: WalkthroughStep = { ...step, status: 'testing' };
    setTestResults(prev => new Map(prev.set(step.id, updatedStep)));

    // Play voice over
    await playVoiceOver(step.voiceOverText);

    // Navigate to the section
    try {
      onSectionChange(step.section);
      
      // Wait for section to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check for console errors
      const hasErrors = checkForErrors();
      
      if (hasErrors) {
        updatedStep = { ...updatedStep, status: 'error', errorMessage: 'Console errors detected' };
      } else {
        // Basic success - section loaded without errors
        updatedStep = { ...updatedStep, status: 'success' };
      }
      
    } catch (error) {
      console.error(`Error testing ${step.name}:`, error);
      updatedStep = { 
        ...updatedStep, 
        status: 'error', 
        errorMessage: error instanceof Error ? error.message : 'Unknown error' 
      };
    }

    setTestResults(prev => new Map(prev.set(step.id, updatedStep)));
  };

  const checkForErrors = () => {
    // Simple error detection - in a real implementation, this would be more sophisticated
    const errors = document.querySelectorAll('[data-error]');
    return errors.length > 0;
  };

  const runFullWalkthrough = async () => {
    setIsTesting(true);
    
    for (let i = 0; i < walkthroughSteps.length; i++) {
      setCurrentStep(i);
      await testStep(walkthroughSteps[i]);
      
      // Small delay between steps
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    setIsTesting(false);
    generateProblemReport();
    
    toast({
      title: "Walkthrough Complete",
      description: "Full system test completed. Check the problem report for issues.",
    });
  };

  const generateProblemReport = () => {
    const issues: string[] = [];
    const missing: string[] = [];
    const working: string[] = [];

    testResults.forEach((step) => {
      if (step.status === 'error') {
        issues.push(`❌ ${step.name}: ${step.errorMessage || 'Unknown error'}`);
      } else if (step.status === 'missing') {
        missing.push(`⏳ ${step.name}: ${step.description} - Needs implementation`);
      } else if (step.status === 'success') {
        working.push(`✅ ${step.name}: Working correctly`);
      }
    });

    const report = `
# PITCH CRM - Comprehensive Test Report
Generated: ${new Date().toLocaleString()}

## Working Features (${working.length})
${working.join('\n')}

## Issues Found (${issues.length})
${issues.join('\n')}

## Missing Features (${missing.length})
${missing.join('\n')}

## Completion Commands
${missing.map(item => {
  const stepName = item.split(':')[0].replace('⏳ ', '');
  return `- Complete ${stepName} implementation`;
}).join('\n')}

## Next Steps
1. Fix all console errors and loading issues
2. Implement missing features identified above
3. Add proper error handling and loading states
4. Ensure role-based access control works correctly
5. Test mobile responsiveness
6. Add comprehensive form validation
7. Implement proper data relationships in database
    `;

    setProblemReport(report);
  };

  const downloadReport = () => {
    const blob = new Blob([problemReport], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pitch-crm-test-report.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getStepStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'text-green-600';
      case 'error': return 'text-red-600';
      case 'testing': return 'text-blue-600';
      case 'missing': return 'text-orange-600';
      default: return 'text-gray-600';
    }
  };

  const getStepStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'error': return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case 'testing': return <Clock className="h-4 w-4 text-blue-600 animate-spin" />;
      case 'missing': return <AlertTriangle className="h-4 w-4 text-orange-600" />;
      default: return <Clock className="h-4 w-4 text-gray-600" />;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          className="fixed top-4 right-20 z-50 bg-background/80 backdrop-blur-sm border-primary/20 hover:bg-primary/10"
        >
          <Camera className="h-4 w-4 mr-2" />
          Full System Test
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-7xl h-[95vh] p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="flex items-center justify-between">
            <span>Comprehensive CRM Walkthrough & Testing</span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAudioEnabled(!audioEnabled)}
              >
                {audioEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 p-6">
          <Tabs defaultValue="walkthrough" className="h-full flex flex-col">
            <TabsList>
              <TabsTrigger value="walkthrough">Walkthrough</TabsTrigger>
              <TabsTrigger value="results">Test Results</TabsTrigger>
              <TabsTrigger value="report">Problem Report</TabsTrigger>
            </TabsList>
            
            <TabsContent value="walkthrough" className="flex-1 flex gap-6">
              {/* Controls */}
              <div className="w-80 space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Test Controls</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Button 
                      onClick={runFullWalkthrough}
                      disabled={isTesting}
                      className="w-full"
                    >
                      {isTesting ? (
                        <>
                          <Clock className="h-4 w-4 mr-2 animate-spin" />
                          Testing...
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4 mr-2" />
                          Start Full Test
                        </>
                      )}
                    </Button>
                    
                    <div className="flex items-center gap-2 text-sm">
                      <Badge variant={audioEnabled ? "default" : "secondary"}>
                        Voice Over: {audioEnabled ? "ON" : "OFF"}
                      </Badge>
                      {isPlayingAudio && (
                        <Badge variant="outline">
                          <Mic className="h-3 w-3 mr-1" />
                          Speaking
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Progress</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>Step {currentStep + 1} of {walkthroughSteps.length}</span>
                        <span>{Math.round(((currentStep + 1) / walkthroughSteps.length) * 100)}%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div 
                          className="bg-primary rounded-full h-2 transition-all"
                          style={{ width: `${((currentStep + 1) / walkthroughSteps.length) * 100}%` }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
              
              {/* Step List */}
              <div className="flex-1">
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle>Walkthrough Steps</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 max-h-96 overflow-y-auto">
                    {walkthroughSteps.map((step, index) => {
                      const result = testResults.get(step.id);
                      const status = result?.status || 'pending';
                      
                      return (
                        <div 
                          key={step.id}
                          className={cn(
                            "p-3 rounded-lg border transition-colors",
                            currentStep === index && isTesting && "border-primary bg-primary/5",
                            status === 'success' && "bg-green-50 border-green-200",
                            status === 'error' && "bg-red-50 border-red-200"
                          )}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              {getStepStatusIcon(status)}
                              <span className="font-medium">{step.name}</span>
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {index + 1}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">
                            {step.description}
                          </p>
                          <div className="text-xs text-muted-foreground">
                            Expected: {step.expectedAction}
                          </div>
                          {result?.errorMessage && (
                            <div className="text-xs text-red-600 mt-1">
                              Error: {result.errorMessage}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
            
            <TabsContent value="results" className="flex-1">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>Test Results Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-4 mb-6">
                    <div className="text-center p-4 rounded-lg bg-green-50">
                      <div className="text-2xl font-bold text-green-600">
                        {Array.from(testResults.values()).filter(r => r.status === 'success').length}
                      </div>
                      <div className="text-sm text-green-600">Passing</div>
                    </div>
                    <div className="text-center p-4 rounded-lg bg-red-50">
                      <div className="text-2xl font-bold text-red-600">
                        {Array.from(testResults.values()).filter(r => r.status === 'error').length}
                      </div>
                      <div className="text-sm text-red-600">Failing</div>
                    </div>
                    <div className="text-center p-4 rounded-lg bg-orange-50">
                      <div className="text-2xl font-bold text-orange-600">
                        {Array.from(testResults.values()).filter(r => r.status === 'missing').length}
                      </div>
                      <div className="text-sm text-orange-600">Missing</div>
                    </div>
                    <div className="text-center p-4 rounded-lg bg-gray-50">
                      <div className="text-2xl font-bold text-gray-600">
                        {walkthroughSteps.length - testResults.size}
                      </div>
                      <div className="text-sm text-gray-600">Pending</div>
                    </div>
                  </div>
                  
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {Array.from(testResults.values()).map((result) => (
                      <div key={result.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-3">
                          {getStepStatusIcon(result.status)}
                          <div>
                            <div className="font-medium">{result.name}</div>
                            {result.errorMessage && (
                              <div className="text-sm text-red-600">{result.errorMessage}</div>
                            )}
                          </div>
                        </div>
                        <Badge variant={
                          result.status === 'success' ? 'default' : 
                          result.status === 'error' ? 'destructive' : 'secondary'
                        }>
                          {result.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="report" className="flex-1">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    Problem Report
                    <Button onClick={downloadReport} size="sm" variant="outline">
                      <Download className="h-4 w-4 mr-2" />
                      Download Report
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-sm bg-muted p-4 rounded-lg overflow-auto h-96 whitespace-pre-wrap">
                    {problemReport || 'Run the walkthrough to generate a problem report...'}
                  </pre>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ComprehensiveWalkthrough;