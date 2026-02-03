// Documents feature barrel exports

// Main components
export { default as SmartDocs } from './components/SmartDocs';
export { TemplateLibrary } from './components/TemplateLibrary';
export { TemplateEditor } from './components/TemplateEditor';
export { BulkDocumentUpload } from './components/BulkDocumentUpload';
export { DocumentRenameDialog } from './components/DocumentRenameDialog';
export { DocumentTagEditor } from './components/DocumentTagEditor';
export { ApplyDocumentToLeadDialog } from './components/ApplyDocumentToLeadDialog';
export { DocumentScannerDialog } from '@/components/documents/DocumentScannerDialog';

// PDF Editor components
export { EditorToolbar, type EditorTool } from './components/EditorToolbar';
export { PageThumbnails, type PageThumbnail } from './components/PageThumbnails';
export { SmartTagPalette, type SmartTag, type SmartTagCategory, DEFAULT_SMART_TAG_CATEGORIES } from './components/SmartTagPalette';

// Hooks
export { useEditorHistory, type HistoryState } from './hooks/useEditorHistory';