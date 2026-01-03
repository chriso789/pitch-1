import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Map, Users, Route, ClipboardList } from "lucide-react";
import { DispatchMap } from "@/components/dispatch/DispatchMap";
import { LiveCrewTracker } from "@/components/dispatch/LiveCrewTracker";
import { JobAssignmentBoard } from "@/components/dispatch/JobAssignmentBoard";
import { CrewRouteOptimizer } from "@/components/dispatch/CrewRouteOptimizer";

const DispatchDashboard = () => {
  const [activeTab, setActiveTab] = useState("map");
  const [selectedCrewId, setSelectedCrewId] = useState<string | null>(null);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Crew Dispatch Center</h1>
            <p className="text-muted-foreground">Real-time crew tracking and job assignment</p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Crew Tracker */}
        <div className="w-80 border-r bg-card overflow-y-auto">
          <LiveCrewTracker 
            onCrewSelect={setSelectedCrewId}
            selectedCrewId={selectedCrewId}
          />
        </div>

        {/* Main Area */}
        <div className="flex-1 flex flex-col">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <TabsList className="w-full justify-start rounded-none border-b bg-card px-4 h-12 shrink-0">
              <TabsTrigger value="map" className="flex items-center gap-2">
                <Map className="h-4 w-4" />
                Live Map
              </TabsTrigger>
              <TabsTrigger value="assignments" className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4" />
                Job Assignments
              </TabsTrigger>
              <TabsTrigger value="routes" className="flex items-center gap-2">
                <Route className="h-4 w-4" />
                Route Optimizer
              </TabsTrigger>
            </TabsList>

            <TabsContent value="map" className="flex-1 mt-0 relative">
              <DispatchMap 
                selectedCrewId={selectedCrewId}
                onCrewSelect={setSelectedCrewId}
              />
            </TabsContent>

            <TabsContent value="assignments" className="flex-1 mt-0 p-4 overflow-auto">
              <JobAssignmentBoard />
            </TabsContent>

            <TabsContent value="routes" className="flex-1 mt-0 p-4 overflow-auto">
              <CrewRouteOptimizer selectedCrewId={selectedCrewId} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default DispatchDashboard;
