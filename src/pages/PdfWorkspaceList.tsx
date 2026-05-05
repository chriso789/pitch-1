import { useState, useCallback } from "react";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { usePdfWorkspace } from "@/hooks/usePdfWorkspace";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileText, Download, Search, FilePenLine } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  editing: "bg-blue-500/20 text-blue-400",
  finalized: "bg-green-500/20 text-green-400",
  archived: "bg-yellow-500/20 text-yellow-400",
};

const PdfWorkspaceList = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [search, setSearch] = useState("");
  const { documents, isLoading, uploadPdf, isUploading } = usePdfWorkspace(statusFilter, sourceFilter);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      toast({ title: "Invalid file", description: "Only PDF files are accepted.", variant: "destructive" });
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max file size is 50MB.", variant: "destructive" });
      return;
    }
    try {
      const doc = await uploadPdf(file);
      toast({ title: "PDF uploaded", description: "Opening workspace editor..." });
      navigate(`/documents/pdf-workspace/${doc.id}`);
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
  }, [uploadPdf, navigate, toast]);

  const filtered = documents.filter((d: any) =>
    !search || d.title?.toLowerCase().includes(search.toLowerCase()) || d.original_filename?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <GlobalLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">PDF Workspace</h1>
            <p className="text-muted-foreground">Upload, edit, annotate, and finalize PDFs</p>
          </div>
          <label>
            <input type="file" accept="application/pdf" className="hidden" onChange={handleUpload} disabled={isUploading} />
            <Button asChild disabled={isUploading}>
              <span><Upload className="h-4 w-4 mr-2" />{isUploading ? "Uploading..." : "Upload PDF"}</span>
            </Button>
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search documents..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="editing">Editing</SelectItem>
              <SelectItem value="finalized">Finalized</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Source" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="uploaded">Uploaded</SelectItem>
              <SelectItem value="estimate_pdf">Estimate PDF</SelectItem>
              <SelectItem value="smart_doc">Smart Doc</SelectItem>
              <SelectItem value="contract_report">Contract Report</SelectItem>
              <SelectItem value="signature_packet">Signature Packet</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-semibold text-lg mb-1">No PDFs yet</h3>
              <p className="text-muted-foreground text-sm">Upload a PDF or open one from your documents to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((doc: any) => (
              <Card key={doc.id} className="hover:border-primary/50 transition-colors cursor-pointer" onClick={() => navigate(`/documents/pdf-workspace/${doc.id}`)}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <FilePenLine className="h-5 w-5 text-primary flex-shrink-0" />
                      <span className="font-medium truncate">{doc.title}</span>
                    </div>
                    <Badge className={STATUS_COLORS[doc.status] || ""}>{doc.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{doc.original_filename}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{doc.page_count ? `${doc.page_count} pages` : ""}</span>
                    <span>{new Date(doc.updated_at).toLocaleDateString()}</span>
                  </div>
                  {doc.finalized_path && (
                    <Button variant="outline" size="sm" className="w-full" onClick={e => { e.stopPropagation(); }}>
                      <Download className="h-3.5 w-3.5 mr-1" />Download Final
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </GlobalLayout>
  );
};

export default PdfWorkspaceList;
