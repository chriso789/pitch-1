import React, { useEffect, useRef, useState, useCallback } from "react";
import { Canvas as FabricCanvas, Rect, FabricText, FabricObject, FabricImage } from "fabric";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { 
  X, 
  Save, 
  Trash2, 
  Search, 
  Tag as TagIcon,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  RefreshCw
} from "lucide-react";
import { loadPDFFromArrayBuffer, renderPageToDataUrl, isPDF, clearPageCache, type PDFDocumentProxy } from "@/lib/pdfRenderer";
import { resolveStorageBucket } from "@/lib/documents/resolveStorageBucket";

interface TagPlacement {
  id?: string;
  tag_key: string;
  page_number: number;
  x_position: number;
  y_position: number;
  width: number;
  height: number;
  font_size: number;
  font_family: string;
  text_align: string;
}

interface DocumentTagEditorProps {
  document: {
    id: string;
    filename: string;
    file_path: string;
    mime_type?: string;
    document_type?: string;
  };
  onClose: () => void;
  onSave: () => void;
}

// Available smart tags grouped by category
const SMART_TAG_CATEGORIES = {
  Contact: [
    { key: "contact.first_name", label: "First Name" },
    { key: "contact.last_name", label: "Last Name" },
    { key: "contact.full_name", label: "Full Name" },
    { key: "contact.email", label: "Email" },
    { key: "contact.phone", label: "Phone" },
    { key: "contact.address", label: "Address" },
    { key: "contact.city", label: "City" },
    { key: "contact.state", label: "State" },
    { key: "contact.zip", label: "ZIP Code" },
    { key: "contact.county", label: "County" },
    { key: "contact.company_name", label: "Company Name" },
    { key: "contact.secondary_phone", label: "Secondary Phone" },
    { key: "contact.lead_source", label: "Lead Source" },
    { key: "contact.notes", label: "Notes" },
  ],
  Project: [
    { key: "project.name", label: "Project Name" },
    { key: "project.address", label: "Project Address" },
    { key: "project.status", label: "Status" },
    { key: "project.created_date", label: "Created Date" },
    { key: "project.estimated_value", label: "Estimated Value" },
    { key: "project.expected_close_date", label: "Expected Close" },
    { key: "project.priority", label: "Priority" },
    { key: "project.roof_type", label: "Roof Type" },
    { key: "project.lead_number", label: "Lead Number" },
    { key: "project.notes", label: "Project Notes" },
  ],
  Estimate: [
    { key: "estimate.total", label: "Total Amount" },
    { key: "estimate.subtotal", label: "Subtotal" },
    { key: "estimate.tax", label: "Tax" },
    { key: "estimate.number", label: "Estimate #" },
    { key: "estimate.material_cost", label: "Material Cost" },
    { key: "estimate.labor_cost", label: "Labor Cost" },
    { key: "estimate.selling_price", label: "Selling Price" },
    { key: "estimate.profit", label: "Profit" },
    { key: "estimate.margin_percent", label: "Margin %" },
    { key: "estimate.valid_until", label: "Valid Until" },
    { key: "estimate.status", label: "Status" },
    { key: "estimate.monthly_payment", label: "Monthly Payment" },
  ],
  Measurement: [
    { key: "measurement.total_sqft", label: "Total Sq Ft" },
    { key: "measurement.total_squares", label: "Total Squares" },
    { key: "measurement.ridge_lf", label: "Ridge LF" },
    { key: "measurement.hip_lf", label: "Hip LF" },
    { key: "measurement.valley_lf", label: "Valley LF" },
    { key: "measurement.eave_lf", label: "Eave LF" },
    { key: "measurement.rake_lf", label: "Rake LF" },
    { key: "measurement.predominant_pitch", label: "Predominant Pitch" },
    { key: "measurement.total_facets", label: "Number of Faces" },
  ],
  Company: [
    { key: "company.name", label: "Company Name" },
    { key: "company.phone", label: "Company Phone" },
    { key: "company.email", label: "Company Email" },
    { key: "company.address", label: "Company Address" },
    { key: "company.city", label: "City" },
    { key: "company.state", label: "State" },
    { key: "company.zip", label: "ZIP Code" },
    { key: "company.website", label: "Website" },
    { key: "company.license_number", label: "License Number" },
    { key: "company.owner_name", label: "Owner Name" },
  ],
  "Sales Rep": [
    { key: "rep.name", label: "Rep Full Name" },
    { key: "rep.first_name", label: "Rep First Name" },
    { key: "rep.last_name", label: "Rep Last Name" },
    { key: "rep.email", label: "Rep Email" },
    { key: "rep.phone", label: "Rep Phone" },
    { key: "rep.title", label: "Rep Title" },
  ],
  Insurance: [
    { key: "insurance.claim_number", label: "Claim Number" },
    { key: "insurance.carrier", label: "Insurance Carrier" },
    { key: "insurance.adjuster_name", label: "Adjuster Name" },
    { key: "insurance.adjuster_phone", label: "Adjuster Phone" },
    { key: "insurance.date_of_loss", label: "Date of Loss" },
    { key: "insurance.deductible", label: "Deductible" },
  ],
  Date: [
    { key: "today.date", label: "Today's Date" },
    { key: "today.date_long", label: "Today (Long)" },
    { key: "today.time", label: "Current Time" },
    { key: "today.year", label: "Current Year" },
    { key: "today.month", label: "Current Month" },
    { key: "today.weekday", label: "Current Weekday" },
  ],
};

