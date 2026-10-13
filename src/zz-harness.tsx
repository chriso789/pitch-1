import { createRoot } from 'react-dom/client';
import './index.css';
import { Toaster } from 'sonner';
import { PdfLocalEditTools } from '@/components/pdf-engine/PdfLocalEditTools';
createRoot(document.getElementById('root')!).render(<div className="p-4"><Toaster /><PdfLocalEditTools /></div>);
