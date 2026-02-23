

# Smart Notes with Voice Mode for Inspection Steps

## Overview

Replace the standalone "Describe what you see" textarea with an integrated notes input that sits alongside the photo thumbnails. Add a voice dictation toggle button so field reps can speak their observations instead of typing. Raw notes (typed or dictated) are then AI-polished into professional, grammatically correct descriptions when generating the PDF report.

## Changes Summary

### 1. Update `InspectionStepCard.tsx` -- Inline Notes with Voice Toggle

- Move the textarea so it appears directly below each photo thumbnail (contextually tied to what the user is documenting)
- Change placeholder to "Add notes about this photo..." 
- Add a small microphone toggle button inside/beside the textarea
- When voice mode is active, show a recording indicator and stream dictation into the notes field
- Use the browser's `SpeechRecognition` API (already built in `useSpeechRecognition.ts` hook) for real-time dictation -- appends spoken text to existing notes
- The mic button toggles between recording and stopped states

### 2. Create Edge Function `polish-inspection-notes`

A new Supabase Edge Function that takes raw field notes and returns a polished, professional description:

- Accepts: `{ notes: string, stepTitle: string, stepDescription: string }`
- Uses OpenAI GPT to rewrite the raw notes into a fluent, grammatically correct observation
- Preserves all factual details -- just fixes grammar, spelling, and flow
- Returns: `{ polished: string }`

### 3. Update `useInspectionReportPDF.ts` -- AI-Polished Notes in PDF

- Before building the PDF, batch-send all non-empty notes through the `polish-inspection-notes` edge function
- Use the polished text in the PDF report instead of raw notes
- Fall back to raw notes if the AI call fails

### 4. Voice Recording UX

The voice button uses the existing `useSpeechRecognition` hook (browser Web Speech API) for zero-latency dictation:

- Tap mic icon: starts listening, shows pulsing red indicator
- Speak naturally: interim text appears in real-time in the textarea
- Tap again to stop: final transcript is appended to existing notes
- If Web Speech API is not supported (rare), fall back to the `voice-transcribe` edge function (record then transcribe)

## Technical Details

### InspectionStepCard.tsx Layout Change

```
[Photo thumbnails row - horizontal scroll]
[+ Add Another Photo button]

+------------------------------------------+
| Add notes about this photo...        [mic]|
|                                          |
+------------------------------------------+
```

The mic button is a small icon button positioned at the top-right of the textarea area. When active, it pulses red.

### Edge Function: `supabase/functions/polish-inspection-notes/index.ts`

Uses OpenAI to transform raw dictated/typed notes into professional report language:

- System prompt instructs the model to preserve all factual observations
- Fixes grammar, spelling, adds professional tone
- Keeps it concise (1-3 sentences per step)
- Does not add information that wasn't in the original notes

### PDF Generation Flow

1. Collect all steps with non-empty notes
2. Send batch request to `polish-inspection-notes` for each
3. Build PDF using polished text (or raw text as fallback)
4. This happens transparently during report generation

### Files to Create/Modify

| File | Action |
|------|--------|
| `src/components/inspection/InspectionStepCard.tsx` | Modify -- add voice toggle button to textarea area |
| `src/components/inspection/InspectionWalkthrough.tsx` | Modify -- pass voice toggle handler, manage speech recognition state |
| `supabase/functions/polish-inspection-notes/index.ts` | Create -- AI note polishing edge function |
| `src/components/inspection/useInspectionReportPDF.ts` | Modify -- polish notes before PDF generation |

