import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Package, Warehouse, History, Camera, Barcode } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InventoryItemsList } from './InventoryItemsList';
import { InventoryLocationManager } from './InventoryLocationManager';
import { InventoryTransactionLog } from './InventoryTransactionLog';

export function InventoryManager() {
  const [activeTab, setActiveTab] = useState('items');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Inventory Management</h2>
        <p className="text-muted-foreground">
          Track materials, manage stock levels, and monitor inventory across locations
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-nowrap overflow-x-auto h-auto">
          <TabsTrigger value="items" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Items & Stock
          </TabsTrigger>
          <TabsTrigger value="locations" className="flex items-center gap-2">
            <Warehouse className="h-4 w-4" />
            Locations
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Transaction History
          </TabsTrigger>
          <TabsTrigger value="scanner" className="flex items-center gap-2">
            <Barcode className="h-4 w-4" />
            Photo / UPC Scanner
          </TabsTrigger>
        </TabsList>

        <TabsContent value="items">
          <InventoryItemsList />
        </TabsContent>

        <TabsContent value="locations">
          <InventoryLocationManager />
        </TabsContent>

        <TabsContent value="history">
          <InventoryTransactionLog />
        </TabsContent>

        <TabsContent value="scanner">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="h-5 w-5" />
                Photo & UPC Scanner
              </CardTitle>
              <CardDescription>
                Coming Soon — Snap a photo or scan UPC barcode to auto-identify products
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed rounded-lg text-muted-foreground">
                <div className="flex gap-6 mb-6">
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                      <Camera className="h-8 w-8" />
                    </div>
                    <span className="text-sm font-medium">Photo Scan</span>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                      <Barcode className="h-8 w-8" />
                    </div>
                    <span className="text-sm font-medium">UPC Scan</span>
                  </div>
                </div>
                <p className="text-center max-w-md">
                  This feature will allow you to use your device camera to snap a photo of a product label
                  or scan a UPC barcode to automatically identify and add items to your inventory.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
