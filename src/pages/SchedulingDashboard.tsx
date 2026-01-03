import React from 'react';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { AppointmentCalendar } from '@/components/scheduling/AppointmentCalendar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar, Sparkles } from 'lucide-react';
import { useUserProfile } from '@/contexts/UserProfileContext';

const SchedulingDashboard = () => {
  const { profile } = useUserProfile();

  return (
    <GlobalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scheduling</h1>
          <p className="text-muted-foreground">
            AI-powered appointment scheduling with intelligent time suggestions
          </p>
        </div>

        <Tabs defaultValue="calendar" className="space-y-4">
          <TabsList>
            <TabsTrigger value="calendar" className="gap-2">
              <Calendar className="h-4 w-4" />
              Calendar
            </TabsTrigger>
            <TabsTrigger value="ai-scheduler" className="gap-2">
              <Sparkles className="h-4 w-4" />
              AI Scheduler
            </TabsTrigger>
          </TabsList>

          <TabsContent value="calendar">
            <AppointmentCalendar tenantId={profile?.tenant_id} />
          </TabsContent>

          <TabsContent value="ai-scheduler">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Quick Schedule</CardTitle>
                  <CardDescription>
                    Select a contact to get AI-powered scheduling suggestions
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Use the AI Scheduler from a contact or job page to get intelligent appointment time suggestions based on:
                  </p>
                  <ul className="mt-4 space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-primary" />
                      Current weather conditions and forecast
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-primary" />
                      Canvasser location and travel time
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-primary" />
                      Homeowner time preferences
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-primary" />
                      Existing calendar availability
                    </li>
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Scheduling Stats</CardTitle>
                  <CardDescription>
                    Your scheduling performance this month
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-4 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold">--</div>
                      <div className="text-sm text-muted-foreground">Appointments Set</div>
                    </div>
                    <div className="text-center p-4 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold">--</div>
                      <div className="text-sm text-muted-foreground">AI Scheduled</div>
                    </div>
                    <div className="text-center p-4 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold">--</div>
                      <div className="text-sm text-muted-foreground">Show Rate</div>
                    </div>
                    <div className="text-center p-4 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold">--</div>
                      <div className="text-sm text-muted-foreground">Avg Score</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </GlobalLayout>
  );
};

export default SchedulingDashboard;
