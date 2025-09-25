import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GitBranch, History, GitCompare, X } from "lucide-react";
import EstimateVersionHistory from './EstimateVersionHistory';
import EstimateVersionDiff from './EstimateVersionDiff';

interface EstimateVersionControlProps {
  estimateId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVersionRollback?: () => void;
}

const EstimateVersionControl = ({ 
  estimateId, 
  open, 
  onOpenChange, 
  onVersionRollback 
}: EstimateVersionControlProps) => {
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('history');

  const handleVersionSelect = (versionId: string) => {
    if (selectedVersions.includes(versionId)) {
      setSelectedVersions(prev => prev.filter(id => id !== versionId));
    } else if (selectedVersions.length < 2) {
      setSelectedVersions(prev => [...prev, versionId]);
    } else {
      // Replace oldest selection
      setSelectedVersions([selectedVersions[1], versionId]);
    }
  };

  const handleVersionCompare = (version1: string, version2: string) => {
    setSelectedVersions([version1, version2]);
    setActiveTab('diff');
  };

  const handleVersionRollback = (versionId: string) => {
    setSelectedVersions([]);
    onVersionRollback?.();
  };

  const clearSelection = () => {
    setSelectedVersions([]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              Estimate Version Control
            </DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
          <div className="flex items-center justify-between mb-4">
            <TabsList>
              <TabsTrigger value="history" className="flex items-center gap-2">
                <History className="h-4 w-4" />
                History
              </TabsTrigger>
              <TabsTrigger 
                value="diff" 
                className="flex items-center gap-2"
                disabled={selectedVersions.length < 2}
              >
                <GitCompare className="h-4 w-4" />
                Compare ({selectedVersions.length}/2)
              </TabsTrigger>
            </TabsList>

            {selectedVersions.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {selectedVersions.length} version{selectedVersions.length > 1 ? 's' : ''} selected
                </span>
                <Button variant="outline" size="sm" onClick={clearSelection}>
                  Clear Selection
                </Button>
              </div>
            )}
          </div>

          <TabsContent value="history" className="flex-1">
            <EstimateVersionHistory
              estimateId={estimateId}
              onVersionSelect={handleVersionSelect}
              onVersionCompare={handleVersionCompare}
              onVersionRollback={handleVersionRollback}
            />
          </TabsContent>

          <TabsContent value="diff" className="flex-1">
            {selectedVersions.length >= 2 ? (
              <EstimateVersionDiff
                version1Id={selectedVersions[0]}
                version2Id={selectedVersions[1]}
              />
            ) : (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <GitCompare className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Select two versions from the History tab to compare
                  </p>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default EstimateVersionControl;