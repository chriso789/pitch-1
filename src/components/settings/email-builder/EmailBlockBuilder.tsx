import { useState, useCallback } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, GripVertical, Plus, Monitor, Smartphone } from "lucide-react";
import { EMAIL_BLOCKS, BLOCK_CATEGORIES, generateEmailHtml } from "./emailBlocks";
import { EmailBlockProperties } from "./EmailBlockProperties";

interface PlacedBlock {
  id: string;
  type: string;
  props: Record<string, any>;
}

interface EmailBlockBuilderProps {
  onHtmlChange: (html: string) => void;
  initialHtml?: string;
}

function SortableBlock({ 
  block, 
  isSelected, 
  onSelect, 
  onDelete 
}: { 
  block: PlacedBlock; 
  isSelected: boolean; 
  onSelect: () => void; 
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: block.id });
  const blockDef = EMAIL_BLOCKS[block.type];
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative border rounded-lg p-3 mb-2 cursor-pointer transition-all ${
        isSelected ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border hover:border-primary/50'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <div {...attributes} {...listeners} className="cursor-grab hover:bg-muted rounded p-1">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
        <span className="text-sm font-medium flex-1">{blockDef?.name || block.type}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

export function EmailBlockBuilder({ onHtmlChange, initialHtml }: EmailBlockBuilderProps) {
  const [blocks, setBlocks] = useState<PlacedBlock[]>([
    { id: 'header-1', type: 'header', props: { ...EMAIL_BLOCKS.header.defaultProps } },
    { id: 'text-1', type: 'text', props: { content: 'Hi {{first_name}},', color: '#1e3a5f', fontSize: '18' } },
    { id: 'text-2', type: 'text', props: { ...EMAIL_BLOCKS.text.defaultProps } },
    { id: 'button-1', type: 'button', props: { ...EMAIL_BLOCKS.button.defaultProps } },
    { id: 'footer-1', type: 'footer', props: { ...EMAIL_BLOCKS.footer.defaultProps } },
  ]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const selectedBlock = blocks.find(b => b.id === selectedBlockId);

  const updateHtml = useCallback((newBlocks: PlacedBlock[]) => {
    const html = generateEmailHtml(newBlocks);
    onHtmlChange(html);
  }, [onHtmlChange]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setBlocks((items) => {
        const oldIndex = items.findIndex(i => i.id === active.id);
        const newIndex = items.findIndex(i => i.id === over.id);
        const newItems = arrayMove(items, oldIndex, newIndex);
        updateHtml(newItems);
        return newItems;
      });
    }
  };

  const addBlock = (type: string) => {
    const blockDef = EMAIL_BLOCKS[type];
    if (!blockDef) return;
    
    const newBlock: PlacedBlock = {
      id: `${type}-${Date.now()}`,
      type,
      props: { ...blockDef.defaultProps },
    };
    
    const newBlocks = [...blocks, newBlock];
    setBlocks(newBlocks);
    setSelectedBlockId(newBlock.id);
    updateHtml(newBlocks);
  };

  const deleteBlock = (id: string) => {
    const newBlocks = blocks.filter(b => b.id !== id);
    setBlocks(newBlocks);
    if (selectedBlockId === id) setSelectedBlockId(null);
    updateHtml(newBlocks);
  };

  const updateBlockProps = (id: string, props: Record<string, any>) => {
    const newBlocks = blocks.map(b => b.id === id ? { ...b, props } : b);
    setBlocks(newBlocks);
    updateHtml(newBlocks);
  };

  const previewHtml = generateEmailHtml(blocks)
    .replace(/\{\{first_name\}\}/g, 'John')
    .replace(/\{\{company_name\}\}/g, 'ABC Roofing')
    .replace(/\{\{action_url\}\}/g, 'https://pitch-crm.ai')
    .replace(/\{\{login_url\}\}/g, 'https://pitch-crm.ai/login');

  return (
    <div className="grid grid-cols-12 gap-4 h-[600px]">
      {/* Block Library - Left */}
      <div className="col-span-3">
        <Card className="h-full">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Block Library</CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <ScrollArea className="h-[520px]">
              {BLOCK_CATEGORIES.map(category => (
                <div key={category.id} className="mb-4">
                  <p className="text-xs font-medium text-muted-foreground mb-2 px-2">{category.name}</p>
                  <div className="space-y-1">
                    {Object.values(EMAIL_BLOCKS)
                      .filter(block => block.category === category.id)
                      .map(block => (
                        <Button
                          key={block.id}
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start text-xs h-8"
                          onClick={() => addBlock(block.type)}
                        >
                          <Plus className="h-3 w-3 mr-2" />
                          {block.name}
                        </Button>
                      ))}
                  </div>
                </div>
              ))}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Canvas - Center */}
      <div className="col-span-5">
        <Card className="h-full">
          <CardHeader className="py-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Email Structure</CardTitle>
            <span className="text-xs text-muted-foreground">{blocks.length} blocks</span>
          </CardHeader>
          <CardContent className="p-2">
            <ScrollArea className="h-[520px] pr-3">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
                  {blocks.map(block => (
                    <SortableBlock
                      key={block.id}
                      block={block}
                      isSelected={selectedBlockId === block.id}
                      onSelect={() => setSelectedBlockId(block.id)}
                      onDelete={() => deleteBlock(block.id)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              
              {blocks.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <p className="text-sm">No blocks added yet</p>
                  <p className="text-xs mt-1">Click blocks from the library to add them</p>
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Properties & Preview - Right */}
      <div className="col-span-4 flex flex-col gap-4">
        {/* Properties */}
        <Card className="flex-1">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">
              {selectedBlock ? `Edit: ${EMAIL_BLOCKS[selectedBlock.type]?.name}` : 'Block Properties'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            {selectedBlock ? (
              <EmailBlockProperties
                block={selectedBlock}
                onUpdate={(props) => updateBlockProps(selectedBlock.id, props)}
              />
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                Select a block to edit its properties
              </p>
            )}
          </CardContent>
        </Card>

        {/* Mini Preview */}
        <Card>
          <CardHeader className="py-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs">Preview</CardTitle>
            <div className="flex gap-1">
              <Button
                variant={previewMode === 'desktop' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-6 w-6"
                onClick={() => setPreviewMode('desktop')}
              >
                <Monitor className="h-3 w-3" />
              </Button>
              <Button
                variant={previewMode === 'mobile' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-6 w-6"
                onClick={() => setPreviewMode('mobile')}
              >
                <Smartphone className="h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-2">
            <div className={`border rounded overflow-hidden bg-muted/30 mx-auto transition-all ${
              previewMode === 'mobile' ? 'max-w-[200px]' : 'w-full'
            }`}>
              <iframe
                srcDoc={previewHtml}
                className="w-full h-[180px] border-0"
                title="Email Preview"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
