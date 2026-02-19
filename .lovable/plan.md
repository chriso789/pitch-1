

# Add Photo Upload and Paste to AI Admin Chat

## Overview

Enable users to attach images to AI Admin chat messages via file picker button, drag-and-drop, or clipboard paste (Ctrl+V / Cmd+V). Images are uploaded to a Supabase Storage bucket and sent to the AI models as vision inputs (both GPT-4o and Claude support image URLs).

## What Changes

### 1. Database Migration -- Storage Bucket

Create a new `ai-admin-uploads` storage bucket for chat images:
- Public bucket (so signed URLs aren't needed for display)
- File size limit: 10MB
- Allowed MIME types: image/png, image/jpeg, image/webp, image/gif
- RLS policies: authenticated users can upload to their own tenant path (`{tenant_id}/...`), anyone can read (public bucket)

### 2. Edge Function: `supabase/functions/ai-admin-agent/index.ts`

Update message handling to support OpenAI vision format:
- Accept messages where `content` can be a string OR an array of content parts (`[{type: "text", text: "..."}, {type: "image_url", image_url: {url: "..."}}]`)
- Pass image content parts directly to OpenAI GPT-4o (natively supports vision)
- For Anthropic Claude fallback, convert image URLs to Anthropic's `image` content block format (`{type: "image", source: {type: "url", url: "..."}}`)
- Update the system prompt to mention the assistant can analyze uploaded images (screenshots, photos, diagrams)

### 3. Frontend: `src/components/ai-admin/AIAdminChat.tsx`

**New UI elements:**
- Image attach button (camera/paperclip icon) next to the send button
- Hidden file input accepting `image/*`
- Image preview strip above the text input showing pending attachments with remove buttons
- Paste handler on the textarea that detects image clipboard data

**New state:**
- `pendingImages: Array<{file: File, preview: string}>` -- images queued for the next message

**Upload flow:**
1. User selects/pastes image -> shown as thumbnail preview above input
2. On send: upload each image to `ai-admin-uploads/{tenant_id}/{uuid}.{ext}` via Supabase Storage
3. Build message content as an array: `[{type: "image_url", image_url: {url}}, {type: "text", text: "user message"}]`
4. Send to edge function
5. Display images inline in the chat message bubble

**Message rendering update:**
- When a user message content is an array (has images), render the images as thumbnails above the text
- When persisting to `ai_chat_messages`, store the full content array as JSON in the `content` column

**Paste handling:**
```text
onPaste event on Textarea:
  -> Check clipboardData.items for image types
  -> If image found, create File object, add to pendingImages
  -> Show preview thumbnail
  -> Prevent default only if image was pasted (allow text paste normally)
```

**Drag-and-drop:**
- Add onDragOver/onDrop handlers to the chat area
- Accept dropped image files, add to pendingImages

### 4. Message Interface Update

Update the `Message` interface to support mixed content:

```text
interface MessageContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string | MessageContent[];
}
```

## Files Created
1. Migration SQL for `ai-admin-uploads` storage bucket and RLS policies

## Files Modified
1. `supabase/functions/ai-admin-agent/index.ts` -- Accept and forward image content parts to OpenAI/Anthropic vision APIs
2. `src/components/ai-admin/AIAdminChat.tsx` -- Add image upload button, paste handler, drag-drop, image previews, and updated message rendering

## Security
- Images uploaded to tenant-scoped paths only
- File size capped at 10MB, image MIME types only
- Public bucket for easy display (no sensitive data expected in admin chat images)
- RLS enforces upload path matches user's tenant

