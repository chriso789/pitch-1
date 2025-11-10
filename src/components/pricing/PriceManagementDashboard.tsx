import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PriceSyncControls } from "./PriceSyncControls";
import { PriceSyncHistory } from "./PriceSyncHistory";
import { PriceAnalytics } from "./PriceAnalytics";
import { DollarSign, History, TrendingUp } from "lucide-react";

export const PriceManagementDashboard = () => {
  const [activeTab, setActiveTab] = useState("sync");

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Price Management</h1>
        <p className="text-muted-foreground mt-2">
          Manage real-time pricing updates from SRS and other vendors
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="sync" className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Sync Controls
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Sync History
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sync" className="space-y-6">
          <PriceSyncControls />
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <PriceSyncHistory />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          <PriceAnalytics />
        </TabsContent>
      </Tabs>
    </div>
  );
};
