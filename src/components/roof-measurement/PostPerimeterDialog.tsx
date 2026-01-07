import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Sparkles, 
  PenTool, 
  CheckCircle, 
  ArrowRight,
  Ruler
} from 'lucide-react';

interface PostPerimeterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  areaSqFt: number;
  vertexCount: number;
  onAIAnalyze: () => void;
  onDrawManually: () => void;
  onDone: () => void;
  isAnalyzing?: boolean;
}

export function PostPerimeterDialog({
  open,
  onOpenChange,
  areaSqFt,
  vertexCount,
  onAIAnalyze,
  onDrawManually,
  onDone,
  isAnalyzing = false,
}: PostPerimeterDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Perimeter Saved
          </DialogTitle>
          <DialogDescription>
            What would you like to do next?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Summary */}
          <div className="flex gap-3 p-3 bg-muted rounded-lg">
            <div className="flex-1 text-center">
              <div className="text-2xl font-bold text-primary">
                {areaSqFt.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">Sq Ft</div>
            </div>
            <div className="flex-1 text-center border-l">
              <div className="text-2xl font-bold">
                {vertexCount}
              </div>
              <div className="text-xs text-muted-foreground">Vertices</div>
            </div>
            <div className="flex-1 text-center border-l">
              <div className="text-2xl font-bold">
                {(areaSqFt / 100).toFixed(1)}
              </div>
              <div className="text-xs text-muted-foreground">Squares</div>
            </div>
          </div>

          {/* Options */}
          <div className="space-y-3">
            {/* AI Analyze - Recommended */}
            <Button
              variant="default"
              size="lg"
              className="w-full justify-start h-auto py-4"
              onClick={onAIAnalyze}
              disabled={isAnalyzing}
            >
              <div className="flex items-start gap-3 w-full">
                <div className="h-10 w-10 rounded-lg bg-primary-foreground/20 flex items-center justify-center">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">AI Auto-Detect</span>
                    <Badge variant="secondary" className="text-[10px]">Recommended</Badge>
                  </div>
                  <p className="text-sm text-primary-foreground/70 mt-0.5">
                    Let AI analyze and draw ridge, hip, and valley lines
                  </p>
                </div>
                <ArrowRight className="h-5 w-5 mt-2.5" />
              </div>
            </Button>

            {/* Draw Manually */}
            <Button
              variant="outline"
              size="lg"
              className="w-full justify-start h-auto py-4"
              onClick={onDrawManually}
              disabled={isAnalyzing}
            >
              <div className="flex items-start gap-3 w-full">
                <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                  <PenTool className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 text-left">
                  <span className="font-semibold">Draw Manually</span>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Continue drawing ridge, hip, and valley lines yourself
                  </p>
                </div>
                <ArrowRight className="h-5 w-5 mt-2.5 text-muted-foreground" />
              </div>
            </Button>

            {/* Done */}
            <Button
              variant="ghost"
              size="lg"
              className="w-full justify-start h-auto py-4"
              onClick={onDone}
              disabled={isAnalyzing}
            >
              <div className="flex items-start gap-3 w-full">
                <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                  <Ruler className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 text-left">
                  <span className="font-semibold">Done - Save as Area Only</span>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Save perimeter measurement without detailed skeleton
                  </p>
                </div>
              </div>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PostPerimeterDialog;
