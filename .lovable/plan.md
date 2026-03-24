

## Plan: Add Manual Number Entry + In-Hub List Builder to Text Blast

### What Changes

The Text Blast creator currently only supports selecting from `dialer_lists` (built in the Call Center). Two additions are needed:

1. **Manual single number entry** — A toggle/option to type one phone number directly instead of selecting a list
2. **Build list from contacts within Follow Up Hub** — A "Build List" button that opens a contact picker dialog (reusing the same pattern as `CallCenterListBuilder`) to create a new `dialer_lists` entry without leaving the Text Blast flow

### File Changes

#### 1. `src/components/communications/TextBlastCreator.tsx`
- Add a **send mode toggle**: "Single Number" vs "Contact List" (radio/tabs at top of Campaign Details card)
- **Single Number mode**: Show a phone number input field + optional name field. When sending, create a single `sms_blast_items` entry with the manually entered number instead of pulling from a list. Set `list_id` to null (make it optional in the insert).
- **Contact List mode** (current behavior): Keep the list dropdown, but add a "Build New List" button next to it that opens the list builder dialog.
- Update `handleSend` to handle both modes — single number creates one blast item; list mode works as before.
- Update the send button label to reflect mode ("Send to 1 Recipient" vs "Send to N Recipients").

#### 2. `src/components/communications/TextBlastListBuilder.tsx` (New)
- Reuse the pattern from `CallCenterListBuilder.tsx` — fetch contacts with phone numbers, filter by status/source/search, checkbox selection, name the list, save to `dialer_lists` + `dialer_list_items`.
- Dialog title: "Build Text Blast List" instead of "Build Dialer List"
- On save, return the new list ID so `TextBlastCreator` can auto-select it.

#### 3. `supabase/migrations/` — Make `list_id` nullable on `sms_blasts`
- `ALTER TABLE sms_blasts ALTER COLUMN list_id DROP NOT NULL;` — needed for single-number blasts that have no associated list.

### Key Logic

```text
TextBlastCreator
├── Mode: "single" | "list"
│
├── Single mode:
│   ├── Phone input + Name input
│   └── handleSend → insert blast (list_id=null), insert 1 item
│
└── List mode:
    ├── Select existing list (dropdown)
    ├── "Build New List" button → opens TextBlastListBuilder dialog
    └── handleSend → insert blast + items from list (existing flow)
```

### Files Summary

| File | Action |
|------|--------|
| `src/components/communications/TextBlastCreator.tsx` | Modify — add mode toggle, manual number input, build list button |
| `src/components/communications/TextBlastListBuilder.tsx` | Create — contact picker dialog for building lists in-hub |
| Migration SQL | Create — make `list_id` nullable on `sms_blasts` |

