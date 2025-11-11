export interface GenerationOptions {
  runId: string;
  tenantId: string;
  userId: string;
  steps: any[]; // WalkthroughStep from VideoWalkthrough
  screenshots: Record<string, string>; // stepId -> dataUrl
  videoBlob?: Blob;
  outputFormats: ('markdown' | 'html' | 'pdf')[];
  metadata: DocumentationMetadata;
  uploadToStorage?: boolean;
  includeTableOfContents?: boolean;
  includeIndex?: boolean;
}

export interface DocumentationMetadata {
  title: string;
  version: string;
  generatedAt: Date;
  generatedBy: string;
  companyName?: string;
  companyLogo?: string;
  description?: string;
  customStyles?: string;
}

export interface DocumentationStep {
  id: string;
  stepNumber: number;
  title: string;
  description: string;
  narration: string;
  action: string;
  screenshot?: string;
  duration: number;
  captions: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  timestamp: string;
}

export interface CompiledReport {
  markdown: string;
  html: string;
  pdfBlob?: Blob;
  tableOfContents: string;
  metadata: DocumentationMetadata;
}

export interface DocumentationResult {
  runId: string;
  success: boolean;
  formats: {
    markdown?: {
      content: string;
      storagePath?: string;
      publicUrl?: string;
    };
    html?: {
      content: string;
      storagePath?: string;
      publicUrl?: string;
    };
    pdf?: {
      blob: Blob;
      storagePath?: string;
      publicUrl?: string;
    };
  };
  assets: UploadResult[];
  generatedAt: Date;
  error?: string;
}

export interface Asset {
  type: 'screenshot' | 'video' | 'report';
  stepId?: string;
  data: Blob | string;
  filename: string;
  mimeType: string;
}

export interface UploadResult {
  assetType: string;
  stepId?: string;
  storagePath: string;
  publicUrl: string;
  fileSize: number;
}
