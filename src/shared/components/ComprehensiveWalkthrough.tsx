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
import { VideoWalkthrough } from './VideoWalkthrough';

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
  const [issueCounter, setIssueCounter] = useState(1);
  const [reportCounter, setReportCounter] = useState(1);
  
  // Video walkthrough states
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [showVideoWalkthrough, setShowVideoWalkthrough] = useState(false);
  
  // Pointer tracking states
  const [isPointerTracking, setIsPointerTracking] = useState(false);
  const [pointerPosition, setPointerPosition] = useState({ x: 0, y: 0 });
  const [clickHistory, setClickHistory] = useState<Array<{x: number, y: number, timestamp: number, element: string}>>([]);
  const [lastClickElement, setLastClickElement] = useState<string>('');
  
  const { toast } = useToast();
  const audioRef = useRef<HTMLAudioElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunks = useRef<Blob[]>([]);

  useEffect(() => {
    loadCounters();
    
    // Listen for start test event from floating button
    const handleStartTest = () => {
      runFullWalkthrough();
    };
    
    window.addEventListener('start-walkthrough-test', handleStartTest);
    
    return () => {
      window.removeEventListener('start-walkthrough-test', handleStartTest);
    };
  }, []);

  // Pointer tracking effects
  useEffect(() => {
    if (!isPointerTracking) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPointerPosition({ x: e.clientX, y: e.clientY });
    };

    const handleClick = (e: MouseEvent) => {
      const element = e.target as HTMLElement;
      const elementDescription = getElementDescription(element);
      
      const clickData = {
        x: e.clientX,
        y: e.clientY,
        timestamp: Date.now(),
        element: elementDescription
      };
      
      setClickHistory(prev => [...prev, clickData]);
      setLastClickElement(elementDescription);
      
      toast({
        title: "Click Tracked",
        description: `Clicked: ${elementDescription}. Press 'X' if this didn't work as expected.`,
        duration: 2000
      });
    };

    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'x' && lastClickElement) {
        reportClickIssue();
      } else if (e.key === 'Escape') {
        setIsPointerTracking(false);
        toast({
          title: "Pointer Tracking Stopped",
          description: "Exited pointer tracking mode"
        });
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeyPress);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeyPress);
    };
  }, [isPointerTracking, lastClickElement]);

  const getElementDescription = (element: HTMLElement): string => {
    const tagName = element.tagName.toLowerCase();
    const className = element.className;
    const id = element.id;
    const textContent = element.textContent?.trim().substring(0, 50) || '';
    
    let description = tagName;
    if (id) description += `#${id}`;
    if (className) description += `.${className.split(' ')[0]}`;
    if (textContent) description += ` ("${textContent}")`;
    
    return description;
  };

  const startPointerTracking = () => {
    setIsPointerTracking(true);
    setClickHistory([]);
    setLastClickElement('');
    toast({
      title: "Pointer Tracking Started",
      description: "Click anywhere to track interactions. Press 'X' after a click if it doesn't work, or 'Esc' to exit."
    });
  };

  const stopPointerTracking = () => {
    setIsPointerTracking(false);
    toast({
      title: "Pointer Tracking Stopped",
      description: `Tracked ${clickHistory.length} clicks during this session`
    });
  };

  const reportClickIssue = () => {
    if (!lastClickElement) return;
    
    let currentIssueNumber = issueCounter;
    
    const issue = {
      id: `issue-${Date.now()}-pointer`,
      issueNumber: currentIssueNumber,
      title: `Click Issue - ${lastClickElement}`,
      description: `User reported that clicking "${lastClickElement}" did not work as expected during pointer tracking session.`,
      status: 'open',
      severity: 'medium',
      section: 'pointer-tracking',
      createdAt: new Date(),
      updatedAt: new Date(),
      reportData: {
        element: lastClickElement,
        clickHistory: clickHistory.slice(-5), // Last 5 clicks for context
        userReported: true
      }
    };

    // Save issue to localStorage
    const existingIssues = JSON.parse(localStorage.getItem('walkthrough-issues') || '[]');
    const updatedIssues = [...existingIssues, issue];
    localStorage.setItem('walkthrough-issues', JSON.stringify(updatedIssues));

    // Update counter
    saveCounters(currentIssueNumber + 1, reportCounter);
    
    toast({
      title: `Issue #${currentIssueNumber} Reported`,
      description: `Logged click issue with "${lastClickElement}"`,
      variant: "destructive"
    });

    setLastClickElement(''); // Clear after reporting
  };

  const loadCounters = () => {
    const issueCount = localStorage.getItem('issue-counter');
    const reportCount = localStorage.getItem('report-counter');
    if (issueCount) setIssueCounter(parseInt(issueCount));
    if (reportCount) setReportCounter(parseInt(reportCount));
  };

  const saveCounters = (issueCount: number, reportCount: number) => {
    localStorage.setItem('issue-counter', issueCount.toString());
    localStorage.setItem('report-counter', reportCount.toString());
    setIssueCounter(issueCount);
    setReportCounter(reportCount);
  };

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
      description: 'Drag & drop Kanban sales pipeline with manager approvals',
      voiceOverText: 'The Pipeline section shows a visual Kanban board where you can drag leads through stages. Includes manager approval gates and automatic production workflow triggers.',
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
    const issues: any[] = [];
    const missing: any[] = [];
    const working: string[] = [];
    let currentIssueNumber = issueCounter;

    // Create numbered issues and save them to storage
    const reportIssues: any[] = [];
    
    testResults.forEach((step) => {
      if (step.status === 'error') {
        const issue = {
          id: `issue-${Date.now()}-${step.id}`,
          issueNumber: currentIssueNumber++,
          title: `${step.name} - Error`,
          description: step.errorMessage || 'Unknown error occurred',
          status: 'open',
          severity: 'high',
          section: step.section,
          errorMessage: step.errorMessage,
          createdAt: new Date(),
          updatedAt: new Date(),
          reportData: step
        };
        issues.push(`❌ Issue #${issue.issueNumber}: ${step.name} - ${step.errorMessage || 'Unknown error'}`);
        reportIssues.push(issue);
      } else if (step.status === 'missing') {
        const issue = {
          id: `issue-${Date.now()}-${step.id}`,
          issueNumber: currentIssueNumber++,
          title: `${step.name} - Missing Implementation`,
          description: `${step.description} - Needs implementation`,
          status: 'open',
          severity: 'medium',
          section: step.section,
          createdAt: new Date(),
          updatedAt: new Date(),
          reportData: step
        };
        missing.push(`⏳ Issue #${issue.issueNumber}: ${step.name} - Needs implementation`);
        reportIssues.push(issue);
      } else if (step.status === 'success') {
        working.push(`✅ ${step.name}: Working correctly`);
      }
    });

    // Save issues to localStorage
    const existingIssues = JSON.parse(localStorage.getItem('walkthrough-issues') || '[]');
    const updatedIssues = [...existingIssues, ...reportIssues];
    localStorage.setItem('walkthrough-issues', JSON.stringify(updatedIssues));

    // Create and save walkthrough report
    const walkthroughReport = {
      id: `report-${Date.now()}`,
      reportNumber: reportCounter,
      timestamp: new Date(),
      totalIssues: reportIssues.length,
      resolvedIssues: 0,
      openIssues: reportIssues.length,
      sections: Array.from(new Set(Array.from(testResults.values()).map(step => step.section))),
      issues: reportIssues,
      reportSummary: `Generated comprehensive test report with ${reportIssues.length} issues found across ${Array.from(testResults.values()).length} sections tested.`
    };

    const existingReports = JSON.parse(localStorage.getItem('walkthrough-reports') || '[]');
    const updatedReports = [...existingReports, walkthroughReport];
    localStorage.setItem('walkthrough-reports', JSON.stringify(updatedReports));

    // Update counters
    saveCounters(currentIssueNumber, reportCounter + 1);

    const report = `
# PITCH CRM - Comprehensive Test Report #${reportCounter}
Generated: ${new Date().toLocaleString()}

## Working Features (${working.length})
${working.join('\n')}

## Issues Found (${issues.length})
${issues.join('\n')}

## Missing Features (${missing.length})
${missing.join('\n')}

## Issue Numbers Assigned
- Issues #${issueCounter} through #${currentIssueNumber - 1} have been logged
- Total new issues: ${reportIssues.length}
- Check Settings > Reports for detailed issue tracking

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

  const getCurrentIssueCount = () => {
    const existingIssues = JSON.parse(localStorage.getItem('walkthrough-issues') || '[]');
    return existingIssues.filter((issue: any) => issue.status === 'open').length;
  };

  const hasOpenIssues = getCurrentIssueCount() > 0;

  return (
    <>
      {/* Pointer Tracking Overlay */}
      {isPointerTracking && (
        <div className="fixed inset-0 z-50 pointer-events-none">
          {/* Crosshair cursor follower */}
          <div 
            className="absolute w-6 h-6 border-2 border-red-500 bg-red-500/20 rounded-full transform -translate-x-1/2 -translate-y-1/2 transition-all duration-75"
            style={{ 
              left: pointerPosition.x, 
              top: pointerPosition.y 
            }}
          />
          {/* Instructions overlay */}
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 text-white px-4 py-2 rounded-lg text-sm">
            Pointer Tracking Active • Click to track • Press 'X' after click if issue • Press 'Esc' to exit
          </div>
          {/* Click counter */}
          <div className="absolute bottom-4 right-4 bg-black/80 text-white px-3 py-2 rounded-lg text-sm">
            Clicks Tracked: {clickHistory.length}
          </div>
        </div>
      )}

      <div className="h-full max-w-7xl mx-auto p-0">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">Comprehensive System Test & Walkthrough</h2>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAudioEnabled(!audioEnabled)}
              >
                {audioEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
        
        <div className="flex-1">
          <Tabs defaultValue="walkthrough" className="h-full flex flex-col">
            <TabsList>
              <TabsTrigger value="walkthrough">Walkthrough</TabsTrigger>
              <TabsTrigger value="results">Test Results</TabsTrigger>
              <TabsTrigger value="report">Problem Report</TabsTrigger>
            </TabsList>
            
            <TabsContent value="walkthrough" className="flex-1 flex gap-6">
              {/* Video Walkthrough */}
              <div className="flex-1">
                <VideoWalkthrough 
                  onSectionChange={onSectionChange}
                  isPlaying={isVideoPlaying}
                  onPlayingChange={setIsVideoPlaying}
                />
              </div>
              
              {/* Controls Sidebar */}
              <div className="w-80 space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Test Controls</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Button 
                      onClick={runFullWalkthrough}
                      disabled={isTesting}
                      className="w-full mb-2"
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
                    
                    {/* Pointer Tracking Button */}
                    <Button 
                      onClick={isPointerTracking ? stopPointerTracking : startPointerTracking}
                      disabled={isTesting}
                      variant={isPointerTracking ? "destructive" : "secondary"}
                      className="w-full"
                    >
                      {isPointerTracking ? (
                        <>
                          <X className="h-4 w-4 mr-2" />
                          Stop Pointer Tracking
                        </>
                      ) : (
                        <>
                          <Video className="h-4 w-4 mr-2" />
                          Start Pointer Tracking
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
      </div>
    </>
  );
};

export default ComprehensiveWalkthrough;