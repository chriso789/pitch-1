

# Internal AI Assistant Audit — Complete Backend Overview

## API Keys Configured (32 secrets)

| Key | Used By |
|-----|---------|
| `LOVABLE_API_KEY` | Lovable AI Gateway (Gemini/GPT) — auto-provisioned |
| `OPENAI_API_KEY` | Direct OpenAI calls (GPT-4o, GPT-4o-mini) |
| `ANTHROPIC_API_KEY` | Direct Anthropic calls (Claude Sonnet 4) |
| `TELNYX_API_KEY` | Voice calls, SMS, power dialer |
| `FIRECRAWL_API_KEY` | Web scraping for property data |
| `GOOGLE_MAPS_API_KEY` / `GOOGLE_SOLAR_API_KEY` | Maps, solar/roof imagery |
| `RESEND_API_KEY` | Email sending |
| `REGRID_API_KEY` | Parcel/property data |
| `ELEVENLABS_API_KEY` | Text-to-speech |
| `STRIPE_SECRET_KEY` | Payments |
| Others | Weather, search, Twilio, Mapbox, etc. |

---

## All AI Edge Functions — What Each Does

### 1. `ai-admin-agent` — **System Admin Chat (Master Role Only)**
- **API**: `OPENAI_API_KEY` → OpenAI GPT-4o (tool-calling, streaming) + `ANTHROPIC_API_KEY` → Claude Sonnet 4 (vision/fallback)
- **System**: CRM system management assistant with 20+ tools (manage pipeline stages, app settings, templates, run SQL queries, manage projects)
- **Where used**: Sidebar → AI Admin (master role only)
- **Note**: This is the most complex AI — full tool-calling loop with database read/write

### 2. `crm-ai-agent` — **PITCH AI Chat Assistant**
- **API**: `LOVABLE_API_KEY` → Lovable Gateway (Gemini)
- **System**: "You are PITCH AI, an intelligent assistant for roofing sales reps." Handles navigation commands, create contacts, create tasks, query data
- **Where used**: In-app chat bubble / AI assistant sidebar
- **Output**: Structured JSON with `response` + `actions` array

### 3. `homeowner-ai-chat` — **Customer Portal Chatbot**
- **API**: `LOVABLE_API_KEY` → Lovable Gateway (Gemini 2.5 Flash)
- **System**: Customer service assistant for homeowners. Pulls project status, change orders, payments as context. Answers status questions, escalates when unsure
- **Where used**: Homeowner portal
- **Output**: Text response + `shouldEscalate` flag

### 4. `ai-lead-scorer` — **Lead Scoring Engine**
- **API**: `OPENAI_API_KEY` → OpenAI GPT-4o-mini
- **System**: "Expert lead scoring analyst for a roofing company." Considers weather events, engagement data, property info
- **Where used**: Automated lead scoring, contact detail pages
- **Output**: Score 0-100, qualification status, recommendations

### 5. `ai-sales-advisor` — **Pipeline & Performance Analyst**
- **API**: `OPENAI_API_KEY` → OpenAI GPT-4o-mini
- **System**: Analyzes pipeline health, lead patterns, follow-up strategy, rep performance. Stores insights in `ai_insights` table
- **Where used**: Dashboard / analytics views
- **Output**: JSON analysis with insights array

### 6. `ai-sales-coach` — **Call Scoring Coach**
- **API**: `LOVABLE_API_KEY` (loaded but uses hardcoded scoring currently)
- **System**: Scores call transcriptions on greeting, discovery, objection handling, closing, rapport. Returns key moments + recommendations
- **Where used**: After call review
- **Note**: Currently returns **hardcoded mock scores** — not actually calling AI yet

### 7. `door-knock-strategy` — **Canvassing AI Coach**
- **API**: `LOVABLE_API_KEY` → Lovable Gateway (shared helper `generateAIResponse`)
- **System**: "Canvassing coach for a roofing company." Generates opener, credibility statement, discovery questions, objection responses, compliance notes
- **Where used**: Canvassing / territory management
- **Output**: Structured JSON strategy, logged to `canvass_strategy_log`

### 8. `sms-conversation-ai` — **SMS AI Responder**
- **API**: `LOVABLE_API_KEY` → Lovable Gateway (Gemini 2.5 Flash)
- **System**: "SMS assistant for [company], a construction/roofing company." Keeps responses under 160 chars, answers scheduling/status questions
- **Where used**: Inbound SMS auto-response pipeline
- **Output**: SMS text queued to `message_queue`

### 9. `sms-auto-responder` — **Keyword-Based SMS Responder**
- **API**: None (rule-based, no AI)
- **System**: Keyword matching (STOP, HELP, QUOTE, STATUS, SCHEDULE) with template responses
- **Where used**: SMS inbound webhook
- **Note**: No AI — pure keyword trigger system

