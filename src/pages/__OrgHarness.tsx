import { PageOrganizer } from "@/components/pdf-pages/PageOrganizer";
export default function H() { return <div className="p-4"><PageOrganizer onSaveVersion={async (r) => { (window as any).__saved = r; }} /></div>; }
