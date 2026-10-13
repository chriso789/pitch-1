import { MarkupEditor } from "@/components/pdf-markup/MarkupEditor";
export default function H() { return <div className="p-4"><MarkupEditor onSaveVersion={async (out) => { (window as any).__out = out; }} /></div>; }
