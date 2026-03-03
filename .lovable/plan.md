

# Add Rename/Edit Button to Document Rows

## What
Add a pencil/edit icon button next to the existing view/download/delete buttons on each document row in `DocumentsTab.tsx`. Clicking it opens the existing `DocumentRenameDialog` component.

## Changes

### File: `src/components/DocumentsTab.tsx`

1. **Import** `Pencil` from lucide-react and `DocumentRenameDialog` from the documents feature
2. **Add state**: `const [renameDoc, setRenameDoc] = useState<{ id: string; filename: string } | null>(null);`
3. **Add rename button** in both document row locations (folder view ~line 844 and list view ~line 1142), inserted before the Eye button:
   ```tsx
   <Button size="icon" variant="ghost" onClick={() => setRenameDoc({ id: doc.id, filename: doc.filename })} title="Rename">
     <Pencil className="h-4 w-4" />
   </Button>
   ```
4. **Render the dialog** at the bottom of the component (alongside other modals):
   ```tsx
   <DocumentRenameDialog
     open={!!renameDoc}
     onOpenChange={(open) => !open && setRenameDoc(null)}
     document={renameDoc}
     onRenameComplete={() => { setRenameDoc(null); fetchDocuments(); }}
   />
   ```

No new components or backend changes needed -- the `DocumentRenameDialog` already handles the rename via Supabase update.