### 10. `polish-inspection-notes` — **Note Polisher**
- **API**: `LOVABLE_API_KEY` → Lovable Gateway (shared helper)
- **System**: "Professional property inspection report writer." Rewrites raw/voice-dictated field notes into formal report language
- **Where used**: Inspection workflow
- **Output**: Polished text string

### 11. `translate-proposal` — **Proposal Translator**
- **API**: `LOVABLE_API_KEY` → Lovable Gateway (shared helper)
- **System**: "Professional translator for construction/roofing proposals." Maintains construction terminology
- **Where used**: Proposal builder — multi-language support

### 12. `ai-error-fixer` — **App Error Diagnoser**
- **API**: `LOVABLE_API_KEY` → Lovable Gateway
- **System**: Diagnoses runtime errors in the app, provides root cause, severity, recommended fix, and whether it can auto-fix
- **Where used**: Error boundary / global error handler modal

### 13. `ai-project-status-answer` — **Project Status Bot**
- **API**: `LOVABLE_API_KEY` → Lovable Gateway (shared helper)
- **System**: "Friendly roofing company AI assistant. Provide brief project status update." Under 100 words
- **Where used**: Customer-facing project status queries

### 14. `detect-roof-obstruction` — **Roof Obstruction Detector**
- **API**: `OPENAI_API_KEY` → OpenAI (vision)
- **System**: Analyzes aerial/satellite imagery to detect roof obstructions (vents, skylights, chimneys)
- **Where used**: Measurement workflow

### 15. `roof-segmentation` — **Roof Plane Detector**
- **API**: `LOVABLE_API_KEY` → Lovable Gateway
- **System**: Analyzes aerial images to segment roof planes, detect edges, ridges, valleys
- **Where used**: Measurement / roof analysis

### 16. `generate-roof-overlay` — **Roof Overlay Generator**
- **API**: `LOVABLE_API_KEY` → Lovable Gateway
- **System**: Generates roof measurement overlays from satellite imagery
- **Where used**: Measurement visualization

### 17. `generate-presentation` — **Sales Presentation Generator**
- **API**: `LOVABLE_API_KEY` → Lovable Gateway
- **System**: Fills in AI-generated content for sales presentation smart tags
- **Where used**: Presentation builder

### 18. `supplement-generator` — **Insurance Supplement Generator**
- **API**: `LOVABLE_API_KEY` → Lovable Gateway
- **System**: Generates insurance supplement request documents

### 19. `smart-follow-up` — **Follow-Up Message Generator**
- **API**: `OPENAI_API_KEY` → OpenAI
- **System**: Generates contextual follow-up messages based on lead history

### 20. `ai-command-processor` — **Voice Command Processor**
- **API**: `OPENAI_API_KEY` → OpenAI
- **System**: Processes voice/text commands into structured CRM actions

### 21. `call-answering-service` — **AI Call Answering**
- **API**: `OPENAI_API_KEY` → OpenAI (direct)
- **System**: Generates intelligent phone responses for the answering service

### 22. `telnyx-ai-answering` — **Inbound Call AI Gather**
- **API**: `TELNYX_API_KEY` (Telnyx native `gather_using_ai`)
- **System**: Uses Telnyx's built-in AI to gather caller info on inbound calls
- **Note**: Not OpenAI/Lovable — uses Telnyx's own AI service

### 23. `workflow-automation` — **Workflow AI Router**
- **API**: `LOVABLE_API_KEY` → Lovable Gateway
- **System**: Determines next automation actions based on workflow triggers

---

## API Provider Summary

| Provider | Functions Using It | Model |
|----------|-------------------|-------|
| **Lovable Gateway** | crm-ai-agent, homeowner-ai-chat, sms-conversation-ai, door-knock-strategy, polish-inspection-notes, translate-proposal, ai-error-fixer, ai-project-status-answer, roof-segmentation, generate-roof-overlay, generate-presentation, supplement-generator, workflow-automation | Gemini 2.5 Flash / Gemini 3 Flash Preview |
| **OpenAI (direct)** | ai-admin-agent, ai-lead-scorer, ai-sales-advisor, detect-roof-obstruction, smart-follow-up, ai-command-processor, call-answering-service | GPT-4o, GPT-4o-mini |
| **Anthropic (direct)** | ai-admin-agent (fallback/vision) | Claude Sonnet 4 |
| **Telnyx AI** | telnyx-ai-answering | Telnyx native |

## Key Issues Identified

1. **`ai-sales-coach`** — Returns hardcoded mock scores, not actually calling AI. Needs real implementation.
2. **Mixed API providers** — Some functions use Lovable Gateway, others call OpenAI/Anthropic directly. Consider standardizing to Lovable Gateway where possible to reduce API key dependencies.
3. **`call-answering-service`** calls `api.openai.com` directly instead of the Lovable Gateway.

