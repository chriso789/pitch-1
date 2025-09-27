import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useErrorTracking } from "@/hooks/useErrorTracking";
import { Copy, Target, Code, MessageSquare, Bug, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface DeveloperSnippetToolProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DeveloperSnippetTool: React.FC<DeveloperSnippetToolProps> = ({ isOpen, onClose }) => {
  const [selectedElement, setSelectedElement] = useState<HTMLElement | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [comments, setComments] = useState('');
  const [generatedSnippet, setGeneratedSnippet] = useState('');
  const [elementInfo, setElementInfo] = useState<any>(null);
  const { trackButtonClick } = useErrorTracking();
  const { toast } = useToast();
  const overlayRef = useRef<HTMLDivElement>(null);

  // Element selection functionality
  const handleElementSelection = (e: MouseEvent) => {
    if (!isSelecting) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const target = e.target as HTMLElement;
    if (target && !target.closest('.developer-tool-modal')) {
      setSelectedElement(target);
      setIsSelecting(false);
      analyzeElement(target);
    }
  };

  const analyzeElement = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const styles = window.getComputedStyle(element);
    const classes = element.className;
    const tagName = element.tagName.toLowerCase();
    const textContent = element.textContent?.trim();
    const id = element.id;
    
    // Check if it's likely a button or interactive element
    const isInteractive = ['button', 'a', 'input', 'select', 'textarea'].includes(tagName) ||
                         element.getAttribute('role') === 'button' ||
                         classes.includes('btn') ||
                         classes.includes('button');

    const info = {
      tagName,
      id,
      classes,
      textContent,
      isInteractive,
      position: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      },
      styles: {
        backgroundColor: styles.backgroundColor,
        color: styles.color,
        fontSize: styles.fontSize,
        padding: styles.padding,
        margin: styles.margin
      },
      attributes: Array.from(element.attributes).reduce((acc, attr) => {
        acc[attr.name] = attr.value;
        return acc;
      }, {} as Record<string, string>)
    };

    setElementInfo(info);
    generateCodeSnippet(info);
  };

  const generateCodeSnippet = (info: any) => {
    const { tagName, classes, textContent, attributes, isInteractive } = info;
    
    let snippet = `// Element Analysis\n`;
    snippet += `// Tag: ${tagName}\n`;
    snippet += `// Classes: ${classes}\n`;
    snippet += `// Text: ${textContent}\n`;
    snippet += `// Interactive: ${isInteractive}\n\n`;
    
    if (isInteractive) {
      snippet += `// Potential Issues:\n`;
      if (!attributes.onClick && !attributes.href) {
        snippet += `// - No click handler or href attribute detected\n`;
      }
      if (!attributes['aria-label'] && !textContent) {
        snippet += `// - Missing accessibility label\n`;
      }
      snippet += `\n// Suggested Fix:\n`;
      snippet += `<${tagName}\n`;
      snippet += `  className="${classes}"\n`;
      if (!attributes.onClick) {
        snippet += `  onClick={() => {\n`;
        snippet += `    // Add your click handler here\n`;
        snippet += `    console.log('Button clicked:', '${textContent}');\n`;
        snippet += `  }}\n`;
      }
      if (!attributes['aria-label'] && textContent) {
        snippet += `  aria-label="${textContent}"\n`;
      }
      snippet += `>\n`;
      snippet += `  ${textContent || 'Button Text'}\n`;
      snippet += `</${tagName}>`;
    } else {
      snippet += `// Element Structure:\n`;
      snippet += `<${tagName} className="${classes}">\n`;
      snippet += `  ${textContent || 'Content'}\n`;
      snippet += `</${tagName}>`;
    }
    
    setGeneratedSnippet(snippet);
  };

  const startSelection = () => {
    setIsSelecting(true);
    toast({
      title: "Element Selection Mode",
      description: "Click on any element to analyze it",
    });
  };

  const copySnippet = () => {
    navigator.clipboard.writeText(generatedSnippet);
    toast({
      title: "Copied to clipboard",
      description: "Code snippet copied successfully",
    });
  };

  const markAsFixed = () => {
    if (elementInfo && elementInfo.isInteractive) {
      // This would integrate with the existing error tracking system
      trackButtonClick(selectedElement!, 'success', 'Fixed via developer tool');
      toast({
        title: "Marked as Fixed",
        description: "Element has been marked as functioning correctly",
        variant: "default",
      });
    }
  };

  useEffect(() => {
    if (isSelecting) {
      document.addEventListener('click', handleElementSelection, true);
      document.body.style.cursor = 'crosshair';
      
      return () => {
        document.removeEventListener('click', handleElementSelection, true);
        document.body.style.cursor = 'default';
      };
    }
  }, [isSelecting]);

  // Highlight selected element
  useEffect(() => {
    if (selectedElement) {
      selectedElement.style.outline = '2px solid #3b82f6';
      selectedElement.style.outlineOffset = '2px';
      
      return () => {
        selectedElement.style.outline = '';
        selectedElement.style.outlineOffset = '';
      };
    }
  }, [selectedElement]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="developer-tool-modal max-w-4xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            Developer Snippet Tool
            <Badge variant="secondary">Ctrl + Alt + E</Badge>
          </DialogTitle>
        </DialogHeader>
        
        <Tabs defaultValue="selector" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="selector">Element Selector</TabsTrigger>
            <TabsTrigger value="analysis">Analysis</TabsTrigger>
            <TabsTrigger value="comments">Comments & Notes</TabsTrigger>
          </TabsList>
          
          <TabsContent value="selector" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Element Selection
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Button 
                    onClick={startSelection} 
                    disabled={isSelecting}
                    variant={isSelecting ? "secondary" : "default"}
                  >
                    {isSelecting ? "Selecting..." : "Start Selection"}
                  </Button>
                  {selectedElement && (
                    <Button onClick={() => setSelectedElement(null)} variant="outline">
                      Clear Selection
                    </Button>
                  )}
                </div>
                
                {selectedElement && (
                  <div className="p-4 bg-muted rounded-lg">
                    <h4 className="font-medium mb-2">Selected Element:</h4>
                    <p className="text-sm text-muted-foreground">
                      {elementInfo?.tagName?.toUpperCase()} - "{elementInfo?.textContent}"
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Classes: {elementInfo?.classes}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="analysis" className="space-y-4">
            {elementInfo ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Bug className="h-4 w-4" />
                      Element Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <h4 className="font-medium">Basic Info</h4>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          <li>Tag: {elementInfo.tagName}</li>
                          <li>Interactive: {elementInfo.isInteractive ? 'Yes' : 'No'}</li>
                          <li>ID: {elementInfo.id || 'None'}</li>
                          <li>Text: {elementInfo.textContent || 'None'}</li>
                        </ul>
                      </div>
                      <div>
                        <h4 className="font-medium">Position</h4>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          <li>Width: {Math.round(elementInfo.position.width)}px</li>
                          <li>Height: {Math.round(elementInfo.position.height)}px</li>
                          <li>Top: {Math.round(elementInfo.position.top)}px</li>
                          <li>Left: {Math.round(elementInfo.position.left)}px</li>
                        </ul>
                      </div>
                    </div>
                    
                    <div>
                      <h4 className="font-medium mb-2">Generated Code Snippet</h4>
                      <div className="relative">
                        <pre className="bg-muted p-4 rounded-lg text-xs overflow-auto max-h-64">
                          <code>{generatedSnippet}</code>
                        </pre>
                        <Button
                          size="sm"
                          variant="outline"
                          className="absolute top-2 right-2"
                          onClick={copySnippet}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    
                    {elementInfo.isInteractive && (
                      <div className="flex gap-2">
                        <Button onClick={markAsFixed} variant="outline" size="sm">
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Mark as Fixed
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Select an element first to see detailed analysis</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
          
          <TabsContent value="comments" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Developer Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  placeholder="Add your comments, notes, or fix descriptions here..."
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  rows={8}
                />
                <div className="flex gap-2">
                  <Button 
                    onClick={() => {
                      localStorage.setItem('dev-comments', comments);
                      toast({
                        title: "Comments Saved",
                        description: "Your notes have been saved locally",
                      });
                    }}
                    variant="outline"
                  >
                    Save Notes
                  </Button>
                  <Button 
                    onClick={() => {
                      const saved = localStorage.getItem('dev-comments');
                      if (saved) setComments(saved);
                    }}
                    variant="outline"
                  >
                    Load Saved
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};