

# Fix: Recording Playback (No Sound) + Missing Transcripts

## Root Cause

### 1. Recording URLs Expire
Telnyx stores recordings on S3 with **presigned URLs that expire in 10 minutes** (`X-Amz-Expires=600`). The webhook saves these temporary URLs directly to the `calls.recording_url` column. By the time the user views the call log, the URL is dead — the `<audio>` element shows a player but produces no sound.

### 2. No Transcription
The `call.recording.saved` handler only saves the URL. It never triggers the existing `voice-transcribe` edge function, so `transcript` is always NULL.

## Solution

### 1. `telnyx-call-webhook/index.ts` — Download recording to Supabase Storage

In the `call.recording.saved` handler (lines 264-272):
- Fetch the MP3 from the Telnyx presigned URL before it expires
- Upload it to the existing `call-recordings` Supabase Storage bucket
- Generate a permanent public/signed URL
- Store that permanent URL in `calls.recording_url`

### 2. `telnyx-call-webhook/index.ts` — Trigger transcription after saving

After uploading the recording to storage:
- Invoke the existing `voice-transcribe` edge function with the audio
- Save the returned transcript text to `calls.transcript`

### 3. Flow After Fix

```text
Telnyx fires call.recording.saved
  → Webhook downloads MP3 from Telnyx S3 (before expiry)
  → Uploads to Supabase Storage (call-recordings bucket)
  → Stores permanent URL in calls.recording_url
  → Sends audio to voice-transcribe function
  → Saves transcript to calls.transcript
```

## Files Modified
- `supabase/functions/telnyx-call-webhook/index.ts` — download + store recording, trigger transcription

