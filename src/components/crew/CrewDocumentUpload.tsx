import { useState, useRef } from 'react';
import { useCrewCompliance } from '@/hooks/useCrewCompliance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Upload, Loader2, FileText, X } from 'lucide-react';
import { toast } from 'sonner';

interface DocumentType {
  id: string;
  key: string;
  label: string;
  docKind: string;
  isRequired: boolean;
}

interface CrewDocumentUploadProps {
  documentTypes: DocumentType[];
  preselectedTypeId: string | null;
  onClose: () => void;
}

export function CrewDocumentUpload({
  documentTypes,
  preselectedTypeId,
  onClose,
}: CrewDocumentUploadProps) {
  const { uploadDocument, refetch } = useCrewCompliance();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [selectedTypeId, setSelectedTypeId] = useState(preselectedTypeId || '');
  const [file, setFile] = useState<File | null>(null);
  const [expirationDate, setExpirationDate] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [issuingAuthority, setIssuingAuthority] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Validate file type
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(selectedFile.type)) {
      toast.error('Please select a PDF or image file');
      return;
    }

    // Validate file size (10MB max)
    if (selectedFile.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB');
      return;
    }

    setFile(selectedFile);
  };

  const handleUpload = async () => {
    if (!selectedTypeId || !file || !expirationDate) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      setUploading(true);

      await uploadDocument(selectedTypeId, file, {
        issuingAuthority: issuingAuthority || undefined,
        number: documentNumber || undefined,
        effectiveDate: effectiveDate || undefined,
        expirationDate,
      });

      toast.success('Document uploaded successfully');
      await refetch();
      onClose();
    } catch (err) {
      console.error('[CrewDocumentUpload] Error:', err);
      toast.error('Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => !uploading && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
          <DialogDescription>
            Upload your license, insurance, or certification
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Document Type */}
          <div className="space-y-2">
            <Label>Document Type *</Label>
            <Select 
              value={selectedTypeId} 
              onValueChange={setSelectedTypeId}
              disabled={uploading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select document type" />
              </SelectTrigger>
              <SelectContent>
                {documentTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.label}
                    {type.isRequired && ' *'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* File Selection */}
          <div className="space-y-2">
            <Label>File *</Label>
            {file ? (
              <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm truncate max-w-[200px]">{file.name}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setFile(null)}
                  disabled={uploading}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="h-4 w-4 mr-2" />
                Select File
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          {/* Expiration Date */}
          <div className="space-y-2">
            <Label>Expiration Date *</Label>
            <Input
              type="date"
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
              disabled={uploading}
              min={new Date().toISOString().split('T')[0]}
            />
          </div>

          {/* Effective Date (Optional) */}
          <div className="space-y-2">
            <Label>Effective Date</Label>
            <Input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              disabled={uploading}
            />
          </div>

          {/* Document Number (Optional) */}
          <div className="space-y-2">
            <Label>Document/Policy Number</Label>
            <Input
              placeholder="e.g., POL-12345"
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
              disabled={uploading}
            />
          </div>

          {/* Issuing Authority (Optional) */}
          <div className="space-y-2">
            <Label>Issuing Authority</Label>
            <Input
              placeholder="e.g., State of Florida"
              value={issuingAuthority}
              onChange={(e) => setIssuingAuthority(e.target.value)}
              disabled={uploading}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={onClose}
              disabled={uploading}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleUpload}
              disabled={!selectedTypeId || !file || !expirationDate || uploading}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
