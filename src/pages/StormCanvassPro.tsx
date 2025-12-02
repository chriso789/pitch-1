import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  CloudRain, 
  Map, 
  Users, 
  ClipboardCheck, 
  Camera, 
  BarChart, 
  Settings,
  Upload,
  Download,
  FileText,
  Trophy
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function StormCanvassPro() {
  const navigate = useNavigate();
  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <CloudRain className="h-8 w-8 text-primary" />
            Storm Canvass Pro
          </h1>
          <p className="text-muted-foreground mt-1">
            Advanced storm damage canvassing and lead generation
          </p>
        </div>
        <Badge variant="secondary" className="text-sm">
          Integration Ready
        </Badge>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Canvassers</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">
              Ready to deploy
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Territories</CardTitle>
            <Map className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">
              Waiting for setup
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Doors Knocked</CardTitle>
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">
              Today
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Leads Generated</CardTitle>
            <BarChart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">
              This week
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Features Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Territory Management */}
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Map className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-lg">Territory Management</CardTitle>
            </div>
            <CardDescription>
              Define and assign canvassing territories with geo-fencing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button 
                variant="outline"
                size="sm"
                className="whitespace-nowrap"
                onClick={() => navigate('/storm-canvass/map')}
              >
                <Map className="h-4 w-4 mr-1.5" />
                Map
              </Button>
              <Button 
                variant="outline"
                size="sm"
                className="whitespace-nowrap"
                onClick={() => navigate('/storm-canvass/dashboard')}
              >
                <BarChart className="h-4 w-4 mr-1.5" />
                Dashboard
              </Button>
              <Button 
                variant="outline"
                size="sm"
                className="whitespace-nowrap"
                onClick={() => navigate('/storm-canvass/leaderboard')}
              >
                <Trophy className="h-4 w-4 mr-1.5" />
                Leaderboard
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Canvasser Dashboard */}
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-lg">Canvasser Dashboard</CardTitle>
            </div>
            <CardDescription>
              Real-time tracking and performance monitoring
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              className="w-full" 
              variant="outline"
              onClick={() => navigate('/storm-canvass/dashboard')}
            >
              View Dashboard
            </Button>
          </CardContent>
        </Card>

        {/* Lead Capture */}
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-lg">
                <ClipboardCheck className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-lg">Lead Capture</CardTitle>
            </div>
            <CardDescription>
              Mobile-optimized lead capture with damage assessment
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              className="w-full" 
              onClick={() => navigate('/storm-canvass/live')}
            >
              <Map className="h-4 w-4 mr-2" />
              Start Canvassing
            </Button>
          </CardContent>
        </Card>

        {/* Photo Documentation */}
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Camera className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-lg">Photo Documentation</CardTitle>
            </div>
            <CardDescription>
              Capture and tag storm damage photos on-site
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline">
              View Gallery
            </Button>
          </CardContent>
        </Card>

        {/* Analytics & Reporting */}
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-lg">
                <BarChart className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-lg">Analytics & Reporting</CardTitle>
            </div>
            <CardDescription>
              Track conversion rates and canvasser performance
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline">
              View Reports
            </Button>
          </CardContent>
        </Card>

        {/* Configuration */}
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Settings className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-lg">Configuration</CardTitle>
            </div>
            <CardDescription>
              Set up forms, scripts, and canvassing workflows
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline">
              Configure
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Integration Section */}
      <Card className="border-dashed border-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Full Application Integration
          </CardTitle>
          <CardDescription>
            Storm Canvass Pro is ready to be integrated. This is a placeholder for the full canvassing application.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted/50 p-4 rounded-lg space-y-2">
            <h4 className="font-semibold text-sm">Features Coming Soon:</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                Mobile-first canvassing interface with offline support
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                GPS tracking and territory geo-fencing
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                Automated lead routing to sales pipeline
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                Storm damage assessment tools and checklists
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                Real-time team performance dashboards
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                Integrated photo documentation and annotation
              </li>
            </ul>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1">
              <Download className="mr-2 h-4 w-4" />
              Import Canvass Data
            </Button>
            <Button variant="outline" className="flex-1">
              <FileText className="mr-2 h-4 w-4" />
              View Documentation
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
