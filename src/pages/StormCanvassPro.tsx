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
  Settings
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
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
        {/* Field Canvassing */}
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Map className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-lg">Field Canvassing</CardTitle>
            </div>
            <CardDescription>
              Territory mapping with real-time GPS tracking and mobile-optimized lead capture
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              className="w-full" 
              size="lg"
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
            <Button 
              className="w-full" 
              variant="outline"
              onClick={() => navigate('/storm-canvass/dashboard')}
            >
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
    </div>
  );
}