export const DocumentTagEditor: React.FC<DocumentTagEditorProps> = ({
  document,
  onClose,
  onSave,
}) => {
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [allPlacements, setAllPlacements] = useState<TagPlacement[]>([]);
  const [selectedObject, setSelectedObject] = useState<FabricObject | null>(null);
  const [zoom, setZoom] = useState(1);
  const [tenantId, setTenantId] = useState<string | null>(null);
  
  // PDF-specific state
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageRendering, setPageRendering] = useState(false);
  const [isDocumentPdf, setIsDocumentPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  
  // Helper to check if canvas is valid (not disposed)
  const isCanvasValid = (canvas: FabricCanvas | null): boolean => {
    if (!canvas) return false;
    try {
      // If lowerCanvasEl is missing, canvas was disposed
      return !!(canvas as any).lowerCanvasEl;
    } catch {
      return false;
    }
  };
  
  // Callback ref for canvas - ensures Fabric initializes when DOM is ready
  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    if (node && !fabricCanvas) {
      console.log("[TagEditor] Canvas node mounted, initializing Fabric...");
      const canvas = new FabricCanvas(node, {
        width: 800,
        height: 1000,
        backgroundColor: "#f5f5f5",
      });

      // Selection events
      canvas.on("selection:created", (e) => {
        setSelectedObject(e.selected?.[0] || null);
      });

      canvas.on("selection:updated", (e) => {
        setSelectedObject(e.selected?.[0] || null);
      });

      canvas.on("selection:cleared", () => {
        setSelectedObject(null);
      });

      setFabricCanvas(canvas);
      setCanvasReady(true);
      console.log("[TagEditor] ✅ Fabric canvas initialized");
    }
  }, [fabricCanvas]);

  // Load tenant ID
  useEffect(() => {
    const loadTenantId = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("tenant_id")
          .eq("id", user.id)
          .single();
        if (profile?.tenant_id) {
          setTenantId(profile.tenant_id);
        }
      }
    };
    loadTenantId();
  }, []);

  // PDF Blob state - we store the blob and create fresh ArrayBuffer each time
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);

  // Load document and existing placements
  useEffect(() => {
    const loadDocumentData = async () => {
      setLoading(true);
      setPdfError(null);
      
      // Determine the correct storage bucket
      const bucket = resolveStorageBucket(document.document_type, document.file_path);
      console.log(`[TagEditor] Loading from bucket: ${bucket}, path: ${document.file_path}`);
      
      try {
        // Check if it's a PDF
        const isPdfDoc = isPDF(document.mime_type, document.filename);
        setIsDocumentPdf(isPdfDoc);

        if (isPdfDoc) {
          // Download PDF as blob to bypass CORS issues
          const { data: blobData, error: downloadError } = await supabase.storage
            .from(bucket)
            .download(document.file_path);

          if (downloadError) {
            console.error("❌ Failed to download PDF:", downloadError);
            throw downloadError;
          }

          console.log("✅ PDF downloaded, size:", blobData.size);
          // Store blob - we'll create fresh ArrayBuffer when loading
          setPdfBlob(blobData);
        } else {
          // For images, use signed URL
          const { data: urlData, error: urlError } = await supabase.storage
            .from(bucket)
            .createSignedUrl(document.file_path, 3600);

          if (urlError) throw urlError;
          setDocumentUrl(urlData.signedUrl);
        }

        // Load existing tag placements
        const { data: existingPlacements, error: placementsError } = await supabase
          .from("document_tag_placements")
          .select("*")
          .eq("document_id", document.id);

        if (placementsError) throw placementsError;

        if (existingPlacements && existingPlacements.length > 0) {
          setAllPlacements(existingPlacements.map(p => ({
            id: p.id,
            tag_key: p.tag_key,
            page_number: p.page_number || 1,
            x_position: Number(p.x_position),
            y_position: Number(p.y_position),
            width: Number(p.width),
            height: Number(p.height),
            font_size: p.font_size || 12,
            font_family: p.font_family || "Arial",
            text_align: p.text_align || "left",
          })));
        }
      } catch (error) {
        console.error("Error loading document:", error);
        toast.error("Failed to load document");
      } finally {
        setLoading(false);
      }
    };

    loadDocumentData();
    
    // Cleanup
    return () => {
      clearPageCache();
    };
  }, [document]);

  // Cleanup Fabric canvas on unmount
  useEffect(() => {
    return () => {
      if (fabricCanvas) {
        setCanvasReady(false);
        fabricCanvas.dispose();
        setFabricCanvas(null);
      }
    };
  }, [fabricCanvas]);

  // Load PDF from Blob when canvas is ready
  useEffect(() => {
    if (!pdfBlob || !fabricCanvas || !isDocumentPdf || !canvasReady) return;
    if (!isCanvasValid(fabricCanvas)) {
      console.warn("[TagEditor] Canvas not valid, skipping PDF load");
      return;
    }

    const loadPdfContent = async () => {
      setPageRendering(true);
      setPdfError(null);
      
      try {
        // Create fresh ArrayBuffer from blob each time (avoids detached buffer issue)
        const arrayBuffer = await pdfBlob.arrayBuffer();
        console.log("📄 Starting PDF load, ArrayBuffer size:", arrayBuffer.byteLength);
        
        // Load PDF from ArrayBuffer (bypasses CORS)
        const pdf = await loadPDFFromArrayBuffer(arrayBuffer);
        console.log("✅ PDF loaded successfully, pages:", pdf.numPages);
        setPdfDocument(pdf);
        setTotalPages(pdf.numPages);
        setCurrentPage(1);
        
        // Render first page
        await renderPdfPage(pdf, 1);
      } catch (error) {
        console.error("❌ Error loading PDF:", error);
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        setPdfError(`Failed to load PDF: ${errorMsg}`);
        toast.error("Failed to load PDF. Please try again.");
      } finally {
        setPageRendering(false);
      }
    };

    loadPdfContent();
  }, [pdfBlob, fabricCanvas, isDocumentPdf, canvasReady]);

  // Load image when URL is available and canvas is ready
  useEffect(() => {
    if (!documentUrl || !fabricCanvas || isDocumentPdf || !canvasReady) return;

    const loadImageContent = async () => {
      setPageRendering(true);
      
      try {
        await loadImage(documentUrl);
      } catch (error) {
        console.error("Error loading image:", error);
        toast.error("Failed to load image. Please try again.");
      } finally {
        setPageRendering(false);
      }
    };

    loadImageContent();
  }, [documentUrl, fabricCanvas, isDocumentPdf, canvasReady]);

  // Render PDF page to canvas
  const renderPdfPage = async (pdf: PDFDocumentProxy, pageNum: number) => {
    if (!fabricCanvas || !isCanvasValid(fabricCanvas)) {
      console.warn("[TagEditor] Canvas not valid, skipping page render");
      return;
    }
    
    setPageRendering(true);
    setPdfError(null);
    console.log(`📄 Rendering PDF page ${pageNum}...`);
    
    try {
      // Clear existing objects (tags) temporarily
      const existingTags = collectCurrentPageTags();
      fabricCanvas.clear();
      fabricCanvas.backgroundColor = "#f5f5f5";
      
      // Render PDF page to data URL
      let rendered;
      try {
        rendered = await renderPageToDataUrl(pdf, pageNum, 1.5);
        console.log(`✅ Page ${pageNum} rendered to data URL, size: ${rendered.width}x${rendered.height}`);
      } catch (renderErr) {
        console.error("❌ PDF page render failed:", renderErr);
        setPdfError("Failed to render PDF page. The file may be corrupted.");
        setPageRendering(false);
        return;
      }
      
      // Update canvas dimensions FIRST
      fabricCanvas.setWidth(rendered.width);
      fabricCanvas.setHeight(rendered.height);
      
      // Load image using native Image element first for reliability
      const img = await new Promise<FabricImage>((resolve, reject) => {
        const imgEl = new Image();
        imgEl.onload = async () => {
          try {
            console.log("✅ Image element loaded, creating FabricImage...");
            const fabricImg = new FabricImage(imgEl);
            resolve(fabricImg);
          } catch (e) {
            reject(e);
          }
        };
        imgEl.onerror = (e) => {
          console.error("❌ Image element failed to load:", e);
          reject(new Error("Failed to load rendered page image"));
        };
        imgEl.src = rendered.dataUrl;
      });
      
      // Set as background using proper Fabric.js 6.x method
      await fabricCanvas.set('backgroundImage', img);
      fabricCanvas.requestRenderAll();
      console.log(`✅ Page ${pageNum} displayed on canvas, dimensions: ${fabricCanvas.width}x${fabricCanvas.height}`);
      
      // Save current page tags before switching
      if (existingTags.length > 0) {
        updatePlacementsForPage(currentPage, existingTags);
      }
      
      // Load tags for the new page
      const pagePlacements = allPlacements.filter(p => p.page_number === pageNum);
      pagePlacements.forEach((placement) => {
        addTagToCanvas(
          placement.tag_key,
          placement.x_position,
          placement.y_position,
          placement.width,
          placement.height
        );
      });
      
    } catch (error) {
      console.error("❌ Error rendering PDF page:", error);
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      setPdfError(`Failed to render page ${pageNum}: ${errorMsg}`);
      toast.error("Failed to render page");
    } finally {
      setPageRendering(false);
    }
  };

  // Load image as background
  const loadImage = async (url: string) => {
    if (!fabricCanvas) return;
    
    return new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = async () => {
        const scale = Math.min(800 / img.width, 1000 / img.height);
        fabricCanvas.setWidth(img.width * scale);
        fabricCanvas.setHeight(img.height * scale);
        
        try {
          const fabricImg = await FabricImage.fromURL(url, { crossOrigin: "anonymous" });
          fabricImg.scaleToWidth(img.width * scale);
          await fabricCanvas.set('backgroundImage', fabricImg);
          fabricCanvas.requestRenderAll();
          
          // Load tags for page 1
          const pagePlacements = allPlacements.filter(p => p.page_number === 1);
          pagePlacements.forEach((placement) => {
            addTagToCanvas(
              placement.tag_key,
              placement.x_position,
              placement.y_position,
              placement.width,
              placement.height
            );
          });
          
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = reject;
      img.src = url;
    });
  };

  // Collect tags from current canvas
  const collectCurrentPageTags = (): TagPlacement[] => {
    if (!fabricCanvas) return [];
    
    const objects = fabricCanvas.getObjects();
    const tagRects = objects.filter((obj: any) => obj.tagKey && !obj.isLabel);
    
    return tagRects.map((rect: any) => ({
      tag_key: rect.tagKey,
      page_number: currentPage,
      x_position: rect.left || 0,
      y_position: rect.top || 0,
      width: (rect.width || 150) * (rect.scaleX || 1),
      height: (rect.height || 24) * (rect.scaleY || 1),
      font_size: 12,
      font_family: "Arial",
      text_align: "left",
    }));
  };

  // Update placements for a specific page
  const updatePlacementsForPage = (pageNum: number, newPagePlacements: TagPlacement[]) => {
    setAllPlacements(prev => {
      // Remove old placements for this page
      const otherPages = prev.filter(p => p.page_number !== pageNum);
      // Add new placements
      return [...otherPages, ...newPagePlacements];
    });
  };

  // Handle page navigation
  const goToPage = async (pageNum: number) => {
    if (!pdfDocument || pageNum < 1 || pageNum > totalPages || pageRendering) return;
    
    // Save current page tags first
    const currentTags = collectCurrentPageTags();
    updatePlacementsForPage(currentPage, currentTags);
    
    setCurrentPage(pageNum);
    await renderPdfPage(pdfDocument, pageNum);
  };

  const addTagToCanvas = useCallback((tagKey: string, x?: number, y?: number, w?: number, h?: number) => {
    if (!fabricCanvas) return;

    const width = w || 150;
    const height = h || 24;
    const left = x ?? 100;
    const top = y ?? 100;

    // Create tag rectangle
    const tagRect = new Rect({
      left,
      top,
      width,
      height,
      fill: "rgba(59, 130, 246, 0.15)",
      stroke: "#3b82f6",
      strokeWidth: 2,
      rx: 4,
      ry: 4,
      hasControls: true,
      hasBorders: true,
    });

    // Store tag key in object data
    (tagRect as any).tagKey = tagKey;

    fabricCanvas.add(tagRect);

    // Add label text on top
    const labelText = new FabricText(`{{${tagKey}}}`, {
      left: left + 4,
      top: top + 4,
      fontSize: 10,
      fill: "#1e40af",
      fontFamily: "monospace",
      selectable: false,
      evented: false,
    });
    (labelText as any).isLabel = true;
    (labelText as any).parentRect = tagRect;

    fabricCanvas.add(labelText);

    // Update label position when rect moves
    tagRect.on("moving", () => {
      labelText.set({
        left: (tagRect.left || 0) + 4,
        top: (tagRect.top || 0) + 4,
      });
      fabricCanvas.renderAll();
    });

    tagRect.on("scaling", () => {
      labelText.set({
        left: (tagRect.left || 0) + 4,
        top: (tagRect.top || 0) + 4,
      });
      fabricCanvas.renderAll();
    });

    fabricCanvas.setActiveObject(tagRect);
    fabricCanvas.renderAll();
  }, [fabricCanvas]);

  const handleAddTag = (tagKey: string) => {
    addTagToCanvas(tagKey);
    toast.success(`Added {{${tagKey}}} tag`);
  };

  const handleDeleteSelected = () => {
    if (!fabricCanvas || !selectedObject) return;

    // Find and remove associated label
    const objects = fabricCanvas.getObjects();
    const labelToRemove = objects.find((obj: any) => obj.isLabel && obj.parentRect === selectedObject);
    if (labelToRemove) {
      fabricCanvas.remove(labelToRemove);
    }

    fabricCanvas.remove(selectedObject);
    setSelectedObject(null);
    fabricCanvas.renderAll();
    toast.success("Tag removed");
  };

  const handleSave = async () => {
    if (!fabricCanvas) {
      toast.error("Canvas not ready - please wait");
      return;
    }
    if (!tenantId) {
      toast.error("Loading tenant data - please wait a moment and try again");
      return;
    }

    setSaving(true);
    try {
      // Collect current page tags
      const currentTags = collectCurrentPageTags();
      updatePlacementsForPage(currentPage, currentTags);
      
      // Get all placements including current page
      const allCurrentPlacements = [
        ...allPlacements.filter(p => p.page_number !== currentPage),
        ...currentTags
      ];

      // Delete existing placements
      await supabase
        .from("document_tag_placements")
        .delete()
        .eq("document_id", document.id);

      // Insert new placements
      if (allCurrentPlacements.length > 0) {
        const { error } = await supabase
          .from("document_tag_placements")
          .insert(
            allCurrentPlacements.map((p) => ({
              tenant_id: tenantId,
              document_id: document.id,
              tag_key: p.tag_key,
              page_number: p.page_number,
              x_position: p.x_position,
              y_position: p.y_position,
              width: p.width,
              height: p.height,
              font_size: p.font_size,
              font_family: p.font_family,
              text_align: p.text_align,
            }))
          );

        if (error) throw error;
      }

      toast.success(`Saved ${allCurrentPlacements.length} tag placements`);
      onSave();
    } catch (error) {
      console.error("Error saving placements:", error);
      toast.error("Failed to save tag placements");
    } finally {
      setSaving(false);
    }
  };

  const handleZoom = (direction: "in" | "out" | "reset") => {
    if (!fabricCanvas) return;
    
    let newZoom = zoom;
    if (direction === "in") newZoom = Math.min(zoom + 0.25, 3);
    else if (direction === "out") newZoom = Math.max(zoom - 0.25, 0.5);
    else newZoom = 1;

    setZoom(newZoom);
    fabricCanvas.setZoom(newZoom);
    fabricCanvas.renderAll();
  };

  const filteredTags = Object.entries(SMART_TAG_CATEGORIES).reduce((acc, [category, tags]) => {
    const filtered = tags.filter(
      (tag) =>
        tag.key.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tag.label.toLowerCase().includes(searchTerm.toLowerCase())
    );
    if (filtered.length > 0) acc[category] = filtered;
    return acc;
  }, {} as Record<string, typeof SMART_TAG_CATEGORIES.Contact>);

  // Show loading overlay in the canvas area instead of early return
  // This ensures the canvas element always mounts so Fabric can initialize

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-card">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="font-semibold">Edit Smart Tags</h2>
            <p className="text-sm text-muted-foreground">{document.filename}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Page Navigation (PDF only) */}
          {isDocumentPdf && totalPages > 1 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-lg">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage <= 1 || pageRendering}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm min-w-[80px] text-center">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= totalPages || pageRendering}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Zoom Controls */}
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => handleZoom("out")}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-sm w-12 text-center">{Math.round(zoom * 100)}%</span>
            <Button variant="outline" size="icon" onClick={() => handleZoom("in")}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => handleZoom("reset")}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>

          {selectedObject && (
            <Button variant="destructive" size="sm" onClick={handleDeleteSelected}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Selected
            </Button>
          )}
          <Button 
            onClick={handleSave} 
            disabled={saving || !tenantId}
            title={!tenantId ? "Loading tenant data..." : undefined}
          >
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving..." : !tenantId ? "Loading..." : "Save Tags"}
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tag palette sidebar */}
        <div className="w-72 border-r bg-card flex flex-col">
          <div className="p-4 border-b">
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <TagIcon className="h-4 w-4" />
              Smart Tags
            </h3>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tags..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4">
              {Object.entries(filteredTags).map(([category, tags]) => (
                <div key={category}>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">
                    {category}
                  </h4>
                  <div className="space-y-1">
                    {tags.map((tag) => (
                      <Button
                        key={tag.key}
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start text-left h-auto py-2"
                        onClick={() => handleAddTag(tag.key)}
                      >
                        <div>
                          <div className="font-medium">{tag.label}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {`{{${tag.key}}}`}
                          </div>
                        </div>
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="p-4 border-t bg-muted/50">
            <p className="text-xs text-muted-foreground">
              Click a tag to add it to the document. Drag to reposition, resize using handles.
            </p>
          </div>
        </div>

        {/* Canvas area */}
        <div className="flex-1 overflow-auto bg-muted/30 p-8 relative">
          {/* Loading overlay - shown while downloading document or rendering page */}
          {(loading || pageRendering) && (
            <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  {loading ? "Loading document..." : "Rendering page..."}
                </p>
              </div>
            </div>
          )}
          
          {/* Error state with retry and fallback options */}
          {pdfError && !pageRendering && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-background/80">
              <div className="bg-card border border-destructive/50 rounded-lg p-6 max-w-md text-center shadow-lg">
                <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
                <h3 className="font-semibold text-lg mb-2">PDF Load Error</h3>
                <p className="text-sm text-muted-foreground mb-4">{pdfError}</p>
                <div className="flex gap-2 justify-center">
                  <Button 
                    variant="outline" 
                    onClick={async () => {
                      setPdfError(null);
                      if (pdfBlob && isCanvasValid(fabricCanvas)) {
                        setPageRendering(true);
                        try {
                          // Create fresh ArrayBuffer from blob
                          const freshBuffer = await pdfBlob.arrayBuffer();
                          const pdf = await loadPDFFromArrayBuffer(freshBuffer);
                          setPdfDocument(pdf);
                          setTotalPages(pdf.numPages);
                          await renderPdfPage(pdf, 1);
                        } catch (e) {
                          setPdfError(`Retry failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
                          setPageRendering(false);
                        }
                      }
                    }}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Retry
                  </Button>
                  <Button 
                    variant="secondary"
                    onClick={async () => {
                      // Get signed URL and open in new tab
                      const bucket = resolveStorageBucket(document.document_type, document.file_path);
                      const { data } = await supabase.storage
                        .from(bucket)
                        .createSignedUrl(document.file_path, 3600);
                      if (data?.signedUrl) {
                        window.open(data.signedUrl, '_blank');
                      }
                    }}
                  >
                    Open PDF in Tab
                  </Button>
                </div>
              </div>
            </div>
          )}
          
          <div className="inline-block shadow-lg rounded-lg overflow-hidden">
            <canvas ref={canvasRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
